"use client";

import { useCreateGrant, useResolveUserByEmail, useRevokeGrant, useSearchWorkspaceMembers, useWorkspaceGrants } from "@orion/core-react";
import type { SharedGrantObjectType } from "@orion/shared-types";
import { Button, IconButton, Input, Modal, useToast } from "@orion/ui";
import { AlertTriangle, Share2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { describeError } from "../lib/error-message";
import { shortDateTime } from "../lib/format";
import { useActiveWorkspace } from "../lib/use-active-workspace";

type DurationKind = "none" | "7d" | "date";

const TYPE_LABEL: Record<SharedGrantObjectType, string> = {
  note: "заметку",
  document: "документ",
  project: "проект",
  transaction: "операцию"
};

/**
 * Allowlist preview shown to the owner BEFORE the grant is created — раздел
 * 6, step 3 of the U09 threat model's UX flow ("проверил, что будет
 * доступно"). Mirrors the per-type allowlist in `SharedService.getObject`
 * (27-U09-THREAT-MODEL.md, раздел 3.1) by hand — if that allowlist changes,
 * this list must change with it, there is no shared source of truth to pull
 * this from on the client.
 */
const ALLOWLIST_PREVIEW: Record<SharedGrantObjectType, string[]> = {
  note: ["Заголовок", "Текст заметки", "Теги"],
  document: ["Имя файла", "Тип файла", "Размер"],
  project: ["Название", "Описание", "Статус", "Даты начала и дедлайна"],
  transaction: ["Тип операции (доход/расход)", "Заметка к операции", "Дата операции"]
};

/**
 * «Поделиться доступом» — U09 grant-issue UI (27-U09-THREAT-MODEL.md, раздел
 * 6). Visible ONLY to the workspace's `owner` (раздел 4 «Create», раздел 5
 * вопрос 1 — no `member`/`lead` delegation in this slice), and only once the
 * object already has an id (nothing to grant on an unsaved draft).
 *
 * Deliberately NOT built on `EntityLinksSection`'s generic-collector pattern
 * — grants are a different, narrower relationship (T1: no FK/EntityLink
 * traversal for the grantee), so this is its own small component with its
 * own list + own picker, not a mode of the links block.
 */
export function ShareGrantSection({
  workspaceId,
  type,
  id
}: {
  workspaceId: string | undefined;
  type: SharedGrantObjectType;
  id: string | undefined;
}): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  const isOwner = Boolean(workspace) && workspace?.id === workspaceId && workspace?.role === "owner";

  const { data: grants } = useWorkspaceGrants(isOwner ? workspaceId : undefined);
  const activeGrants = (grants ?? []).filter((g) => g.objectType === type && g.objectId === id && !g.revokedAt);

  const [open, setOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"member" | "email">("member");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ userId: string; label: string } | null>(null);
  const [duration, setDuration] = useState<DurationKind>("none");
  const [expiresAt, setExpiresAt] = useState("");

  // R29-05: "по email" — addresses someone who is NOT a member of this
  // workspace (that's the reason a grant exists at all), without a live
  // per-keystroke lookup — armed only by an explicit click, both to avoid
  // firing a request per character and to keep the neutral not-found
  // response from becoming a fast enumeration oracle.
  const [emailQuery, setEmailQuery] = useState("");
  const [emailLookupArmed, setEmailLookupArmed] = useState(false);
  const { data: emailResult, isFetching: emailLookupPending } = useResolveUserByEmail(emailQuery, emailLookupArmed);

  const { data: candidates } = useSearchWorkspaceMembers(workspaceId, query);
  const createGrant = useCreateGrant(workspaceId);
  const revokeGrant = useRevokeGrant(workspaceId);
  const { toast } = useToast();

  if (!isOwner || !id) return null;

  function resetForm(): void {
    setPickerMode("member");
    setQuery("");
    setEmailQuery("");
    setEmailLookupArmed(false);
    setSelected(null);
    setDuration("none");
    setExpiresAt("");
  }

  async function submit(): Promise<void> {
    if (!selected || !id) return;
    const durationInput =
      duration === "none"
        ? { kind: "none" as const }
        : duration === "7d"
          ? { kind: "7d" as const }
          : { kind: "date" as const, expiresAt: new Date(expiresAt).toISOString() };
    if (duration === "date" && (!expiresAt || Number.isNaN(new Date(expiresAt).getTime()))) return;
    try {
      await createGrant.mutateAsync({ granteeUserId: selected.userId, objectType: type, objectId: id, duration: durationInput });
      toast({ title: "Доступ предоставлен", tone: "success" });
      setOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: "Не удалось предоставить доступ", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
          <Share2 className="h-3.5 w-3.5" /> Доступ извне
          {activeGrants.length > 0 ? <span className="text-subtle-foreground">· {activeGrants.length}</span> : null}
        </span>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="h-6 px-2 text-2xs"
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
        >
          <Share2 className="h-3.5 w-3.5" /> Поделиться доступом
        </Button>
      </div>

      {activeGrants.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {activeGrants.map((g) => (
            <li
              key={g.grantId}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2 py-1 text-2xs text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate">
                {g.granteeName}
                {g.granteeEmail ? ` (${g.granteeEmail})` : ""} · Только просмотр ·{" "}
                {g.expiresAt ? `до ${shortDateTime(g.expiresAt)}` : "без срока"}
              </span>
              <IconButton
                label="Отозвать доступ"
                size="sm"
                className="h-5 w-5 shrink-0"
                disabled={revokeGrant.isPending}
                onClick={() => revokeGrant.mutate(g.grantId)}
              >
                <Trash2 className="h-3 w-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Поделиться доступом к объекту «${TYPE_LABEL[type]}»`}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="subtle" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!selected || createGrant.isPending || (duration === "date" && !expiresAt)}
              onClick={() => void submit()}
            >
              Предоставить доступ
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-subtle-foreground">Кому предоставить доступ</label>
            {selected ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-2 py-1.5 text-sm text-foreground">
                <span className="flex-1 truncate">{selected.label}</span>
                <IconButton label="Сбросить получателя" size="sm" onClick={() => setSelected(null)}>
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ) : (
              <>
                <div className="flex gap-1.5 text-2xs">
                  <button
                    type="button"
                    onClick={() => setPickerMode("member")}
                    className={`rounded-full border px-2.5 py-0.5 ${
                      pickerMode === "member" ? "border-accent text-accent-text" : "border-border text-subtle-foreground"
                    }`}
                  >
                    Участник этого пространства
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerMode("email")}
                    className={`rounded-full border px-2.5 py-0.5 ${
                      pickerMode === "email" ? "border-accent text-accent-text" : "border-border text-subtle-foreground"
                    }`}
                  >
                    По email
                  </button>
                </div>

                {pickerMode === "member" ? (
                  <>
                    <Input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Email или имя участника этого пространства…"
                    />
                    {query.trim().length >= 2 ? (
                      <ul className="orion-scroll max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-white/[0.02] p-1">
                        {(candidates ?? []).map((c) => (
                          <li key={c.userId}>
                            <button
                              type="button"
                              onClick={() => setSelected({ userId: c.userId, label: c.email ? `${c.name} (${c.email})` : c.name })}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
                            >
                              <span className="flex-1 truncate">{c.name}</span>
                              {c.email ? <span className="text-2xs text-subtle-foreground">{c.email}</span> : null}
                            </button>
                          </li>
                        ))}
                        {(candidates ?? []).length === 0 ? (
                          <li className="px-2 py-2 text-center text-2xs text-subtle-foreground">
                            Никого не найдено среди участников этого пространства
                          </li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="text-2xs text-subtle-foreground">
                        Введите минимум два символа — ищем среди участников этого пространства.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex gap-1.5">
                      <Input
                        autoFocus
                        type="email"
                        value={emailQuery}
                        onChange={(e) => {
                          setEmailQuery(e.target.value);
                          setEmailLookupArmed(false);
                        }}
                        placeholder="Точный email пользователя ORION…"
                        className="flex-1"
                      />
                      <Button type="button" variant="subtle" size="sm" onClick={() => setEmailLookupArmed(true)}>
                        Найти
                      </Button>
                    </div>
                    {/* R29-05: person doesn't need source-workspace membership to be
                        addressed this way — selecting them here never adds them to
                        `workspaceId`, only lets `SharedGrantsService.create` target
                        their userId. */}
                    {emailLookupArmed && !emailLookupPending ? (
                      emailResult?.found ? (
                        <button
                          type="button"
                          onClick={() => setSelected({ userId: emailResult.userId, label: `${emailResult.name} (${emailQuery.trim()})` })}
                          className="flex w-full items-center gap-2 rounded-md border border-border bg-white/[0.02] px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
                        >
                          <span className="flex-1 truncate">{emailResult.name}</span>
                          <span className="text-2xs text-subtle-foreground">{emailQuery.trim()}</span>
                        </button>
                      ) : (
                        <p className="text-2xs text-subtle-foreground">
                          Пользователь с таким email недоступен для приглашения. Пригласительных ссылок для
                          несуществующих аккаунтов в этой версии нет.
                        </p>
                      )
                    ) : (
                      <p className="text-2xs text-subtle-foreground">
                        Укажите точный email — членство в этом пространстве при этом не изменится.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-subtle-foreground">Срок действия</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { kind: "none" as const, label: "Без срока" },
                  { kind: "7d" as const, label: "На 7 дней" },
                  { kind: "date" as const, label: "До даты" }
                ]
              ).map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => setDuration(opt.kind)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    duration === opt.kind ? "border-accent text-accent-text" : "border-border text-subtle-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {duration === "date" ? (
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-48" />
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-white/[0.02] p-2.5">
            <p className="text-xs font-medium text-foreground">Получателю будет видно (только просмотр):</p>
            <ul className="list-disc pl-4 text-xs text-muted-foreground">
              {ALLOWLIST_PREVIEW[type].map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
            {type === "document" ? (
              <p className="mt-1 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Будет виден весь файл целиком — включая скрытые листы, встроенные изображения и другие данные,
                  которые вы можете не помнить. Частичного доступа «только к части файла» нет.
                </span>
              </p>
            ) : null}
            <p className="text-2xs text-subtle-foreground">
              Доступ только на чтение. Связанные записи, история версий и права на дальнейшую передачу
              получателю не предоставляются.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
