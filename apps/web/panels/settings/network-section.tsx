"use client";

import {
  useActivateLanClient,
  useApproveLanPair,
  useDenyLanPair,
  useCloseLanFirewall,
  useDisableLanHost,
  useDiscoverLanNodes,
  useEnableLanHost,
  useLanDevices,
  useLanHost,
  useLanPendingPairs,
  useLanPinAccounts,
  usePollLanPairing,
  useOpenLanFirewall,
  useRevokeLanDevice,
  useStartLanPairing
} from "@orion/core-react";
import type { LanClientStatus, LanDiscoveredNode } from "@orion/shared-types";
import { LAN_DEFAULT_PORT } from "@orion/shared-types";
import { Badge, Button, Card, Input, useToast } from "@orion/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";
import { deactivateClient, fetchClientStatus, forgetNodeBinding } from "../../lib/lan-local";
import { writeNodeMark } from "../../lib/node-mode";

const LINK_LABEL: Record<LanClientStatus["link"], string> = {
  online: "в сети",
  offline: "узел не в сети",
  revoked: "доступ отозван владельцем",
  none: "—"
};

/**
 * ТЗ-04 «Сеть и устройства»: три режима — Локальный (по умолчанию), Хост LAN, Клиент LAN. Состояние клиента читается
 * у локального API напрямую (в режиме клиента ApiClient смотрит на чужой узел), а управление хостом идёт через ApiClient.
 */
export function NetworkSettings(): React.ReactElement {
  const [status, setStatus] = useState<LanClientStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchClientStatus();
      setStatus(next);
      setError(null);
      // Истина — файл узла; отметка окна подгоняется под неё (иначе окно ходило бы не туда).
      const wantsClient = next.mode === "client" && next.paired;
      if (wantsClient) writeNodeMark({ mode: "client", nodeId: next.paired!.nodeId, name: next.paired!.name });
    } catch {
      setError("Локальный сервер ORION не отвечает.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (error) return <p className="text-label text-danger">{error}</p>;
  if (!status) return <p className="text-label text-muted-foreground">Загрузка…</p>;
  return status.mode === "client" ? <ClientActive status={status} /> : <LocalOrHost status={status} onChanged={() => void refresh()} />;
}

function ClientActive({ status }: { status: LanClientStatus }): React.ReactElement {
  const { toast } = useToast();
  const node = status.paired;
  async function goLocal(forget: boolean): Promise<void> {
    try {
      await deactivateClient();
      if (forget) await forgetNodeBinding();
      writeNodeMark(null);
      window.location.assign("/");
    } catch {
      toast({ title: "Не удалось вернуться в «Локальный»", tone: "danger" });
    }
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium">Клиент LAN</span>
          <Badge>{node?.name ?? "узел"}</Badge>
          <Badge>{LINK_LABEL[status.link]}</Badge>
        </div>
        <p className="text-label text-muted-foreground">
          Окно ORION работает с общим узлом {node ? `${node.address}:${node.port}` : ""}. Аккаунты и данные принадлежат хосту; локальная база этого компьютера не используется и не изменяется.
        </p>
        {node ? <p className="break-all font-mono text-2xs text-subtle-foreground">Отпечаток сертификата: {node.fingerprint}</p> : null}
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void goLocal(false)}>Вернуться в «Локальный»</Button>
        <Button size="sm" variant="ghost" onClick={() => void goLocal(true)}>Вернуться и забыть узел</Button>
      </div>
    </div>
  );
}

