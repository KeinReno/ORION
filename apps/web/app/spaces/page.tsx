"use client";

import { useCreateWorkspace, useLogout, useSession, useWorkspaces } from "@orion/core-react";
import type { WorkspaceRole } from "@orion/shared-types";
import { AuroraBackground, Button, Input, SpotlightCard } from "@orion/ui";
import { motion } from "framer-motion";
import { ChevronRight, FolderPlus, LogOut, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AccountAvatar } from "../../components/account-avatar";
import { describeAuthError } from "../../lib/error-message";
import { setActiveWorkspaceId, useActiveWorkspace } from "../../lib/use-active-workspace";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "владелец",
  lead: "лид",
  member: "участник"
};

export default function SpacesPage(): React.ReactElement {
  const router = useRouter();
  const { user, isLoading: sessionLoading, status: sessionStatus, retry: retrySession } = useSession();
  const { data: workspaces, isLoading: listLoading, isError, error } = useWorkspaces();
  const { workspace: lastWorkspace } = useActiveWorkspace();
  const create = useCreateWorkspace();
  const logout = useLogout();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [soloTemplate, setSoloTemplate] = useState(true);

  useEffect(() => {
    // "unavailable" (API unreachable) must not bounce to /login — that's
    // the "logged out" diagnosis for a problem that's actually "can't reach
    // the server right now".
    if (sessionStatus === "unauthenticated") {
      router.replace("/login");
    }
  }, [sessionStatus, router]);

  function enter(id: string): void {
    setActiveWorkspaceId(id);
    router.replace("/dashboard");
  }

  async function createSpace(input: { name: string; template?: "solo-dev" }): Promise<void> {
    const created = await create.mutateAsync(input);
    enter(created.id);
  }

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createSpace({ name: trimmed, template: soloTemplate ? "solo-dev" : undefined });
    } catch {
      return;
    }
  }

  async function onCreateOrion(): Promise<void> {
    try {
      await createSpace({ name: "ORION", template: "solo-dev" });
    } catch {
      return;
    }
  }

  if (sessionStatus === "unavailable") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <p>Не удаётся связаться с сервером. Проверьте соединение и попробуйте ещё раз.</p>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-white/5"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (sessionLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
    );
  }

  const list = workspaces ?? [];
  const hasOrion = list.some((space) => space.name.toLowerCase() === "orion");

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <AuroraBackground />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <SpotlightCard className="w-full">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent-text">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">ORION</span>
          </div>
          <h1 className="mb-1 text-lg font-semibold text-foreground">Пространства учётки</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Они принадлежат «{user.name}». Откройте существующее или создайте новое — данные не смешиваются.
          </p>

          {listLoading ? (
            <p className="text-sm text-muted-foreground">Загружаем пространства…</p>
          ) : isError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {describeAuthError(error)}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((space) => {
                const last = space.id === lastWorkspace?.id;
                return (
                  <li key={space.id}>
                    <button
                      type="button"
                      onClick={() => enter(space.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-white/[0.06]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm font-bold text-accent-text">
                        {space.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{space.name}</span>
                        <span className="text-2xs text-subtle-foreground">
                          {ROLE_LABEL[space.role]}
                          {last ? " · последнее" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        Открыть
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!listLoading && !isError && !hasOrion ? (
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => void onCreateOrion()}
              className="mt-4 flex w-full flex-col gap-1 rounded-xl border border-accent/30 bg-accent/10 px-3 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/15 disabled:opacity-50"
            >
              <span className="text-sm font-medium text-foreground">Создать пространство ORION</span>
              <span className="text-2xs text-muted-foreground">
                Ядро соло-разработчика: проект, задачи, заметки, привычки. Финансы и склад выключены.
              </span>
            </button>
          ) : null}

          {creating ? (
            <form className="mt-4 flex flex-col gap-2" onSubmit={onCreate}>
              <Input
                autoFocus
                maxLength={80}
                placeholder="Название пространства"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={soloTemplate}
                  onChange={(e) => setSoloTemplate(e.target.checked)}
                />
                Заполнить как ядро соло-разработчика
              </label>
              {create.isError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {describeAuthError(create.error)}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={create.isPending || !name.trim()}>
                  {create.isPending ? "Создаём…" : "Создать и открыть"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                  Отмена
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
            >
              <FolderPlus className="h-4 w-4" />
              Новое пространство
            </button>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
            <a
              href="/account"
              className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <AccountAvatar userId={user.id} name={user.name} hasAvatar={user.hasAvatar} size={22} />
              <span className="min-w-0 truncate">{user.name || user.email || "Учётка"}</span>
            </a>
            <button
              type="button"
              onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace("/login") })}
              className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Сменить учётку
            </button>
          </div>
        </SpotlightCard>
      </motion.div>
    </div>
  );
}
