"use client";

import {
  useBackups,
  useRestoreBackup,
  useRunBackup,
  useSaveSyncRemote,
  useSyncRemote,
  useTestSyncRemote
} from "@orion/core-react";
import type { RestorePreview, SyncRemoteInput } from "@orion/shared-types";
import {
  Button,
  Card,
  EmptyState,
  Input,
  MultiStepLoader,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelShell,
  Select,
  Skeleton,
  StatCard,
  Switch,
  useToast
} from "@orion/ui";
import { Cloud, DatabaseBackup, Lock, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { describeAuthError } from "../lib/error-message";
import { useActiveWorkspace } from "../lib/use-active-workspace";

const BACKUP_STEPS = ["Собираю данные…", "Шифрую снимок…", "Загружаю на WebDAV…"];
const RESTORE_PREVIEW_STEPS = ["Скачиваю снимок…", "Расшифровываю…", "Считаю изменения…"];
const RESTORE_APPLY_STEPS = ["Скачиваю снимок…", "Расшифровываю…", "Применяю…"];

const emptyForm: SyncRemoteInput = {
  kind: "webdav",
  url: "",
  username: "",
  password: "",
  baseDir: "/ORION",
  depthInfinity: true,
  encAlgo: "rclone-base64",
  autoEveryMs: -1
};

export function SyncPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const isOwner = workspace?.role === "owner";
  const remote = useSyncRemote(workspace?.id, isOwner);
  const saveRemote = useSaveSyncRemote(workspace?.id);
  const testRemote = useTestSyncRemote(workspace?.id);
  const backups = useBackups(workspace?.id, Boolean(remote.data), isOwner);
  const runBackup = useRunBackup(workspace?.id);
  const restore = useRestoreBackup(workspace?.id);
  const { toast } = useToast();
  const [form, setForm] = useState<SyncRemoteInput>(emptyForm);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  // `restore` (useRestoreBackup) is shared by both the dry-run preview and
  // the real apply — this tells the two apart so the right step labels (and
  // the confirm button's own status) show for whichever is actually in flight.
  const [restorePhase, setRestorePhase] = useState<"preview" | "apply" | null>(null);

  useEffect(() => {
    if (!remote.data) return;
    setForm({
      kind: remote.data.kind,
      url: remote.data.url,
      username: remote.data.username,
      password: "",
      baseDir: remote.data.baseDir,
      depthInfinity: remote.data.depthInfinity,
      encAlgo: remote.data.encAlgo,
      autoEveryMs: remote.data.autoEveryMs
    });
  }, [remote.data]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await saveRemote.mutateAsync(form);
      setForm((current) => ({ ...current, password: "" }));
      toast({ title: "Настройки синхронизации сохранены", tone: "success" });
    } catch (error) {
      showError("Не удалось сохранить настройки", error);
    }
  }

  async function checkConnection(): Promise<void> {
    try {
      const result = await testRemote.mutateAsync();
      toast({
        title: result.ok ? "Соединение работает" : "Проверка не пройдена",
        description: result.detail,
        tone: result.ok ? "success" : "danger"
      });
    } catch (error) {
      showError("Не удалось проверить WebDAV", error);
    }
  }

  async function createBackup(): Promise<void> {
    try {
      const result = await runBackup.mutateAsync();
      toast({ title: "Бэкап создан", description: `${result.name} · ${formatBytes(result.sizeBytes)}`, tone: "success" });
    } catch (error) {
      showError("Не удалось создать бэкап", error);
    }
  }

  async function previewRestore(snapshot: string): Promise<void> {
    setRestorePhase("preview");
    try {
      setPreview(await restore.mutateAsync({ snapshot, dryRun: true }));
    } catch (error) {
      showError("Не удалось проверить бэкап", error);
    } finally {
      setRestorePhase(null);
    }
  }

  async function applyRestore(): Promise<void> {
    if (!preview || !workspace) return;
    setRestorePhase("apply");
    try {
      await restore.mutateAsync({
        snapshot: preview.snapshot,
        dryRun: false,
        confirmWorkspaceId: workspace.id,
        // S04 (stale-preview rejection): apply отдаёт назад тот же
        // manifestHash, что показал preview — сервер сверяет его со
        // свежескачанным файлом и отказывает, если удалёнка успела
        // измениться между предпросмотром и подтверждением.
        expectedManifestHash: preview.manifestHash
      });
      setPreview(null);
      toast({ title: "Рабочее пространство восстановлено", tone: "success" });
    } catch (error) {
      showError("Восстановление не выполнено", error);
    } finally {
      setRestorePhase(null);
    }
  }

  function showError(title: string, error: unknown): void {
    toast({ title, description: describeAuthError(error), tone: "danger" });
  }

  const diff = preview ? previewDiff(preview) : null;

  if (workspace && !isOwner) {
    // UI-only gate: hides the form so a member/lead doesn't see a panel full
    // of doomed 403s. The real access control is server-side (S02,
    // `assertMemberRoleTx(..., ["owner"])` in `SyncService`) — this is just
    // hygiene, not a substitute for it.
    return (
      <PanelShell>
        <PanelHeader icon={RefreshCw} title="Резервные копии" subtitle="Зашифрованные снимки через WebDAV" />
        <PanelBody measure="settings">
          <EmptyState
            icon={Lock}
            title="Доступно только владельцу"
            description="Настройки резервного копирования и восстановление видит и меняет только владелец рабочего пространства."
          />
        </PanelBody>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <PanelHeader icon={RefreshCw} title="Резервные копии" subtitle="Зашифрованные снимки через WebDAV" />
      <PanelBody measure="settings" className="[container-type:inline-size]">
        {remote.isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить настройки синхронизации"
            description={describeAuthError(remote.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void remote.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : null}
        <PanelSection title="Облако">
          <Card>
            {remote.isLoading ? (
              <Skeleton className="h-56" />
            ) : (
              <form className="grid gap-4 [@container(min-width:640px)]:grid-cols-2" onSubmit={submit}>
                <Field className="[@container(min-width:640px)]:col-span-2" label="Адрес WebDAV">
                  <Input id="sync-webdav-url" type="url" required value={form.url} placeholder="https://cloud.example.com/webdav" onChange={(event) => setForm({ ...form, url: event.target.value })} />
                </Field>
                <Field label="Пользователь"><Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></Field>
                <Field label="Пароль приложения"><Input type="password" value={form.password} placeholder={remote.data?.hasPassword ? "Оставьте пустым, чтобы не менять" : "Введите пароль"} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
                <Field label="Каталог"><Input required value={form.baseDir} onChange={(event) => setForm({ ...form, baseDir: event.target.value })} /></Field>
                <Field label="Имена файлов"><Select className="w-full" value={form.encAlgo} onChange={(event) => setForm({ ...form, encAlgo: event.target.value as SyncRemoteInput["encAlgo"] })}><option value="rclone-base64">Совместимые с rclone</option><option value="openssl-base64">Base64</option><option value="none">Без маскировки</option></Select></Field>
                <div className="flex items-center gap-2 text-sm text-muted-foreground [@container(min-width:640px)]:col-span-2">
                  <Switch
                    checked={form.depthInfinity}
                    onChange={(depthInfinity) => setForm({ ...form, depthInfinity })}
                    label="Сервер поддерживает рекурсивный Depth: infinity"
                  />
                  Сервер поддерживает рекурсивный Depth: infinity
                </div>
                <div className="flex flex-wrap gap-2 [@container(min-width:640px)]:col-span-2">
                  <Button type="submit" status={saveRemote.isPending ? "pending" : saveRemote.isSuccess ? "success" : saveRemote.isError ? "error" : "idle"}>
                    Сохранить
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!remote.data}
                    status={testRemote.isPending ? "pending" : testRemote.isSuccess ? "success" : testRemote.isError ? "error" : "idle"}
                    onClick={checkConnection}
                  >
                    <Cloud className="h-4 w-4" /> Проверить соединение
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </PanelSection>

        <PanelSection
          title="Резервные копии"
          actions={
            <Button
              size="sm"
              disabled={!remote.data}
              status={runBackup.isPending ? "pending" : runBackup.isSuccess ? "success" : runBackup.isError ? "error" : "idle"}
              onClick={createBackup}
            >
              <DatabaseBackup className="h-4 w-4" /> Создать бэкап
            </Button>
          }
        >
          <div className="space-y-3">
            {runBackup.isPending ? <MultiStepLoader steps={BACKUP_STEPS} /> : null}
            {restorePhase === "preview" ? <MultiStepLoader steps={RESTORE_PREVIEW_STEPS} /> : null}
            {!remote.data ? (
              <EmptyState
                icon={Cloud}
                title="Облако ещё не настроено"
                description="Заполните адрес WebDAV и сохраните — после этого здесь появятся снимки."
                action={
                  <Button
                    size="sm"
                    onClick={() => document.getElementById("sync-webdav-url")?.focus()}
                  >
                    Заполнить форму
                  </Button>
                }
              />
            ) : backups.isError ? (
              <EmptyState
                icon={TriangleAlert}
                tone="danger"
                title="Не удалось загрузить резервные копии"
                description={describeAuthError(backups.error)}
                action={
                  <Button size="sm" variant="outline" onClick={() => void backups.refetch()}>
                    Повторить
                  </Button>
                }
              />
            ) : backups.isLoading ? (
              <Skeleton className="h-24" />
            ) : backups.data?.length ? (
              <div className="space-y-2">
                {backups.data.map((backup) => (
                  <Card key={backup.name} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{new Date(backup.createdAt).toLocaleString("ru-RU")}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(backup.sizeBytes)} · {backup.name}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => previewRestore(backup.name)}>
                      Восстановить…
                    </Button>
                  </Card>
                ))}
              </div>
            ) : (
              <Message>Резервных копий пока нет.</Message>
            )}
          </div>
        </PanelSection>

        {preview ? (
          <PanelSection title="Проверка восстановления">
            <Card className="space-y-4 border-warning/30">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-warning" />
                <div>
                  <p className="text-sm font-medium">Будут заменены данные текущего пространства</p>
                  <p className="text-xs text-muted-foreground">Снимок: {new Date(preview.createdAt).toLocaleString("ru-RU")}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Добавлено" value={String(diff?.added ?? 0)} />
                <StatCard label="Удалено" value={String(diff?.removed ?? 0)} />
                <StatCard label="Изменено" value={String(diff?.changed ?? 0)} />
              </div>
              <div className="grid gap-2 [@container(min-width:576px)]:grid-cols-2">
                <CountList title="В бэкапе" counts={preview.incoming} />
                <CountList title="Сейчас" counts={preview.current} />
              </div>
              {restorePhase === "apply" ? <MultiStepLoader steps={RESTORE_APPLY_STEPS} /> : null}
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={restorePhase !== "apply" && restore.isPending}
                  status={
                    restorePhase === "apply"
                      ? restore.isPending
                        ? "pending"
                        : restore.isSuccess
                          ? "success"
                          : restore.isError
                            ? "error"
                            : "idle"
                      : "idle"
                  }
                  onClick={applyRestore}
                >
                  Подтвердить восстановление
                </Button>
                <Button variant="subtle" onClick={() => setPreview(null)}>
                  Отмена
                </Button>
              </div>
            </Card>
          </PanelSection>
        ) : null}
      </PanelBody>
    </PanelShell>
  );
}

function previewDiff(preview: RestorePreview): { added: number; removed: number; changed: number } {
  let added = 0;
  let removed = 0;
  let changed = 0;
  const keys = new Set([...Object.keys(preview.incoming), ...Object.keys(preview.current)]);
  for (const key of keys) {
    const next = preview.incoming[key] ?? 0;
    const prev = preview.current[key] ?? 0;
    if (next > prev) added += next - prev;
    if (prev > next) removed += prev - next;
    if (next !== prev) changed += 1;
  }
  return { added, removed, changed };
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Message({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Card className="text-sm text-muted-foreground">{children}</Card>;
}

function CountList({ title, counts }: { title: string; counts: Record<string, number> }): React.ReactElement {
  return <div className="rounded-lg bg-white/[0.03] p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>{Object.entries(counts).map(([name, count]) => <div key={name} className="flex justify-between text-xs"><span>{name}</span><span className="tabular-nums text-muted-foreground">{count}</span></div>)}</div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