function LocalOrHost({ status, onChanged }: { status: LanClientStatus; onChanged: () => void }): React.ReactElement {
  const host = useLanHost();
  const hostOn = host.data?.mode === "host";
  return (
    <div className="space-y-6">
      <Card className="space-y-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium">Режим этого компьютера</span>
          <Badge>{hostOn ? "Хост LAN" : "Локальный"}</Badge>
        </div>
        <p className="text-label text-muted-foreground">
          «Локальный» — данные только на этом компьютере, сеть закрыта. «Хост LAN» — другие устройства вашей сети подключаются к этому узлу. «Клиент LAN» — это окно работает с узлом другого компьютера.
        </p>
      </Card>
      <HostSection />
      {hostOn ? null : <ClientConnect status={status} onChanged={onChanged} />}
    </div>
  );
}

function HostSection(): React.ReactElement {
  const host = useLanHost();
  const enable = useEnableLanHost();
  const disable = useDisableLanHost();
  const firewall = useOpenLanFirewall();
  const closeFirewall = useCloseLanFirewall();
  const { toast } = useToast();
  const hostOn = host.data?.mode === "host";
  const pinAccounts = useLanPinAccounts(!hostOn);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  if (host.isLoading || !host.data) return <p className="text-label text-muted-foreground">Загрузка…</p>;
  const data = host.data;

  async function onEnable(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const result = await enable.mutateAsync({ acknowledged: true, name: name.trim() || undefined, passwords });
      setConfirming(false);
      toast({
        title: result.restarting ? "Включаю «Хост LAN»…" : "Режим сохранён",
        description: result.restarting ? "Сервер перезапускается, окно переподключится само." : "Перезапустите ORION API, чтобы режим применился.",
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось включить хост", description: describeError(error), tone: "danger" });
    }
  }

  async function onDisable(): Promise<void> {
    try {
      // Правила брандмауэра убираем вместе с хостом (снова запрос прав администратора); отказ не мешает выключению.
      if (data.firewall === "present") await closeFirewall.mutateAsync().catch(() => undefined);
      const result = await disable.mutateAsync();
      toast({ title: result.restarting ? "Выключаю «Хост LAN»…" : "Режим сохранён", description: "Данные не затронуты.", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось выключить хост", description: describeError(error), tone: "danger" });
    }
  }

  if (!hostOn) {
    return (
      <div className="space-y-3">
        <h3 className="text-label font-medium">Хост LAN</h3>
        {!confirming ? (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Сделать этот компьютер хостом…</Button>
        ) : (
          <form onSubmit={(event) => void onEnable(event)} className="space-y-3">
            <Card className="space-y-2 border-warning/40 bg-warning/10 p-4 text-label">
              <p className="font-medium">Что изменится</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>API станет доступен в вашей локальной сети по HTTPS (порт {data.port}); PostgreSQL останется только на этом компьютере.</li>
                <li>Вход по PIN и список аккаунтов отключаются; нужен пароль не короче 12 символов или сочетание регистров, цифр и символов.</li>
                <li>Устройство получит доступ только после вашего подтверждения кодом из 6 цифр.</li>
                <li>Брандмауэр Windows спросит права администратора — порты молча не открываются.</li>
              </ul>
            </Card>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Имя узла (по умолчанию ${data.name})`} maxLength={80} />
            {pinAccounts.data && pinAccounts.data.length > 0 ? (
              <div className="space-y-2">
                <p className="text-label">Этим аккаунтам нужен пароль вместо PIN:</p>
                {pinAccounts.data.map((account) => (
                  <label key={account.userId} className="flex items-center gap-2 text-label">
                    <span className="w-40 shrink-0 truncate">{account.name}</span>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={passwords[account.userId] ?? ""}
                      onChange={(event) => setPasswords((prev) => ({ ...prev, [account.userId]: event.target.value }))}
                      placeholder="Новый пароль"
                    />
                  </label>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={enable.isPending}>Включить хост LAN</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Отмена</Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium">{data.name}</span>
          <Badge>{data.active ? "работает" : "ждёт перезапуска"}</Badge>
          <Badge>{data.mdns ? "виден по mDNS" : "только по адресу"}</Badge>
        </div>
        <p className="text-label text-muted-foreground">
          Адрес для подключения: {data.addresses.length ? data.addresses.map((address) => `${address}:${data.port}`).join(", ") : `порт ${data.port}`}
        </p>
        <p className="break-all font-mono text-2xs text-subtle-foreground">Отпечаток сертификата: {data.fingerprint}</p>
        {!data.active ? <p className="text-label text-warning">Режим сохранён, но этот процесс API ещё не перезапущен — перезапустите ORION.</p> : null}
        {data.firewall === "missing" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label text-warning">Правила брандмауэра не созданы: другие устройства не смогут подключиться.</span>
            <Button
              size="sm"
              variant="outline"
              disabled={firewall.isPending}
              onClick={() =>
                void firewall.mutateAsync().then((result) => toast({ title: result.ok ? "Правила брандмауэра созданы" : "Права не получены", tone: result.ok ? "success" : "danger" }))
              }
            >
              Открыть для частной сети…
            </Button>
          </div>
        ) : null}
        <div>
          <Button size="sm" variant="outline" onClick={() => void onDisable()} disabled={disable.isPending}>Выключить хост LAN</Button>
        </div>
      </Card>
      {data.active ? <PendingPairs /> : null}
      <Devices />
    </div>
  );
}

function PendingPairs(): React.ReactElement | null {
  const pairs = useLanPendingPairs();
  const approve = useApproveLanPair();
  const deny = useDenyLanPair();
  const { toast } = useToast();
  const [codes, setCodes] = useState<Record<string, string>>({});
  if (!pairs.data || pairs.data.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-label font-medium">Запросы на подключение</h3>
      {pairs.data.map((pair) => (
        <Card key={pair.id} className="space-y-2 border-accent/40 p-4">
          <p className="text-body">
            «{pair.deviceName}» <span className="text-label text-muted-foreground">({pair.address})</span> просит доступ
          </p>
          <p className="text-label text-muted-foreground">Введите код, который сейчас показан на экране этого устройства. Совпал — подтверждайте. Не ждали запроса — отклоните.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-32 font-mono tracking-widest"
              inputMode="numeric"
              maxLength={6}
              value={codes[pair.id] ?? ""}
              onChange={(event) => setCodes((prev) => ({ ...prev, [pair.id]: event.target.value.replace(/\D/g, "") }))}
              placeholder="000000"
              aria-label="Код с экрана устройства"
            />
            <Button
              size="sm"
              disabled={(codes[pair.id] ?? "").length !== 6 || approve.isPending}
              onClick={() =>
                void approve
                  .mutateAsync({ id: pair.id, input: { code: codes[pair.id]! } })
                  .then(() => toast({ title: "Устройство подключено", tone: "success" }))
                  .catch((error) => toast({ title: "Код не принят", description: describeError(error), tone: "danger" }))
              }
            >
              Подтвердить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void deny.mutateAsync(pair.id)}>Отклонить</Button>
            <span className="text-2xs text-subtle-foreground">Попыток: {pair.attemptsLeft}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Devices(): React.ReactElement {
  const devices = useLanDevices();
  const revoke = useRevokeLanDevice();
  const { toast } = useToast();
  return (
    <div className="space-y-2">
      <h3 className="text-label font-medium">Доверенные устройства</h3>
      {devices.data && devices.data.length === 0 ? <p className="text-label text-muted-foreground">Пока ни одно устройство не подключено.</p> : null}
      {devices.data?.map((device) => (
        <Card key={device.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div>
            <p className="text-body">{device.name}</p>
            <p className="text-2xs text-subtle-foreground">
              Подключено {shortDateTime(device.createdAt)} · {device.lastSeenAt ? `активно ${shortDateTime(device.lastSeenAt)}` : "ещё не заходило"}
              {device.lastAddress ? ` · ${device.lastAddress}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void revoke.mutateAsync(device.id).then(() => toast({ title: "Доступ отозван", description: "Устройство отключено сразу.", tone: "success" }))}
          >
            Отозвать
          </Button>
        </Card>
      ))}
    </div>
  );
}

function ClientConnect({ status, onChanged }: { status: LanClientStatus; onChanged: () => void }): React.ReactElement {
  const discover = useDiscoverLanNodes();
  const start = useStartLanPairing();
  const activate = useActivateLanClient();
  const { toast } = useToast();
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(LAN_DEFAULT_PORT));
  const [deviceName, setDeviceName] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const pairing = usePollLanPairing(pairingId);
  const current = pairing.data ?? start.data ?? null;

  useEffect(() => {
    if (current?.status !== "approved") return;
    void (async () => {
      try {
        await activate.mutateAsync();
        writeNodeMark({ mode: "client", nodeId: current.node.nodeId, name: current.node.name });
        window.location.assign("/");
      } catch (error) {
        toast({ title: "Не удалось переключиться на узел", description: describeError(error), tone: "danger" });
        onChanged();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status]);

  async function connect(target: { address: string; port: number }): Promise<void> {
    try {
      const result = await start.mutateAsync({ address: target.address, port: target.port, deviceName: deviceName.trim() || "Этот компьютер" });
      setPairingId(result.pairingId);
    } catch (error) {
      toast({ title: "Не удалось подключиться", description: describeError(error), tone: "danger" });
    }
  }

  function pick(node: LanDiscoveredNode): void {
    setAddress(node.address);
    setPort(String(node.port));
  }

  return (
    <div className="space-y-3">
      <h3 className="text-label font-medium">Подключиться к другому узлу (Клиент LAN)</h3>
      {status.paired ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
          <span className="text-label">Ранее подключён: {status.paired.name} ({status.paired.address}:{status.paired.port})</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void activate.mutateAsync().then(() => {
                writeNodeMark({ mode: "client", nodeId: status.paired!.nodeId, name: status.paired!.name });
                window.location.assign("/");
              })
            }
          >
            Переключиться
          </Button>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={discover.isPending} onClick={() => void discover.mutateAsync()}>
          {discover.isPending ? "Ищу…" : "Найти узлы в сети"}
        </Button>
      </div>
      {discover.data ? (
        discover.data.length === 0 ? (
          <p className="text-label text-muted-foreground">Узлы не найдены. Некоторые роутеры не пропускают mDNS — введите адрес вручную.</p>
        ) : (
          discover.data.map((node) => (
            <Card key={node.nodeId} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="text-body">{node.name}</p>
                <p className="text-2xs text-subtle-foreground">Найден · требуется подключение · {node.address}:{node.port}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => pick(node)}>Выбрать</Button>
            </Card>
          ))
        )
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void connect({ address: address.trim(), port: Number(port) || LAN_DEFAULT_PORT });
        }}
      >
        <Input className="w-48" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Адрес, например 192.168.1.20" aria-label="Адрес узла" required />
        <Input className="w-24" value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))} aria-label="Порт" />
        <Input className="w-48" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Имя этого устройства" aria-label="Имя этого устройства" maxLength={80} />
        <Button type="submit" size="sm" disabled={start.isPending || !address.trim()}>Подключиться</Button>
      </form>
      {current && current.status !== "approved" ? (
        <Card className="space-y-2 p-4">
          <p className="text-label text-muted-foreground">Узел «{current.node.name}». Сообщите владельцу этот код — он введёт его на своём компьютере:</p>
          <p className="font-mono text-3xl tracking-[0.3em]">{current.code}</p>
          <p className="text-label">
            {current.status === "pending" ? "Жду подтверждения владельца…" : current.status === "denied" ? "Владелец отклонил подключение." : "Время заявки истекло — начните заново."}
          </p>
          <p className="break-all font-mono text-2xs text-subtle-foreground">Отпечаток сертификата: {current.node.fingerprint}</p>
        </Card>
      ) : null}
    </div>
  );
}
