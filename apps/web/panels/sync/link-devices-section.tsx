"use client";

import { useLinkDevices, usePairLinkDevice, useRevokeLinkDevice, useRotateLinkKey, useSyncRemote } from "@orion/core-react";
import { encodeLinkInvite } from "@orion/core";
import { Button, Card, Input, PanelSection, useToast } from "@orion/ui";
import { useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";

/**
 * Orion Link (ADR-0020): устройства, которые обмениваются изменениями через облако (WebDAV), когда прямой связи
 * с узлом нет. Код приглашения содержит ключ пакетов — показываем его один раз и просим не пересылать открыто.
 * Облако видит только зашифрованные пакеты, но «загружено» не значит «применено» — это знает только узел.
 */
export function LinkDevicesSection({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }): React.ReactElement | null {
  const { toast } = useToast();
  const remote = useSyncRemote(workspaceId, isOwner);
  const devices = useLinkDevices(workspaceId);
  const pair = usePairLinkDevice(workspaceId);
  const revoke = useRevokeLinkDevice(workspaceId);
  const rotate = useRotateLinkKey(workspaceId);
  const [name, setName] = useState("");
  const [code, setCode] = useState<string | null>(null);

  if (!remote.data) {
    return (
      <PanelSection title="Orion Link">
        <Card className="text-sm text-muted-foreground">
          Сначала настройте WebDAV выше: облако служит почтовым ящиком для зашифрованных пакетов устройств.
        </Card>
      </PanelSection>
    );
  }
  const remoteConfig = remote.data;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    pair.mutate(
      { name: trimmed },
      {
        onSuccess: (pairing) => {
          setCode(
            encodeLinkInvite({
              pairing,
              webdav: { url: remoteConfig.url, baseDir: remoteConfig.baseDir, username: remoteConfig.username }
            })
          );
          setName("");
        },
        onError: (error) => toast({ title: "Не удалось подключить устройство", description: describeAuthError(error), tone: "danger" })
      }
    );
  };

  return (
    <PanelSection title="Orion Link — устройства через облако">
      <Card className="space-y-3">
        <p className="text-xs text-muted-foreground">
          В облако уходят только зашифрованные пакеты. Пароль WebDAV в код не входит — его вводят на устройстве. Работает, пока узел (этот
          компьютер) включён и применяет изменения: «загружено» ещё не значит «синхронизировано».
        </p>
        <div className="flex flex-wrap gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название устройства, например «Телефон»" className="min-w-0 flex-1" />
          <Button disabled={pair.isPending || !name.trim()} onClick={submit}>
            Подключить
          </Button>
        </div>
        {code ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Код приглашения — показан один раз</p>
            <p className="text-xs text-muted-foreground">Содержит ключ шифрования. Не публикуйте и не отправляйте по открытым каналам.</p>
            <textarea readOnly value={code} rows={3} className="w-full resize-none rounded-md border border-border bg-transparent p-2 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast({ title: "Код скопирован" }))}>
                Копировать
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCode(null)}>
                Скрыть
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      {devices.data && devices.data.length > 0 ? (
        <Card className="mt-3 space-y-2">
          <p className="text-sm font-medium">Мои устройства Link</p>
          {devices.data.map((device) => (
            <div key={device.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {device.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {device.revokedAt ? "отозвано" : device.lastSeenAt ? `обращалось ${shortDateTime(device.lastSeenAt)}` : "ещё не обращалось"}
                </span>
              </span>
              {device.revokedAt ? null : (
                <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(device.id)}>
                  Отозвать
                </Button>
              )}
            </div>
          ))}
        </Card>
      ) : null}
      {isOwner ? (
        <Card className="mt-3 space-y-2">
          <p className="text-sm font-medium">Ключ шифрования</p>
          <p className="text-xs text-muted-foreground">
            «Заменить» создаёт новый ключ; устройства со старым продолжают работать, пока вы не оборвёте доступ. «Заменить и оборвать» стирает
            старый ключ: все прежние устройства придётся подключить заново. Уже скачанное устройствами не вернуть.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate({ cutOffOld: false }, { onSuccess: () => toast({ title: "Ключ заменён" }) })}>
              Заменить
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={rotate.isPending}
              onClick={() => {
                if (window.confirm("Все ранее подключённые устройства Link перестанут работать, пока их не подключат заново. Продолжить?")) {
                  rotate.mutate({ cutOffOld: true }, { onSuccess: () => toast({ title: "Ключ заменён, старые устройства отключены" }) });
                }
              }}
            >
              Заменить и оборвать
            </Button>
          </div>
        </Card>
      ) : null}
    </PanelSection>
  );
}
