"use client";

import { useLogin } from "@orion/core-react";
import { Button, Card, Input } from "@orion/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await login.mutateAsync({ email, password });
    router.replace("/dashboard");
  }

  return (
    <div className="flex h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">Вход в ORION</h1>
        <p className="mb-6 text-sm text-white/50">Ядро запущено — можно заходить.</p>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {login.isError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {describeAuthError(login.error)}
            </p>
          ) : null}
          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? "Входим…" : "Войти"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-white/50">
          Нет аккаунта?{" "}
          <a className="text-white underline" href="/register">
            Зарегистрироваться
          </a>
        </p>
      </Card>
    </div>
  );
}
