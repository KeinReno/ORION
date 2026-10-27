"use client";

import { KaidenLogo } from "../../components/kaiden-logo";

import { useAuthAccounts, useLogin, useOrionMode, useSession } from "@orion/core-react";
import type { AccountPublic } from "@orion/shared-types";
import { AuroraBackground, Button, Input, Spinner, SpotlightCard, useUiSound } from "@orion/ui";
import { motion } from "framer-motion";
import { UserPlus } from "lucide-react";
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
  const isServerMode = orionMode.data?.loginPolicy === "strict";
  const accounts = useAuthAccounts(!isServerMode);
  const login = useLogin();
  const { play } = useUiSound();
  const [picked, setSelected] = useState<AccountPublic | null>(null);
  const [choosing, setChoosing] = useState(false);
  const list = accounts.data ?? [];
  const selected = picked ?? (!choosing && list.length === 1 ? list[0] : null);
  const [secret, setSecret] = useState("");
  // Server mode: no directory, no PIN — a named email+password form instead.
  const [serverEmail, setServerEmail] = useState("");
  const [serverPassword, setServerPassword] = useState("");

  useEffect(() => {
    if (!isLoading && user) router.replace(returnTo);
  }, [isLoading, user, router, returnTo]);

  async function unlock(event?: FormEvent, pin?: string): Promise<void> {
    event?.preventDefault();
    if (!selected || login.isPending) return;
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
    play("auth.login");
    router.replace(returnTo);
  }

  function onPinChange(value: string): void {
    if (!selected || login.isPending) return;
    const next = value.replace(/\D/g, "").slice(0, 4);
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
    play("auth.login");
    router.replace(returnTo);
  }

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
            <KaidenLogo className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight text-foreground">ORION</span>
          </div>

          {isServerMode ? (
            <>
              <h1 className="mb-1 text-lg font-semibold text-foreground">Вход</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                Войдите в свой профиль на сервере.
              </p>
              <form className="flex flex-col gap-3" onSubmit={(e) => void unlockServer(e)}>
                <Input
                  type="email"
                  name="email"
                  aria-label="Почта"
                  autoFocus
                  autoComplete="username"
                  placeholder="Email"
                  value={serverEmail}
                  onChange={(e) => setServerEmail(e.target.value)}
                  required
                />
                <Input
                  type="password"
                  name="password"
                  aria-label="Пароль"
                  autoComplete="current-password"
                  placeholder="Пароль"
                  value={serverPassword}
                  onChange={(e) => setServerPassword(e.target.value)}
                  required
                />
                <Button type="submit" disabled={login.isPending}>
                  {login.isPending ? <><Spinner /> Входим…</> : "Войти"}
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
          ) : !orionMode.isLoading && !accounts.isLoading && selected ? (
            <>
              <button
                type="button"
                className="mb-4 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelected(null);
                  setChoosing(true);
                  setSecret("");
                  login.reset();
                }}
              >
                ← Другой профиль
              </button>
              <div className="mb-4 flex items-center gap-3">
                <AccountAvatar userId={selected.id} name={selected.name} hasAvatar={selected.hasAvatar} size={48} />
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold text-foreground">{selected.name}</h1>
                </div>
              </div>
              {selected.unlockKind === "pin" ? (
                <>
                  <label className="mb-4 block space-y-2 text-sm text-muted-foreground">
                    <span>Введите PIN</span>
                    <Input key={selected.id} type="password" name="pin" aria-label="PIN" inputMode="numeric" autoComplete="off" autoFocus maxLength={4}
                      value={secret} readOnly={login.isPending} onChange={(event) => onPinChange(event.target.value)}
                      className="text-center text-xl tracking-[0.5em]" />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key) =>
                      key === "" ? (
                        <span key="pad" />
                      ) : (
                        <button
                          key={key}
                          type="button"
                          aria-label={key === "⌫" ? "Стереть цифру" : key}
                          disabled={login.isPending}
                          className="min-h-12 rounded-xl border border-border py-3 text-base text-foreground hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                          onClick={() => {
                            if (key === "⌫") setSecret((s) => s.slice(0, -1));
                            else if (secret.length < 4) onPinChange(secret + key);
                          }}
                        >
                          {key}
                        </button>
                      )
                    )}
                  </div>
                  {login.isPending ? <p role="status" className="mt-3 text-center text-sm text-muted-foreground">Входим…</p> : null}
                </>
              ) : (
                <form className="flex flex-col gap-3" onSubmit={(e) => void unlock(e)}>
                  <Input
                    type="password"
                    name="password"
                    aria-label="Пароль"
                    autoFocus
                    autoComplete="current-password"
                    placeholder="Пароль"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={login.isPending}>
                    {login.isPending ? <><Spinner /> Входим…</> : "Войти"}
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
              <h1 className="mb-1 text-lg font-semibold text-foreground">{!accounts.isLoading && !accounts.isError && list.length === 0 ? "Добро пожаловать" : "Выберите профиль"}</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                {!accounts.isLoading && !accounts.isError && list.length === 0 ? "Создайте свой профиль, чтобы начать." : "Выберите, под каким именем войти."}
              </p>
              {orionMode.isLoading || accounts.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Загружаем учётные записи…</p>
              ) : accounts.isError ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Не удалось загрузить профили. Попробуйте ещё раз.
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
                <p className="text-sm text-muted-foreground">Достаточно имени и PIN из четырёх цифр.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(account);
                          setChoosing(false);
                          setSecret("");
                          login.reset();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-border bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-white/[0.06]"
                      >
                        <AccountAvatar userId={account.id} name={account.name} hasAvatar={account.hasAvatar} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{account.name}</span>
                          <span className="block truncate text-2xs text-subtle-foreground">
                            {account.unlockKind === "pin" ? "Вход по PIN" : "Вход по паролю"}
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
                Создать профиль
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
