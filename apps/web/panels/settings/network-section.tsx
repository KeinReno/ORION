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
  useSetLanLoginPolicy,
  useStartLanPairing
} from "@orion/core-react";
import type { LanClientStatus, LanLoginPolicy } from "@orion/shared-types";
import { LAN_DEFAULT_PORT } from "@orion/shared-types";
import { Badge, Button, Card, Input, useToast } from "@orion/ui";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
      setError("Локальный сервер ORION не отвечает. Если режим узла только что менялся, он перезапускается — подождите несколько секунд.");
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
          Сейчас вы работаете с данными этого компьютера. Можно подключиться к другому компьютеру в своей сети или разрешить подключения к этому.
        </p>
      </Card>
      {hostOn ? null : <ClientConnect status={status} onChanged={onChanged} />}
      <HostSection />
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
  const [policy, setPolicy] = useState<LanLoginPolicy>("home");
  const [port, setPort] = useState("");

  if (host.isLoading || !host.data) return <p className="text-label text-muted-foreground">Загрузка…</p>;
  const data = host.data;

  async function onEnable(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const chosenPort = port.trim() ? Number(port) : undefined;
      if (chosenPort !== undefined && (!Number.isInteger(chosenPort) || chosenPort < 1024 || chosenPort > 65535)) {
        toast({ title: "Порт — число от 1024 до 65535", tone: "danger" });
        return;
      }
      const result = await enable.mutateAsync({ acknowledged: true, name: name.trim() || undefined, passwords: policy === "strict" ? passwords : {}, loginPolicy: policy, port: chosenPort });
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
        <h3 className="text-label font-medium">Приём подключений на этом компьютере</h3>
        <p className="text-label text-muted-foreground">Включите, чтобы другой компьютер в вашей сети мог подключиться к ORION. Каждое новое устройство нужно подтвердить кодом.</p>
        {!confirming ? (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Разрешить подключения…</Button>
        ) : (
          <form onSubmit={(event) => void onEnable(event)} className="space-y-3">
            <Card className="space-y-2 border-warning/40 bg-warning/10 p-4 text-label">
              <p className="font-medium">Что изменится</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>API станет доступен в вашей локальной сети по HTTPS (порт {data.port}); PostgreSQL останется только на этом компьютере.</li>
                <li>Политика входа выбирается ниже: «домашняя» (PIN, список аккаунтов, блокировка после серии неверных попыток; только устройства, подтверждённые вами кодом) или «строгая» (только email и пароль).</li>
                <li>Устройство получит доступ только после вашего подтверждения кодом из 6 цифр.</li>
                <li>Брандмауэр Windows спросит права администратора — порты молча не открываются.</li>
              </ul>
            </Card>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Имя узла (по умолчанию ${data.name})`} maxLength={80} />
            <label className="flex items-center gap-2 text-label">
              <span className="shrink-0 text-muted-foreground">Порт в сети</span>
              <Input
                value={port}
                onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder={String(data.port)}
                aria-label="Порт хоста в сети"
                className="w-28"
              />
              <span className="text-2xs text-subtle-foreground">другой — если этот занят другой программой</span>
            </label>
            <PolicyChoice value={policy} onChange={setPolicy} />
            {policy === "strict" && pinAccounts.data && pinAccounts.data.length > 0 ? (
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
          <Badge>{data.active ? "работает" : data.error ? "не запустился" : "ждёт перезапуска"}</Badge>
          <Badge>{data.mdns ? "виден по mDNS" : "только по адресу"}</Badge>
        </div>
        <p className="text-label text-muted-foreground">
          Адрес для подключения: {data.addresses.length ? data.addresses.map((address) => `${address}:${data.port}`).join(", ") : `порт ${data.port}`}
        </p>
        <p className="break-all font-mono text-2xs text-subtle-foreground">Отпечаток сертификата: {data.fingerprint}</p>
        {data.error ? (
          <p role="alert" className="text-label text-destructive">
            {data.error} Этот компьютер работает как обычно; другие устройства подключиться пока не смогут.
          </p>
        ) : !data.active ? (
          <p className="text-label text-warning">Режим сохранён, но этот процесс API ещё не перезапущен — перезапустите ORION.</p>
        ) : null}
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
        <HostPolicy current={data.loginPolicy} />
        <div>
          <Button size="sm" variant="outline" onClick={() => void onDisable()} disabled={disable.isPending}>Выключить хост LAN</Button>
        </div>
      </Card>
      {data.active ? <PendingPairs /> : null}
      <Devices />
    </div>
  );
}

const POLICY_TEXT: Record<LanLoginPolicy, { title: string; text: string }> = {
  home: {
    title: "Домашняя",
    text: "Вход по PIN или паролю от 8 символов, список аккаунтов на экране входа (только на устройствах, подтверждённых вами кодом). После 5 неверных попыток аккаунт блокируется на 15 минут."
  },
  strict: {
    title: "Строгая",
    text: "Как у сервера: только email и пароль (не короче 12 символов или сложный), без PIN и списка аккаунтов. Для узла, доступного из интернета."
  }
};

function PolicyChoice({ value, onChange }: { value: LanLoginPolicy; onChange: (value: LanLoginPolicy) => void }): React.ReactElement {
  return (
    <fieldset className="space-y-2">
      <legend className="text-label font-medium">Политика входа</legend>
      {(["home", "strict"] as const).map((item) => (
        <label key={item} className="flex cursor-pointer items-start gap-2 text-label">
          <input type="radio" name="login-policy" className="mt-0.5" checked={value === item} onChange={() => onChange(item)} />
          <span>
            <span className="font-medium">{POLICY_TEXT[item].title}</span>
            <span className="block text-muted-foreground">{POLICY_TEXT[item].text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function HostPolicy({ current }: { current: LanLoginPolicy }): React.ReactElement {
  const setPolicy = useSetLanLoginPolicy();
  const pinAccounts = useLanPinAccounts(true);
  const { toast } = useToast();
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const next: LanLoginPolicy = current === "home" ? "strict" : "home";
  const needPasswords = next === "strict" && (pinAccounts.data?.length ?? 0) > 0;

  async function change(): Promise<void> {
    try {
      await setPolicy.mutateAsync({ loginPolicy: next, passwords: next === "strict" ? passwords : {} });
      setPasswords({});
      toast({ title: `Политика входа: ${POLICY_TEXT[next].title.toLowerCase()}`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сменить политику входа", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-label">
        Политика входа: <span className="font-medium">{POLICY_TEXT[current].title}</span>
      </p>
      <p className="text-label text-muted-foreground">{POLICY_TEXT[current].text}</p>
      {needPasswords ? (
        <div className="space-y-2">
          <p className="text-label">При строгой политике этим аккаунтам нужен пароль вместо PIN:</p>
          {pinAccounts.data?.map((account) => (
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
      <Button size="sm" variant="outline" disabled={setPolicy.isPending} onClick={() => void change()}>
        Перейти на «{POLICY_TEXT[next].title.toLowerCase()}»
      </Button>
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
  const start = useStartLanPairing();
  const activate = useActivateLanClient();
  const { toast } = useToast();
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(LAN_DEFAULT_PORT));
  const [deviceName, setDeviceName] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const discover = useDiscoverLanNodes(pairingId === null);
  const pairing = usePollLanPairing(pairingId);
  const current = pairing.data ?? start.data ?? null;
  const resultRef = useRef<HTMLDivElement>(null);
  const busy = start.isPending || activate.isPending || current?.status === "pending";

  async function switchToNode(node: { nodeId: string; name: string }): Promise<void> {
    try {
      await activate.mutateAsync();
      writeNodeMark({ mode: "client", nodeId: node.nodeId, name: node.name });
      window.location.assign("/");
    } catch (error) {
      toast({ title: "Не удалось открыть компьютер", description: describeError(error), tone: "danger" });
      onChanged();
    }
  }

  useEffect(() => {
    if (current?.status === "approved") void switchToNode(current.node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status]);

  useEffect(() => { if (pairingId) resultRef.current?.focus(); }, [pairingId]);

  async function connect(target: { address: string; port: number }): Promise<void> {
    setPairingId(null);
    start.reset();
    try {
      const result = await start.mutateAsync({ address: target.address, port: target.port, deviceName: deviceName.trim() || "Этот компьютер" });
      setPairingId(result.pairingId);
    } catch (error) {
      toast({ title: "Не удалось подключиться", description: describeError(error), tone: "danger" });
    }
  }

  function retry(): void {
    setPairingId(null);
    start.reset();
  }

  return (
    <div className="space-y-3">
      <h3 className="text-body font-medium">Другой компьютер в вашей сети</h3>
      <p className="text-label text-muted-foreground">Выберите компьютер с ORION. Подтвердите подключение кодом на нём, затем войдите в свой профиль — откроются доступные вам пространства.</p>
      {status.paired ? (
        <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
          <span className="min-w-0 break-words text-label">Ранее подключён: {status.paired.name}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void switchToNode(status.paired!)}
          >
            Открыть компьютер
          </Button>
        </Card>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={discover.isFetching || busy} onClick={() => void discover.refetch()}>Обновить поиск</Button>
        <span className="self-center text-label text-muted-foreground" role="status">{discover.isFetching ? "Ищу компьютеры с ORION…" : ""}</span>
      </div>
      {discover.isError ? <p className="text-label text-danger" role="alert">Поиск не удался. Обновите поиск или подключитесь по адресу ниже.</p> : null}
      {!discover.isFetching && !discover.isError && discover.data ? (
        discover.data.length === 0 ? (
          <p className="text-label text-muted-foreground">Компьютеры пока не найдены. На другом компьютере откройте «Сеть и устройства» и включите приём подключений. Оба устройства должны быть в одной сети. Если поиск всё равно пуст, используйте адрес ниже.</p>
        ) : (
          discover.data.map((node) => (
            <Card key={node.nodeId} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-body">{node.name}</p>
                <p className="break-all text-2xs text-subtle-foreground">{node.address}:{node.port}</p>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void connect(node)}>Подключиться</Button>
            </Card>
          ))
        )
      ) : null}
      <details className="text-label">
        <summary className="cursor-pointer text-muted-foreground">Подключиться по адресу</summary>
        <p className="mt-2 text-muted-foreground">Адрес показан на другом компьютере в «Сеть и устройства», когда включён приём подключений.</p>
        <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void connect({ address: address.trim(), port: Number(port) });
        }}
      >
        <label className="min-w-0 flex-1 space-y-1">Адрес компьютера<Input name="address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="192.168.1.20" required /></label>
        <label className="w-24 space-y-1">Порт<Input name="port" type="number" min={1} max={65535} step={1} required value={port} onChange={(event) => setPort(event.target.value)} /></label>
        <Button type="submit" size="sm" disabled={busy || !address.trim()}>Подключиться по адресу</Button>
        </form>
      </details>
      <details className="text-label">
        <summary className="cursor-pointer text-muted-foreground">Имя этого устройства</summary>
        <Input className="mt-2 max-w-xs" name="deviceName" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Этот компьютер" aria-label="Имя этого устройства" maxLength={80} disabled={busy} />
      </details>
      {current ? (
        <div ref={resultRef} tabIndex={-1} className="space-y-2 rounded-lg border border-border p-4 focus:outline-none" aria-label="Подключение компьютера">
          <p className="break-words text-body font-medium">{current.node.name}</p>
          {current.status === "pending" ? <>
            <p className="text-label text-muted-foreground">На компьютере «{current.node.name}» откройте «Сеть и устройства» и в запросе на подключение введите этот код:</p>
            <p className="font-mono text-3xl tracking-widest" aria-label={`Код подключения: ${current.code.split("").join(" ")}`}>{current.code}</p>
          </> : null}
          <p className="text-label" role="status">{current.status === "pending" ? "Ожидаю подтверждения…" : current.status === "approved" ? "Подключение подтверждено. Открываю компьютер…" : current.status === "denied" ? "Подключение отклонено на другом компьютере." : current.status === "expired" ? "Время заявки истекло." : "Связь прервалась. Проверьте, что другой компьютер включён и ORION запущен."}</p>
          {pairing.isError ? <p className="text-label text-danger" role="alert">Не удалось проверить подтверждение. Повторяю проверку…</p> : null}
          {current.status === "approved" && activate.isError ? <Button size="sm" variant="outline" disabled={activate.isPending} onClick={() => void switchToNode(current.node)}>Повторить открытие</Button> : null}
          {current.status !== "pending" && current.status !== "approved" ? <Button size="sm" variant="outline" onClick={retry}>Выбрать компьютер заново</Button> : null}
          <details className="text-2xs text-subtle-foreground"><summary className="cursor-pointer">Данные подключения</summary><p className="mt-1 break-all font-mono">Сертификат: {current.node.fingerprint}</p></details>
        </div>
      ) : null}
    </div>
  );
}
