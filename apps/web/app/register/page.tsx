"use client";

import { useOrionMode, useRegister, useSession } from "@orion/core-react";
import { Button, Input } from "@orion/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { AuthShell } from "../../components/auth-shell";
import { describeAuthError } from "../../lib/error-message";
import { sanitizeReturnTo } from "../../lib/return-to";

/**
 * `useSearchParams()` (for the `next` return-to param, S22) needs a
 * `<Suspense>` boundary under Next 14's app router or the desktop
 * `output: "export"` build fails — see `RegisterPage` below.
 */
function RegisterContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("next")) ?? "/spaces";
  const { user, isLoading } = useSession();
  const register = useRegister();
  // S05: server mode rejects PIN registration server-side (400) — hide the
  // toggle so the UI doesn't offer an option that will fail, same reasoning
  // as the login picker. Defaults to allowing PIN (fail-open toward local
  // mode, the common case) while the mode request is in flight/unknown.
  const orionMode = useOrionMode();
  const isServerMode = orionMode.data?.mode === "server";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [unlock, setUnlock] = useState<"password" | "pin">("password");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (!isLoading && user) router.replace(returnTo);
  }, [isLoading, user, router, returnTo]);

  useEffect(() => {
    if (isServerMode && unlock === "pin") setUnlock("password");
  }, [isServerMode, unlock]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await register.mutateAsync({
        name,
        email: email.trim() || undefined,
        ...(unlock === "pin" && !isServerMode ? { pin } : { password })
      });
    } catch {
      return;
    }
    router.replace(returnTo);
  }

  return (
    <AuthShell
      title="Новая учётная запись"
      subtitle="Для локальной работы достаточно имени и пароля или PIN из 4 цифр. Email не обязателен."
      footer={
        <>
          Уже есть учётка?{" "}
          <a className="text-foreground underline" href={returnTo === "/spaces" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`}>
            Выбрать
          </a>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <Input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          type="email"
          placeholder="Email (необязательно)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {isServerMode ? null : (
          <div className="flex gap-2">
            <Button type="button" variant={unlock === "password" ? "primary" : "outline"} onClick={() => setUnlock("password")}>
              Пароль
            </Button>
            <Button type="button" variant={unlock === "pin" ? "primary" : "outline"} onClick={() => setUnlock("pin")}>
              PIN
            </Button>
          </div>
        )}
        {unlock === "pin" && !isServerMode ? (
          <Input
            inputMode="numeric"
            autoComplete="off"
            placeholder="4 цифры"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            required
          />
        ) : (
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Пароль (мин. 8 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        )}
        {register.isError ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {describeAuthError(register.error)}
          </p>
        ) : null}
        <Button type="submit" disabled={register.isPending}>
          {register.isPending ? "Создаём…" : "Создать и войти"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function RegisterPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
