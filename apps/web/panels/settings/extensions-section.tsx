"use client";

import {
  useApproveExtension,
  useExtensionSecrets,
  useExtensions,
  useOpenExtensionsFolder,
  useRevokeExtension,
  useSetExtensionSecret,
  useUpdateExtension
} from "@orion/core-react";
import type { ExtensionInfo, ExtensionStatus } from "@orion/shared-types";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Skeleton, Switch, useToast } from "@orion/ui";
import { FolderOpen, Puzzle } from "lucide-react";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useExtensionLoadState } from "../../lib/extensions/runtime/runtime-extensions";
import { relativeTime } from "../../lib/format";
import { SettingGroup, SettingRow } from "./setting-row";

const STATUS: Record<ExtensionStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  pending: { label: "ждёт подтверждения", tone: "accent" },
  approved: { label: "работает", tone: "success" },
  disabled: { label: "выключено", tone: "neutral" },
  changed: { label: "файлы изменились", tone: "warning" },
  invalid: { label: "с ошибками", tone: "danger" },
  incompatible: { label: "не подходит к версии", tone: "danger" }
};

/**
 * «Настройки → Этот компьютер → Расширения» (ADR-0022, E2): папка, что в ней найдено, подтверждение и выключение.
 * Подтверждение действует на всю установку; подтверждать может владелец хотя бы одного пространства.
 */
