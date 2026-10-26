import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { startForegroundSync } from "./foreground-sync";
import { observeNativeActivity } from "./native-activity";
import { useCallback, useEffect, useRef, useState } from "react";
import { MobileRemoteClient, type MobileRepository, type MobileSnapshot } from "@orion/mobile-core";
import type { LanDiscoveredNode, Workspace, AccountPublic } from "@orion/shared-types";
import { lan, nativeSyncTransport, type LanState, type Pairing } from "./lan";
import { replicaIO } from "./storage";

export function useLan(repository: MobileRepository | null, publish: (data: MobileSnapshot) => void) {
  const [nodes, setNodes] = useState<LanDiscoveredNode[]>([]);
  const [searched, setSearched] = useState(false);
  const [state, setState] = useState<LanState | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [client, setClient] = useState<MobileRemoteClient | null>(null);
  const [confirmation, setConfirmation] = useState<{ client: MobileRemoteClient; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [message, setMessage] = useState("");
  const [, redraw] = useState(0);
  const working = useRef(false);
  const autoRef = useRef<ReturnType<typeof startForegroundSync> | null>(null);
  const [driverEpoch, setDriverEpoch] = useState(0);
  const publishRef = useRef(publish); publishRef.current = publish;
  const current = useRef(client); current.current = client;
  useEffect(() => {
    if (!client) return;
    let previousPhase = client.engine.status().phase;
    return client.engine.subscribe(() => {
      const status = client.engine.status();
      if (previousPhase === "syncing" && status.phase === "idle" && status.hasCopy) {
        setConfirmation({ client, at: performance.now() });
      }
      previousPhase = status.phase;
      redraw((value) => value + 1);
    });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let foreground = !Capacitor.isNativePlatform();
    const auto = startForegroundSync(client, { active: () => foreground && document.visibilityState !== "hidden", blocked: () => working.current, error: setSyncError });
    autoRef.current = auto;
    const wake = () => { auto.wake(); };
    window.addEventListener("online",wake); window.addEventListener("focus",wake); document.addEventListener("visibilitychange",wake);
    const stopNative = Capacitor.isNativePlatform() ? observeNativeActivity(NativeApp, isActive => {
      foreground = isActive;
      setConfirmation(null);
      if (isActive) auto.wake();
    }) : null;
    return () => { void auto.stop(); stopNative?.(); if (autoRef.current === auto) autoRef.current = null; window.removeEventListener("online",wake); window.removeEventListener("focus",wake); document.removeEventListener("visibilitychange",wake); };
  }, [client, driverEpoch]);

  useEffect(() => {
    if (!repository) return;
    let active = true;
    void (async () => {
      try {
        const status = await lan.state();
        if (!active) return;
        setState(status);
        const selected = repository.snapshot().remoteSelection;
        if (selected && status.node?.nodeId === selected.nodeId && status.node.fingerprint === selected.fingerprint && status.user?.id === selected.userId) {
          const restored = await MobileRemoteClient.create(selected, replicaIO, nativeSyncTransport);
          if (active) setClient(restored);
        } else if (selected) {
          await replicaIO.clearAll(); await repository.clearRemote(); publishRef.current(repository.snapshot());
        }
        if (status.paired && !status.user) { const list = await lan.accounts(); if (active) setAccounts(list); }
        if (status.user) { const list = await lan.workspaces(); if (active) setWorkspaces(list); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Компьютер недоступен. Локальная копия остаётся доступной."); }
    })();
    return () => { active = false; };
  }, [repository]);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось выполнить действие. Повторите."); }
    finally { working.current = false; setBusy(false); autoRef.current?.wake(); }
  }, []);
  const discover = useCallback(() => run(async () => {
    setNodes([]); setSearched(false);
    const found = await lan.discover(); setNodes(found); setSearched(true);
    // Only remembered identity may reconnect automatically. Native code verifies the saved TLS pin.
    const saved = await lan.state();
    const matching = saved.paired && saved.node ? found.find((node) => node.nodeId === saved.node!.nodeId && node.fingerprint === saved.node!.fingerprint) : null;
    if (matching) { setState(await lan.reconnect(matching.address, matching.port)); setMessage("Доверенный компьютер найден. Его сертификат проверен; адрес обновлён."); }
  }), [run]);
  const reconnect = (address: string, port: number) => run(async () => {
    setState(await lan.reconnect(address, port)); setMessage("Сертификат и ID сохранённого компьютера проверены. Адрес обновлён.");
  });
  const begin = (address: string, port: number) => run(async () => {
    setPairing(await lan.begin(address, port));
  });
  const poll = useCallback(() => run(async () => {
    const result = await lan.poll();
    if (result.status === "approved") {
      const status = await lan.state(); setState(status); setPairing(null);
      setAccounts(await lan.accounts()); setMessage("Компьютер подтвердил телефон. Теперь войдите в учётную запись.");
    } else {
      setPairing((previous) => previous ? { ...previous, status: result.status } : null);
      if (result.status === "denied" || result.status === "expired") setError("Заявка отклонена или истекла. Начните подключение снова.");
    }
  }), [run]);
  useEffect(() => {
    if (pairing?.status !== "pending") return;
    const timer = setInterval(() => { void poll(); }, 3000);
    return () => clearInterval(timer);
  }, [pairing?.status, poll]);

  const login = (credentials: Record<string, string>) => run(async () => {
    setState(await lan.login(credentials));
    setWorkspaces(await lan.workspaces()); setMessage("Вход выполнен. Выберите пространство компьютера.");
  });
  const connect = (workspace: Workspace) => run(async () => {
    if (!repository || !state?.node || !state.user) return;
    const mode = await lan.mode(workspace.id);
    if (mode.mode !== "hybrid") throw new Error("На ПК откройте «Синхронизация» → «Режим пространства и устройства», выберите гибридный режим для этого пространства, затем повторите.");
    const selection = { nodeId: state.node.nodeId, fingerprint: state.node.fingerprint, userId: state.user.id, workspaceId: workspace.id, workspaceName: workspace.name };
    const selected = await MobileRemoteClient.create(selection, replicaIO, nativeSyncTransport);
    await selected.sync();
    if (!selected.engine.hasCopy()) throw new Error(selected.engine.status().message ?? "Не удалось загрузить пространство");
    await repository.setRemote(selection, true); publishRef.current(repository.snapshot()); setClient(selected);
    if (selected.engine.status().phase === "idle") setConfirmation({ client: selected, at: performance.now() });
    setMessage(selected.engine.status().phase === "idle" ? "Пространство ПК открыто. Задачи, заметки и списки обмениваются автоматически, пока Orion открыт." : "Открыта сохранённая копия. Подтверждения от ПК пока нет — проверьте статус обмена.");
  });
  const sync = () => run(async () => {
    const selected = current.current;
    if (!selected) throw new Error("Сначала выберите пространство компьютера");
    await selected.sync();
    const status = selected.engine.status();
    if (status.phase === "revoked" && repository) {
      await replicaIO.clearAll(); await repository.clearRemote(); publishRef.current(repository.snapshot());
      setClient(null); setState(await lan.state());
      throw new Error("Доступ отозван. Копии компьютера удалены; записи «На телефоне» сохранены.");
    }
    if (status.phase !== "idle") throw new Error(status.message ?? "Компьютер недоступен. Изменения остаются в очереди.");
    setMessage(status.conflicts ? "Есть конфликты изменений — проверьте их ниже." : status.pending ? "Обмен выполнен, но часть изменений остаётся в очереди." : "Изменения пространства подтверждены компьютером. Локальные записи телефона не отправлялись.");
  });
  const importLocal = () => run(async () => {
    if (!repository || !current.current) return;
    const count = await current.current.importLocal(repository.snapshot());
    setMessage(count ? "Копии записей добавлены в очередь: " + count + ". Отправим автоматически, пока Orion открыт." : "Эти записи уже переносились. Повторные копии не созданы.");
  });
  const switchSpace = (remote: boolean) => run(async () => {
    if (!repository) return;
    const selection = repository.snapshot().remoteSelection;
    if (remote && (!client || !selection)) throw new Error("Сначала загрузите пространство");
    await repository.setRemote(selection, remote); publishRef.current(repository.snapshot());
  });
  const disconnect = (forget: boolean) => run(async () => {
    if (!repository) return;
    try {
    await autoRef.current?.stop();
    await replicaIO.clearAll(); await repository.clearRemote(); publishRef.current(repository.snapshot()); setClient(null);
    const next = forget ? await lan.forget() : await lan.logout(); setState(next);
    setPairing(null); setWorkspaces([]); setAccounts([]);
    if (next.paired) setAccounts(await lan.accounts());
    setMessage("Копии компьютера удалены с телефона. Локальные записи сохранены.");
    } finally { setDriverEpoch(value => value + 1); }
  });
  const resolveConflict = (id: string, keepMine: boolean) => run(async () => {
    if (!client) return;
    if (keepMine) await client.retryConflict(id); else await client.dismissConflict(id);
    setMessage(keepMine ? "Ваша правка снова в очереди. Отправим автоматически, пока Orion открыт." : "Оставлена версия компьютера.");
  });
  const reloadWorkspaces = () => run(async () => { setWorkspaces(await lan.workspaces()); });
  const confirmedAt = client && confirmation?.client === client ? confirmation.at : null;
  return { confirmedAt, syncError, nodes, searched, discover, reconnect, state, pairing, accounts, workspaces, client, busy, error, message, begin, poll, login, connect, sync,
    importLocal, switchSpace, disconnect, resolveConflict, reloadWorkspaces };
}
