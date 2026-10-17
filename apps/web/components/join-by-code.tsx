"use client";

import { useAcceptInvite } from "@orion/core-react";
import { Button, Card, Input } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { describeAuthError } from "../lib/error-message";

/** Достаёт код из «голого» кода или из вставленной ссылки `…/invite?token=КОД`. */
export function extractInviteCode(input: string): string {
  const trimmed = input.trim();
  try {
    const token = new URL(trimmed).searchParams.get("token");
    if (token) return token;
  } catch {
    // не ссылка — значит, это сам код
  }
  return trimmed;
}

/**
 * ТЗ-05 §5.2 — принять приглашение кодом (для устройства в LAN, где ссылку открыть негде).
 * Аккаунт нужен свой, с тем же email, на который выписано приглашение.
 */
export function JoinByCodeCard({ onJoined }: { onJoined: () => void }): React.ReactElement {
  const accept = useAcceptInvite();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await accept.mutateAsync(extractInviteCode(code));
      setCode("");
      onJoined();
    } catch (e) {
      setError(describeAuthError(e));
    }
  }

  return (
    <Card className="mt-4 space-y-2">
      <p className="text-sm font-medium text-foreground">Войти в общее пространство по коду</p>
      <p className="text-2xs text-muted-foreground">
        Код или ссылку даёт владелец пространства. Приглашение выписано на email — войдите в аккаунт с этим email.
      </p>
      <form className="flex gap-2" onSubmit={onSubmit}>
        <Input placeholder="Код или ссылка приглашения" value={code} onChange={(e) => setCode(e.target.value)} required />
        <Button type="submit" disabled={accept.isPending || !code.trim()}>
          Принять
        </Button>
      </form>
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
    </Card>
  );
}
