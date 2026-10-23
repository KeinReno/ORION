"use client";

import { LAN_PAIR_SECRET_HEADER, lanNodeCardSchema, lanPairRequestCreatedSchema, lanPairStatusSchema, lanPairingCodeInput, pairingCodeFromDigest } from "@orion/shared-types";
import { Button, EmptyState, Input } from "@orion/ui";
import { useState } from "react";
import { writePhoneDeviceToken } from "./phone-device";

async function pairingCode(clientNonce: string, serverNonce: string, fingerprint: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("orion-lan-pairing"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(lanPairingCodeInput(clientNonce, serverNonce, fingerprint)));
  return pairingCodeFromDigest(new Uint8Array(signature));
}

function nonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Телефон представляется компьютеру. Код считается из отпечатка, который прислал сам узел
 * по тому же адресу: его нужно сверить с отпечатком в «Сеть и устройства» на компьютере.
 */
export function PhonePair({ onPaired }: { onPaired: () => void }): React.ReactElement {
  const [name, setName] = useState("Телефон");
  const [phase, setPhase] = useState<"ask" | "wait" | "fail">("ask");
  const [code, setCode] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [message, setMessage] = useState("");

  async function start(): Promise<void> {
    setMessage("");
    const origin = window.location.origin;
    const info = await fetch(`${origin}/lan/info`).then((response) => response.json()).catch(() => null);
    const card = lanNodeCardSchema.safeParse(info);
    if (!card.success) {
      setPhase("fail");
      setMessage("По этому адресу ORION не отвечает. На компьютере включите «Хост LAN» и откройте ссылку оттуда.");
      return;
    }
    const clientNonce = nonce();
    const createdRaw = await fetch(`${origin}/lan/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: name.trim() || "Телефон", clientNonce })
    }).then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) }));
    const created = lanPairRequestCreatedSchema.safeParse(createdRaw.body);
    if (!createdRaw.ok || !created.success) {
      setPhase("fail");
      setMessage("Компьютер не принял заявку. Проверьте, что режим «Хост LAN» включён.");
      return;
    }
    setNodeName(card.data.name);
    setFingerprint(card.data.fingerprint);
    setCode(await pairingCode(clientNonce, created.data.serverNonce, card.data.fingerprint));
    setPhase("wait");
    const timer = window.setInterval(async () => {
      const response = await fetch(`${origin}/lan/pair/status/${created.data.requestId}`, {
        headers: { [LAN_PAIR_SECRET_HEADER]: clientNonce }
      }).catch(() => null);
      const body = lanPairStatusSchema.safeParse(response ? await response.json().catch(() => null) : null);
      if (!body.success) return;
      if (body.data.status === "approved" && body.data.deviceToken) {
        window.clearInterval(timer);
        writePhoneDeviceToken(body.data.deviceToken);
        onPaired();
      } else if (body.data.status === "denied" || body.data.status === "expired") {
        window.clearInterval(timer);
        setPhase("fail");
        setMessage(body.data.status === "denied" ? "На компьютере заявку отклонили." : "Время кода вышло. Запросите ещё раз.");
      }
    }, 2000);
  }

  if (phase === "wait") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-8">
        <h1 className="text-xl font-semibold">{nodeName}</h1>
        <p className="text-sm text-muted-foreground">На компьютере откройте «Настройки → Сеть и устройства» и введите этот код. Сверьте отпечаток: он должен совпасть с тем, что написан там.</p>
        <p className="text-center font-mono text-4xl tracking-[0.3em]">{code}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">{fingerprint}</p>
        <p className="text-sm text-muted-foreground">Ждём подтверждение. После него телефон читает и записывает данные этого компьютера.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Подключить телефон</h1>
      <p className="text-sm text-muted-foreground">Этот телефон ещё не известен компьютеру. Назовите его и подтвердите кодом на компьютере.</p>
      {phase === "fail" ? <EmptyState tone="danger" title="Не подключилось" description={message} /> : null}
      <label className="space-y-1 text-sm">
        Имя устройства
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <Button type="button" onClick={() => void start()}>Показать код</Button>
    </main>
  );
}
