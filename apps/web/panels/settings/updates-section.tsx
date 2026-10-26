"use client";

import { Badge, Button, Card, EmptyState, Input, Skeleton, useToast } from "@orion/ui";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { applyUpdate, checkForUpdate, downloadUpdate, fetchUpdateConfig, fetchUpdateStatus, saveUpdateConfig } from "../../lib/updates-local";
import { describeAuthError } from "../../lib/error-message";

const STATE_LABEL: Record<string, string> = {
  idle: "Не проверялось",
  checking: "Проверка…",
  up_to_date: "Установлена последняя версия",
  available: "Доступно обновление",
  downloading: "Скачивание…",
  ready: "Обновление скачано",
  applying: "Установка…",
  error: "Ошибка"
};

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/**
 * Обновления программы с GitHub Releases. Доступ к приватному репозиторию — по токену владельца (хранится зашифрованным
 * на этом компьютере, обратно не показывается). Скачивание проверяется по размеру и SHA-256 из описания релиза; установка
 * закрывает программу, ставит новую версию поверх (данные сохраняются) и запускает её заново.
 */
export function UpdatesSettings(): React.ReactElement {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"check" | "download" | "apply" | null>(null);
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["updates", "status"],
    queryFn: fetchUpdateStatus,
    // Пока идёт скачивание или установка — обновляем чаще.
    refetchInterval: (query) => (query.state.data && ["downloading", "applying", "checking"].includes(query.state.data.state) ? 1500 : false)
  });
  const config = useQuery({ queryKey: ["updates", "config"], queryFn: fetchUpdateConfig });

  async function run(kind: "check" | "download" | "apply", fn: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(kind);
    try {
      await fn();
      if (done) toast({ title: done, tone: "success" });
    } catch (error) {
      toast({ title: "Не получилось", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["updates"] });
    }
  }

  async function saveConfig(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await saveUpdateConfig({ ...(token.trim() ? { token: token.trim() } : {}), ...(repo !== null ? { repo } : {}) });
      setToken("");
      toast({ title: "Настройки обновлений сохранены", description: "Токен хранится зашифрованным и больше не показывается.", tone: "success" });
      void queryClient.invalidateQueries({ queryKey: ["updates"] });
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (status.isLoading || config.isLoading) return <Skeleton className="h-40" />;
  if (status.isError || !status.data) {
    return <EmptyState icon={TriangleAlert} tone="danger" title="Служба обновлений недоступна" description="Обновления работают только в установленной программе ORION." />;
  }
  const s = status.data;
  const c = config.data;
  const downloading = s.state === "downloading";

  return (
    <div className="space-y-5">
      <Card className="space-y-2 py-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {STATE_LABEL[s.state] ?? s.state}
          {s.state === "available" || s.state === "ready" ? <Badge tone="success">{s.latest?.tag}</Badge> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Сейчас установлено: {s.currentTag ?? `версия ${s.currentVersion} (метка сборки неизвестна)`}
          {s.lastCheckedAt ? ` · проверено ${new Date(s.lastCheckedAt).toLocaleString("ru-RU")}` : ""}
        </p>
        {s.error ? <p className="text-xs text-danger">{s.error}</p> : null}
        {downloading ? (
          <div className="h-2 w-full overflow-hidden rounded bg-white/10" role="progressbar" aria-valuenow={Math.round(s.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(s.progress * 100)}%` }} />
          </div>
        ) : null}
        {s.latest && (s.state === "available" || s.state === "ready" || s.state === "downloading") ? (
          <div className="space-y-1 pt-1">
            <p className="text-xs text-muted-foreground">
              {s.latest.name} · {s.latest.kind === "payload" ? "пакет приложения" : "полный установщик"} · {formatSize(s.latest.sizeBytes)}
              {s.latest.publishedAt ? ` · ${new Date(s.latest.publishedAt).toLocaleDateString("ru-RU")}` : ""}
            </p>
            {s.latest.notes ? <p className="whitespace-pre-wrap text-xs text-muted-foreground">{s.latest.notes.slice(0, 600)}</p> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" disabled={!s.configured || busy !== null || downloading || s.state === "applying"} onClick={() => void run("check", checkForUpdate)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Проверить
          </Button>
          {s.state === "available" || (s.state === "error" && s.latest) ? (
            <Button size="sm" disabled={busy !== null} onClick={() => void run("download", downloadUpdate, "Обновление скачано и проверено")}>
              <Download className="h-4 w-4" aria-hidden /> Скачать
            </Button>
          ) : null}
          {s.state === "ready" ? (
            <Button
              size="sm"
              disabled={busy !== null || !s.canApply}
              title={s.canApply ? undefined : "Автоматическая установка доступна только в установленной версии для Windows"}
              onClick={() => void run("apply", applyUpdate, "Устанавливаю… программа закроется и откроется заново")}
            >
              Установить и перезапустить
            </Button>
          ) : null}
        </div>
        {s.state === "ready" ? <p className="text-xs text-muted-foreground">Перед установкой программа закроется. Данные сохраняются; несохранённые изменения сохраните заранее.</p> : null}
      </Card>

      <form onSubmit={(event) => void saveConfig(event)} className="max-w-md space-y-3">
        <p className="text-xs text-muted-foreground">
          Репозиторий приватный: нужен токен GitHub с правом чтения релизов (Settings → Developer settings → Fine-grained tokens, доступ «Contents: read» к
          репозиторию). Токен хранится зашифрованным на этом компьютере. {c?.tokenSet ? "Токен задан." : "Токен не задан."}
        </p>
        <label className="block space-y-1 text-sm">
          <span>Репозиторий</span>
          <Input value={repo ?? c?.repo ?? ""} onChange={(event) => setRepo(event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Токен GitHub</span>
          <Input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={c?.tokenSet ? "задан — введите новый, чтобы заменить" : "github_pat_…"} />
        </label>
        <Button type="submit" disabled={!token.trim() && repo === null}>
          Сохранить
        </Button>
      </form>
    </div>
  );
}