export function ExtensionsSettings(): React.ReactElement {
  const extensions = useExtensions();
  const openFolder = useOpenExtensionsFolder();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<ExtensionInfo | null>(null);
  const approve = useApproveExtension();

  if (extensions.isPending) return <Skeleton className="h-40" />;
  if (extensions.isError || !extensions.data) {
    return <EmptyState icon={Puzzle} tone="danger" title="Не удалось получить список расширений" description={describeAuthError(extensions.error)} />;
  }
  const state = extensions.data;
  if (!state.available) return <EmptyState icon={Puzzle} title="Расширения недоступны" description={state.reason ?? undefined} />;

  async function confirmApprove(): Promise<void> {
    const item = confirming;
    setConfirming(null);
    if (!item?.sha256) return;
    try {
      await approve.mutateAsync({ id: item.id, sha256: item.sha256 });
      toast({ title: `«${item.name}» подтверждено и включено`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось подтвердить", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-5">
      <SettingGroup title="Папка расширений" description="Положите сюда папку расширения — ORION заметит её за пару секунд, без перезапуска.">
        <SettingRow anchor="extensions-folder" label={<span className="break-all font-mono text-label">{state.dir}</span>}>
          <Button
            size="sm"
            variant="outline"
            disabled={!state.canManage || openFolder.isPending}
            onClick={() =>
              openFolder.mutate(undefined, {
                onError: (error) => toast({ title: "Не удалось открыть папку", description: describeAuthError(error), tone: "danger" })
              })
            }
          >
            <FolderOpen className="h-4 w-4" /> Открыть папку
          </Button>
        </SettingRow>
      </SettingGroup>

      {!state.canManage ? (
        <p className="px-1 text-2xs text-subtle-foreground">Подтверждать и выключать расширения может владелец хотя бы одного пространства.</p>
      ) : null}

      {state.items.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          Расширений пока нет. Новое создаётся командой <span className="font-mono">node scripts/orion-ext.mjs init &lt;имя&gt;</span> и собирается
          <span className="font-mono"> build</span>; готовую папку достаточно положить в папку расширений.
        </Card>
      ) : (
        <div className="space-y-3">
          {state.items.map((item) => (
            <ExtensionCard key={item.folder} item={item} canManage={state.canManage} onApprove={() => setConfirming(item)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Подтвердить «${confirming.name}»?` : "Подтвердить расширение"}
        description={confirming ? <ApproveDetails item={confirming} /> : undefined}
        confirmLabel="Подтвердить и включить"
        danger={false}
        onConfirm={() => void confirmApprove()}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

function ApproveDetails({ item }: { item: ExtensionInfo }): React.ReactElement {
  return (
    <div className="space-y-2 text-label">
      <p>
        Код расширения будет работать в ORION с вашими правами: видеть и менять то же, что и вы. Подтверждайте только то, что
        написали сами или получили из доверенного источника.
      </p>
      <Permissions item={item} />
      <p className="break-all font-mono text-2xs text-subtle-foreground">sha-256 {item.sha256}</p>
    </div>
  );
}

function Permissions({ item }: { item: ExtensionInfo }): React.ReactElement | null {
  const permissions = item.permissions;
  if (!permissions) return null;
  const lines = [
    ...permissions.network.map((host) => `сеть: ${host}`),
    ...permissions.secrets.map((name) => `секрет: ${name}`),
    ...(permissions.storage ? ["хранилище данных расширения"] : [])
  ];
  return lines.length === 0 ? (
    <p className="text-2xs text-subtle-foreground">Дополнительных разрешений не просит.</p>
  ) : (
    <ul className="flex flex-wrap gap-1.5">
      {lines.map((line) => (
        <li key={line}>
          <Badge tone="neutral">{line}</Badge>
        </li>
      ))}
    </ul>
  );
}

function ExtensionCard({ item, canManage, onApprove }: { item: ExtensionInfo; canManage: boolean; onApprove: () => void }): React.ReactElement {
  const update = useUpdateExtension();
  const revoke = useRevokeExtension();
  const load = useExtensionLoadState(item.id);
  const { toast } = useToast();
  const status = STATUS[item.status];
  const approved = item.approvedVersion !== null;
  const fail = (title: string) => (error: unknown) => toast({ title, description: describeAuthError(error), tone: "danger" });

  return (
    <section aria-label={`Расширение ${item.name}`} className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span>{item.name}</span>
            {item.version ? <span className="font-mono text-2xs text-subtle-foreground">{item.version}</span> : null}
            <Badge tone={status.tone}>{status.label}</Badge>
            {item.devMode ? <Badge tone="warning">режим разработчика</Badge> : null}
          </p>
          <p className="mt-0.5 text-2xs text-subtle-foreground">
            папка «{item.folder}»{item.author ? ` · ${item.author}` : ""}
            {item.approvedAt ? ` · подтверждено ${relativeTime(item.approvedAt)}` : ""}
          </p>
          {item.description ? <p className="mt-1 text-label text-muted-foreground">{item.description}</p> : null}
        </div>
        {canManage && (item.status === "pending" || item.status === "changed") ? (
          <Button size="sm" onClick={onApprove}>
            {item.status === "changed" ? "Подтвердить заново" : "Подтвердить и включить"}
          </Button>
        ) : null}
      </div>

      {item.problems.length > 0 ? (
        <ul className="space-y-0.5 text-2xs text-destructive" role="alert">
          {item.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {item.status === "changed" ? (
        <p className="text-2xs text-warning">
          Код поменялся после подтверждения{item.approvedVersion ? ` (было ${item.approvedVersion})` : ""}, поэтому не загружается. Проверьте и
          подтвердите снова — или включите режим разработчика, если правите его сами.
        </p>
      ) : null}
      {item.status === "approved" && load?.status === "failed" ? (
        <p role="alert" className="text-2xs text-destructive">
          В этом окне не загрузилось: {load.error}
        </p>
      ) : null}
      {item.status === "approved" && load?.status === "loading" ? <p className="text-2xs text-subtle-foreground">Загружается…</p> : null}

      <Permissions item={item} />

      {item.status === "approved" && (item.permissions?.secrets.length ?? 0) > 0 ? <ExtensionSecrets extensionId={item.id} /> : null}

      {canManage && approved ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-label text-muted-foreground">
            <Switch
              label="Включено"
              checked={item.status !== "disabled"}
              onChange={(enabled) => update.mutate({ id: item.id, enabled }, { onError: fail("Не удалось переключить") })}
            />
            Включено
          </label>
          <label className="flex items-center gap-2 text-label text-muted-foreground" title="Правки файлов применяются сразу, без повторного подтверждения">
            <Switch
              label="Режим разработчика"
              checked={item.devMode}
              onChange={(devMode) => update.mutate({ id: item.id, devMode }, { onError: fail("Не удалось переключить режим") })}
            />
            Режим разработчика
          </label>
          <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id, { onError: fail("Не удалось отозвать") })}>
            Отозвать подтверждение
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Секреты, объявленные расширением (E3): каждый пользователь задаёт свои. Значение уходит на сервер, шифруется там и
 * обратно не возвращается — расширение получает его только подстановкой в свой сетевой запрос.
 */
function ExtensionSecrets({ extensionId }: { extensionId: string }): React.ReactElement | null {
  const secrets = useExtensionSecrets(extensionId);
  const save = useSetExtensionSecret(extensionId);
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!secrets.data) return null;
  const submit = (name: string, value: string | null): void =>
    save.mutate(
      { name, value },
      {
        onSuccess: () => {
          setDrafts((current) => ({ ...current, [name]: "" }));
          toast({ title: value === null ? `Секрет «${name}» удалён` : `Секрет «${name}» сохранён`, tone: "success" });
        },
        onError: (error) => toast({ title: "Не удалось сохранить секрет", description: describeAuthError(error), tone: "danger" })
      }
    );
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-2xs text-subtle-foreground">Ваши секреты для этого расширения: хранятся зашифрованными, после сохранения не показываются.</p>
      {secrets.data.map((secret) => (
        <form
          key={secret.name}
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (drafts[secret.name]?.trim()) submit(secret.name, drafts[secret.name].trim());
          }}
        >
          <span className="w-32 shrink-0 font-mono text-label text-muted-foreground">{secret.name}</span>
          <Input
            type="password"
            autoComplete="off"
            aria-label={`Секрет ${secret.name}`}
            placeholder={secret.set ? "задан — введите новый, чтобы заменить" : "не задан"}
            className="min-w-0 flex-1"
            value={drafts[secret.name] ?? ""}
            onChange={(event) => setDrafts((current) => ({ ...current, [secret.name]: event.target.value }))}
          />
          <Button type="submit" size="sm" variant="outline" disabled={save.isPending || !drafts[secret.name]?.trim()}>
            Сохранить
          </Button>
          {secret.set ? (
            <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => submit(secret.name, null)}>
              Удалить
            </Button>
          ) : null}
        </form>
      ))}
    </div>
  );
}
