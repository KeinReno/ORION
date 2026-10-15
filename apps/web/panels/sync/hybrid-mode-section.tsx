"use client";

import { useRevokeSyncDevice, useSetSyncMode, useSyncDevices, useSyncMode } from "@orion/core-react";
import { SYNC_MODES, SYNC_MODE_LABELS, type SyncMode } from "@orion/shared-types";
import { Button, Card, PanelSection, Select, useToast } from "@orion/ui";
import { describeAuthError } from "../../lib/error-message";
import { shortDateTime } from "../../lib/format";

const MODE_HINT: Record<SyncMode, string> = {
  local: "Пространство живёт только на этом узле; другим устройствам копия не выдаётся.",
  shared: "Все работают через общий узел и пишут онлайн. Так было до гибридного режима.",
  hybrid:
    "Устройства хранят копию пространства и пишут без связи; изменения уходят на узел при появлении сети. Сейчас офлайн-запись работает для списков; заметки и задачи — только чтение копии."
};

/**
 * Режим синхронизации пространства и список устройств (ТЗ-06). Видна только владельцу.
 * Отзыв устройства останавливает его запись, но уже скачанную копию вернуть нельзя — это сказано прямо.
 */
export function HybridModeSection({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { toast } = useToast();
  const mode = useSyncMode(workspaceId);
  const setMode = useSetSyncMode(workspaceId);
  const devices = useSyncDevices();
  const revoke = useRevokeSyncDevice();
  const current = mode.data?.mode ?? "shared";

  return (
    <PanelSection title="Режим пространства и устройства">
      <Card className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Режим</span>
          <Select
            value={current}
            disabled={setMode.isPending || mode.isLoading}
            onChange={(event) =>
              setMode.mutate(event.target.value as SyncMode, {
                onError: (error) => toast({ title: "Не удалось сменить режим", description: describeAuthError(error), tone: "danger" })
              })
            }
          >
            {SYNC_MODES.map((value) => (
              <option key={value} value={value}>
                {SYNC_MODE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
        <p className="text-xs text-muted-foreground">{MODE_HINT[current]}</p>
        <p className="text-xs text-muted-foreground">
          Деньги (финансы, склад, учёт времени) и файлы остаются «только онлайн». Отзыв доступа удаляет копию при следующем подключении устройства, но не вернёт то, что уже было скачано.
        </p>
      </Card>
      {devices.data && devices.data.length > 0 ? (
        <Card className="mt-3 space-y-2">
          <p className="text-sm font-medium">Устройства</p>
          {devices.data.map((device) => (
            <div key={device.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {device.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {device.revokedAt ? "отозвано" : device.lastSeenAt ? `был на связи ${shortDateTime(device.lastSeenAt)}` : "ещё не подключалось"}
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
    </PanelSection>
  );
}
