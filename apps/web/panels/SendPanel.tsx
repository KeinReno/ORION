"use client";

import { useCore } from "@orion/core-react";
import {
  useApproveSendPair,
  useDiscoverSend,
  useEnableSend,
  useProbeSend,
  useSendAction,
  useSendPeers,
  useSendRequests,
  useSendStatus,
  useSendTransfers,
  useStartSendPair
} from "@orion/core-react";
import type { SendPeer } from "@orion/shared-types";
import { Button, Input, PanelBody, PanelHeader, PanelSection, PanelShell, Switch, useToast } from "@orion/ui";
import { useEffect, useState } from "react";
import { takeSendIntent, type SendIntent } from "../lib/panel-bus";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

async function filesFromList(list: FileList | File[]): Promise<Array<{ file: File; relative: string }>> {
  return Array.from(list).map((file) => ({ file, relative: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}

export function SendPanel(): React.ReactElement {
  const { api } = useCore();
  const status = useSendStatus();
  const enabled = Boolean(status.data?.enabled);
  const peers = useSendPeers(enabled);
  const transfers = useSendTransfers(enabled);
  const requests = useSendRequests(enabled);
  const enable = useEnableSend();
  const discover = useDiscoverSend();
  const probe = useProbeSend();
  const startPair = useStartSendPair();
  const approve = useApproveSendPair();
  const action = useSendAction();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pairId, setPairId] = useState<string | null>(null);
  const [entered, setEntered] = useState("");
  const [manual, setManual] = useState("");
  const [intent, setIntent] = useState<SendIntent | null>(null);
  const [downloadDir, setDownloadDir] = useState("");

  useEffect(() => {
    setIntent(takeSendIntent());
  }, []);
  useEffect(() => {
    if (status.data?.downloadDir) setDownloadDir(status.data.downloadDir);
  }, [status.data?.downloadDir]);
  useEffect(() => {
    if (!pairId) return;
    const timer = setInterval(() => {
      void api.refreshSendPair(pairId).then((row) => {
        if (row.status === "approved") {
          setCode(null);
          setPairId(null);
          toast({ title: "Устройство доверено", tone: "success" });
          void peers.refetch();
        }
        if (row.status === "denied" || row.status === "expired" || row.status === "error") {
          setCode(null);
          setPairId(null);
          toast({ title: row.message ?? "Сопряжение не состоялось", tone: "danger" });
        }
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [api, pairId, peers, toast]);

  const selectedPeer = (peers.data ?? []).find((peer) => peer.id === selected) ?? null;
  const active = (transfers.data ?? []).filter((item) => !["completed", "rejected", "cancelled", "failed"].includes(item.status));
  const history = (transfers.data ?? []).filter((item) => ["completed", "rejected", "cancelled", "failed"].includes(item.status)).slice(0, 20);

  async function sendFiles(list: Array<{ file: File; relative: string }>): Promise<void> {
    if (!selectedPeer?.trusted || !selectedPeer.mutual) {
      toast({ title: "Сначала подтвердите устройство", tone: "danger" });
      return;
    }
    let batchId: string | undefined;
    for (const item of list) {
      const staged = await api.stageSendFile(item.relative.replace(/\\/g, "/"), item.file, batchId);
      batchId = staged.batchId;
    }
    if (!batchId) return;
    await api.sendOutgoing(selectedPeer.id, batchId);
    await transfers.refetch();
  }

  async function sendIntent(): Promise<void> {
    if (!intent || !selectedPeer) return;
    if (intent.kind === "documents") {
      await action.mutateAsync({ kind: "documents", input: { peerId: selectedPeer.id, workspaceId: intent.workspaceId, documentIds: intent.documentIds } });
    } else {
      await action.mutateAsync({
        kind: "copy",
        input: {
          peerId: selectedPeer.id,
          title: intent.title,
          envelope: { kind: intent.copyKind, sourceId: intent.sourceId, exportedAt: new Date().toISOString(), payload: intent.payload }
        }
      });
    }
    setIntent(null);
    toast({ title: "Отправка началась", tone: "success" });
  }

  return (
    <PanelShell>
      <PanelHeader title="Orion Send" subtitle="Прямая передача между устройствами Orion в локальной сети. Это не синхронизация базы." />
      <PanelBody>
        <PanelSection title="Узел">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              checked={enabled}
              onChange={(value) => void enable.mutate({ enabled: value })}
              label="Принимать передачи"
            />
            <span className="text-sm text-ui-secondary">{status.data?.listening ? `Слушает порт ${status.data.port}` : "Слушатель выключен"}</span>
          </div>
          {status.data?.error ? <p className="mt-2 text-sm text-ui-danger">{status.data.error}</p> : null}
        </PanelSection>

        {enabled ? (
          <>
            <PanelSection title="Устройства">
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => discover.mutate(false)}>Найти</Button>
                <Button size="sm" variant="ghost" onClick={() => discover.mutate(true)}>Искать в подсети</Button>
              </div>
              <div className="mb-3 flex gap-2">
                <Input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="192.168.0.20 или адрес:порт" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const [address, port] = manual.split(":");
                    if (address) void probe.mutate({ address, port: port ? Number(port) : undefined });
                  }}
                >
                  Подключить
                </Button>
              </div>
              <ul className="space-y-2">
                {(peers.data ?? []).map((peer) => (
                  <li key={peer.id}>
                    <DeviceRow
                      peer={peer}
                      selected={selected === peer.id}
                      onSelect={() => setSelected(peer.id)}
                      onPair={() => {
                        if (!peer.address || !peer.port) return;
                        void startPair.mutateAsync({ address: peer.address, port: peer.port, deviceName: status.data?.name ?? "ORION" }).then((row) => {
                          setCode(row.code);
                          setPairId(row.requestId);
                        });
                      }}
                      onRevoke={() => void action.mutate({ kind: "revoke", id: peer.id })}
                    />
                  </li>
                ))}
              </ul>
              {code ? <p className="mt-3 text-sm">Код на этом устройстве: <strong>{code}</strong>. Введите его на втором компьютере.</p> : null}
              {(requests.data ?? []).map((request) => (
                <form
                  key={request.id}
                  className="mt-3 flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void approve.mutate({ id: request.id, code: entered });
                  }}
                >
                  <span className="text-sm">{request.deviceName} просит доверие</span>
                  <Input value={entered} onChange={(event) => setEntered(event.target.value)} placeholder="6 цифр" className="w-28" />
                  <Button size="sm" type="submit">Подтвердить</Button>
                </form>
              ))}
            </PanelSection>

            <PanelSection title="Отправка">
              {intent ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm">{intent.kind === "documents" ? "Выбран документ Orion" : `Копия: ${intent.title}`}</span>
                  <Button size="sm" onClick={() => void sendIntent()} disabled={!selectedPeer?.mutual}>Отправить на выбранное</Button>
                </div>
              ) : null}
              <div
                className="rounded-lg border border-dashed border-border p-4 text-sm"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void filesFromList(event.dataTransfer.files).then((list) => sendFiles(list));
                }}
              >
                Перетащите файлы сюда или выберите их.
                <div className="mt-2 flex gap-2">
                  <label className="cursor-pointer text-ui-accent">
                    Файлы
                    <input
                      className="hidden"
                      type="file"
                      multiple
                      onChange={(event) => {
                        if (event.target.files) void filesFromList(event.target.files).then((list) => sendFiles(list));
                      }}
                    />
                  </label>
                  <label className="cursor-pointer text-ui-accent">
                    Папка
                    <input
                      className="hidden"
                      type="file"
                      multiple
                      // @ts-expect-error каталог выбирает браузер, в типах React этого атрибута нет
                      webkitdirectory=""
                      onChange={(event) => {
                        if (event.target.files) void filesFromList(event.target.files).then((list) => sendFiles(list));
                      }}
                    />
                  </label>
                </div>
              </div>
            </PanelSection>

            <PanelSection title="Передачи">
              {active.length === 0 ? <p className="text-sm text-ui-secondary">Нет активных передач</p> : null}
              {active.map((item) => (
                <article key={item.transferId} className="mb-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">{item.peerName}</strong>
                    <span className="text-xs text-ui-secondary">{item.status} · {formatBytes(item.transferredBytes)} / {formatBytes(item.totalBytes)} · {formatBytes(item.bytesPerSecond)}/с</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-ui-tint/10">
                    <div className="h-full bg-ui-accent" style={{ width: `${item.totalBytes ? Math.min(100, (item.transferredBytes / item.totalBytes) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-2 flex gap-2">
                    {item.direction === "incoming" && item.status === "pending" ? (
                      <>
                        <Button size="sm" onClick={() => void action.mutate({ kind: "accept", id: item.transferId })}>Принять</Button>
                        <Button size="sm" variant="ghost" onClick={() => void action.mutate({ kind: "reject", id: item.transferId })}>Отклонить</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void action.mutate({ kind: item.status === "paused" ? "resume" : "pause", id: item.transferId })}>
                          {item.status === "paused" ? "Продолжить" : "Пауза"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void action.mutate({ kind: "cancel", id: item.transferId })}>Отмена</Button>
                      </>
                    )}
                  </div>
                  {item.error ? <p className="mt-2 text-xs text-ui-danger">{item.error}</p> : null}
                </article>
              ))}
              {history.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-ui-secondary">
                  {history.map((item) => (
                    <li key={item.transferId}>{item.peerName}: {item.status}, {item.files.length} файл(ов)</li>
                  ))}
                </ul>
              ) : null}
            </PanelSection>

            <PanelSection title="Настройки">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={downloadDir} onChange={(event) => setDownloadDir(event.target.value)} />
                <Button size="sm" variant="outline" onClick={() => void enable.mutate({ enabled: true, downloadDir })}>Папка загрузок</Button>
                <Button size="sm" variant="ghost" onClick={() => void api.openSendFirewall()}>Брандмауэр</Button>
              </div>
              <div className="mt-3">
                <Switch
                  checked={Boolean(status.data?.localSendCompat)}
                  onChange={(value) => void enable.mutate({ enabled: true, localSendCompat: value })}
                  label="Совместимость с LocalSend"
                />
              </div>
            </PanelSection>
          </>
        ) : (
          <p className="text-sm text-ui-secondary">Пока передача выключена, порт закрыт и другие устройства не видят этот компьютер.</p>
        )}
      </PanelBody>
    </PanelShell>
  );
}

function DeviceRow({
  peer,
  selected,
  onSelect,
  onPair,
  onRevoke
}: {
  peer: SendPeer;
  selected: boolean;
  onSelect: () => void;
  onPair: () => void;
  onRevoke: () => void;
}): React.ReactElement {
  const mark = peer.revoked ? "отозвано" : peer.online ? "в сети" : "недоступно";
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${selected ? "border-accent" : "border-border"}`}>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <span className="block text-sm">{peer.online ? "●" : "○"} {peer.name}</span>
        <span className="block text-xs text-ui-secondary">{mark}{peer.channel === "localsend" ? " · LocalSend" : ""}{peer.trusted ? " · доверено" : ""}{peer.compatible ? "" : " · другая версия"}</span>
      </button>
      {peer.channel === "orion" && peer.online && !peer.mutual && !peer.revoked ? <Button size="sm" variant="outline" onClick={onPair}>Доверить</Button> : null}
      {peer.trusted && !peer.revoked ? <Button size="sm" variant="ghost" onClick={onRevoke}>Отозвать</Button> : null}
    </div>
  );
}
