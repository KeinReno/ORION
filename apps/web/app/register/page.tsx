"use client";

import { useRegister } from "@orion/core-react";
import { Button, Card, Input } from "@orion/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";

export default function RegisterPage(): React.ReactElement {
  const router = useRouter();
  const register = useRegister();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await register.mutateAsync({ name, email, password });
    router.replace("/dashboard");
  }

  return (
    <div className="flex h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">Регистрация в ORION</h1>
        <p className="mb-6 text-sm text-white/50">Создаст личное рабочее пространство автоматически.</p>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input
            type="password"
            placeholder="Пароль (мин. 8 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {register.isError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {describeAuthError(register.error)}
            </p>
          ) : null}
          <Button type="submit" disabled={register.isPending}>
            {register.isPending ? "Создаём…" : "Зарегистрироваться"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-white/50">
          Уже есть аккаунт?{" "}
          <a className="text-white underline" href="/login">
            Войти
          </a>
        </p>
      </Card>
    </div>
  );
}
