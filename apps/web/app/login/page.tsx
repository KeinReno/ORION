"use client";

import { useAuthAccounts, useLogin, useOrionMode, useSession } from "@orion/core-react";
import type { AccountPublic } from "@orion/shared-types";
import { AuroraBackground, Button, Input, SpotlightCard } from "@orion/ui";
import { motion } from "framer-motion";
import { Sparkles, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { AccountAvatar } from "../../components/account-avatar";
import { describeAuthError } from "../../lib/error-message";
import { sanitizeReturnTo } from "../../lib/return-to";

/**
 * `useSearchParams()` (for the `next` return-to param, S22) needs a
 * `<Suspense>` boundary under Next 14's app router or the desktop
 * `output: "export"` build fails with "should be wrapped in a suspense
 * boundary" — see `LoginPage` below.
 */
function LoginContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only an internal path is ever honored — see sanitizeReturnTo's doc
  // comment for why an arbitrary `next` would be an open redirect.
  const returnTo = sanitizeReturnTo(searchParams.get("next")) ?? "/spaces";
  const { user, isLoading } = useSession();
  // S05: server mode has no account picker/PIN — the API already rejects
  // those endpoints (403/400), this just keeps the UI from offering
  // controls the server will refuse. Defaults to the picker while the mode
  // request is in flight/unknown so local mode (the common case, and the
  // fail-open direction — the server-side gate is what actually enforces
  // server mode) doesn't flash empty.
  const orionMode = useOrionMode();
  const isServerMode = orionMode.data?.mode === "server";
  const accounts = useAuthAccounts(!isServerMode);
  const login = useLogin();
  const [selected, setSelected] = useState<AccountPublic | null>(null);
  const [secret, setSecret] = useState("");
  // Server mode: no directory, no PIN — a named email+password form instead.
  const [serverEmail, setServerEmail] = useState("");
  const [serverPassword, setServerPassword] = useState("");

  useEffect(() => {
    if (!isLoading && user) router.replace(returnTo);
  }, [isLoading, user, router, returnTo]);

  async function unlock(event?: FormEvent, pin?: string): Promise<void> {
    event?.preventDefault();
    if (!selected) return;
    const value = pin ?? secret;
    if (!value) return;
    try {
      await login.mutateAsync(
        selected.unlockKind === "pin"
          ? { userId: selected.id, pin: value }
          : { userId: selected.id, password: value }
      );
    } catch {
      setSecret("");
      return;
    }
    router.replace(returnTo);
  }

  function onPinDigit(digit: string): void {
    if (!selected || secret.length >= 4) return;
    const next = secret + digit;
    setSecret(next);
    if (next.length === 4) void unlock(undefined, next);
  }

  async function unlockServer(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!serverEmail || !serverPassword) return;
    try {
      await login.mutateAsync({ email: serverEmail, password: serverPassword });
    } catch {
      setServerPassword("");
      return;
    }
    router.replace(returnTo);
  }

  const list = accounts.data ?? [];

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
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">ORION</span>
          </div>

          {isServerMode ? (
            <>
              <h1 className="mb-1 text-lg font-semibold text-foreground">Вход</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Серверный режим: список учётных записей и PIN отключены — войдите по email и паролю.
              </p>
              <form className="flex flex-col gap-3" onSubmit={(e) => void unlockServer(e)}>
                <Input
                  type="email"
                  autoFocus
                  autoComplete="username"
                  placeholder="Email"
                  value={serverEmail}
                  onChange={(e) => setServerEmail(e.target.value)}
                  required
                />
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Пароль"
                  value={serverPassword}
                  onChange={(e) => setServerPassword(e.target.value)}
                  required
                />
                <Button type="submit" disabled={login.isPending}>
                  {login.isPending ? "Входим…" : "Войти"}
                </Button>
              </form>
              {login.isError ? (
                <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {describeAuthError(login.error, "password")}
                </p>
              ) : null}
              <a
                href={returnTo === "/spaces" ? "/register" : `/register?next=${encodeURIComponent(returnTo)}`}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
              >
                <UserPlus className="h-4 w-4" />
                Новая учётная запись
              </a>
            </>
          ) : selected ? (
            <>
              <button
                type="button"
                className="mb-4 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelected(null);
                  setSecret("");
                  login.reset();
                }}
              >
                ← Другая учётная запись
              </button>
              <div className="mb-4 flex items-center gap-3">
                <AccountAvatar userId={selected.id} name={selected.name} hasAvatar={selected.hasAvatar} size={48} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{selected.name}</p>
                  <p className="truncate text-2xs text-subtle-foreground">
                    {selected.workspaces.map((space) => space.name).join(" · ") || "Нет пространств"}
                  </p>
                </div>
              </div>
              {selected.unlockKind === "pin" ? (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">PIN из 4 цифр</p>
                  <div className="mb-3 flex justify-center gap-2">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={`h-3 w-3 rounded-full border border-border ${i < secret.length ? "bg-accent" : ""}`}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key) =>
                      key === "" ? (
                        <span key="pad" />
                      ) : (
                        <button
                          key={key}
                          type="button"
                          className="rounded-xl border border-border py-3 text-sm text-foreground hover:bg-white/5"
                          onClick={() => {
                            if (key === "⌫") setSecret((s) => s.slice(0, -1));
                            else onPinDigit(key);
                          }}
                        >
                          {key}
                        </button>
                      )
                    )}
                  </div>
                </>
              ) : (
                <form className="flex flex-col gap-3" onSubmit={(e) => void unlock(e)}>
                  <Input
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    placeholder="Пароль"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={login.isPending}>
                    {login.isPending ? "Входим…" : "Войти"}
                  </Button>
                </form>
              )}
              {login.isError ? (
                <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {describeAuthError(login.error, selected.unlockKind === "pin" ? "pin" : "password")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1 className="mb-1 text-lg font-semibold text-foreground">Кто входит?</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Учётная запись — это вы. Пространства внутри неё — отдельные хранилища.
              </p>
              {accounts.isLoading ? (
                <p className="text-sm text-muted-foreground">Загружаем учётные записи…</p>
              ) : accounts.isError ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Не удаётся связаться с сервером — это не значит, что учётных записей нет.
                  </p>
                  <button
                    type="button"
                    onClick={() => void accounts.refetch()}
                    className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-white/5"
                  >
                    Повторить
                  </button>
                </>
              ) : list.length === 0 ? (
                <p className="text-sm text-muted-foreground">Пока никого нет — создайте первую учётку.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(account);
                          setSecret("");
                          login.reset();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-border bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-white/[0.06]"
                      >
                        <AccountAvatar userId={account.id} name={account.name} hasAvatar={account.hasAvatar} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{account.name}</span>
                          <span className="block truncate text-2xs text-subtle-foreground">
                            {account.workspaces.map((space) => space.name).join(" · ") || "Нет пространств"}
                            {account.unlockKind === "pin" ? " · PIN" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <a
                href={returnTo === "/spaces" ? "/register" : `/register?next=${encodeURIComponent(returnTo)}`}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
              >
                <UserPlus className="h-4 w-4" />
                Новая учётная запись
              </a>
            </>
          )}
        </SpotlightCard>
      </motion.div>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={<AuroraBackground />}>
      <LoginContent />
    </Suspense>
  );
}
