"use client";

import { useHybridReplica } from "@orion/core-react";
import { SYNC_STATE_LABELS, type SyncEntityType, type SyncState } from "@orion/shared-types";
import { Badge, Button, cx } from "@orion/ui";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { shortDateTime } from "../lib/format";

const REASON_TEXT: Record<string, string> = {
  entity_deleted: "запись уже удалена на узле",
  parent_deleted: "список уже удалён на узле",
  parent_missing: "списка нет на узле",
  entity_gone: "записи нет на узле",
  revision: "запись изменили, пока вы были без связи",
  invalid: "узел отклонил изменение",
  not_writable: "для этой записи офлайн-запись не включена",
  hlc_in_future: "часы устройства спешат больше чем на сутки"
};

const ENTITY_NOUN: Record<string, string> = { note: "Заметку", task: "Задачу", list: "Список", listItem: "Пункт" };

function previewOf(fields: Record<string, unknown> | undefined): string {
  const first = Object.values(fields ?? {}).find((value) => typeof value === "string") as string | undefined;
  return (first ?? "изменение").replace(/\s+/g, " ").slice(0, 80);
}

const LOST_LABELS: Record<string, string> = {
  name: "название", kind: "вид", archivedAt: "архив", sortOrder: "порядок", label: "текст", checked: "отметка",
  quantity: "количество", unit: "единица", note: "заметка", dueAt: "срок", section: "группа", priceMinor: "цена",
  title: "заголовок", body: "текст", description: "описание", status: "статус", priority: "приоритет", startAt: "начало", estimatedMinutes: "оценка"
};

/**
 * Состояние гибридной копии пространства (ТЗ-06): связь, время данных, очередь и конфликты. Показывается
 * только когда пространство работает через копию; в обычном режиме не рисуется вовсе.
 */
export function ReplicaBanner({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement | null {
  const replica = useHybridReplica(workspaceId);
  if (!replica) return null;
  const { status, engine } = replica;
  const conflicts = engine.conflicts();
  const offline = status.phase === "offline" || status.phase === "error" || status.phase === "incompatible";

  if (!offline && status.pending === 0 && conflicts.length === 0) return null;

  return (
    <div className={cx("mx-3 mt-2 space-y-2 rounded-lg border px-3 py-2 text-xs", offline ? "border-warning/40 bg-warning/10" : "border-white/10 bg-white/5")} role="status">
      <div className="flex flex-wrap items-center gap-2">
        {offline ? <CloudOff className="h-4 w-4 shrink-0" aria-hidden /> : <RefreshCw className={cx("h-4 w-4 shrink-0", status.phase === "syncing" && "animate-spin")} aria-hidden />}
        <span className="min-w-0 flex-1">
          {offline
            ? `${status.message ?? "Нет связи с узлом."} Данные на ${status.asOf ? shortDateTime(status.asOf) : "—"}.`
            : status.phase === "syncing"
              ? "Отправляем изменения на узел…"
              : "Изменения ещё не подтверждены узлом."}
          {status.pending > 0 ? ` В очереди: ${status.pending}.` : ""}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void engine.sync()}>
          Синхронизировать
        </Button>
      </div>
      {conflicts.map((conflict) => (
        <div key={conflict.opId} className="flex flex-wrap items-center gap-2 rounded-md bg-black/20 px-2 py-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            {conflict.reason === "revision"
              ? `${ENTITY_NOUN[conflict.op.entity]} изменили на узле, пока вы были без связи. Ваш текст сохранён: «${previewOf(conflict.op.fields)}».`
              : conflict.outcome === "superseded" || conflict.outcome === "merged"
              ? `Часть правок проиграла более поздним: ${Object.keys(conflict.lost ?? {}).map((f) => LOST_LABELS[f] ?? f).join(", ")}. Оставлены значения узла.`
              : `Изменение не применено: ${REASON_TEXT[conflict.reason ?? "invalid"] ?? "узел отклонил"}.`}
          </span>
          {conflict.reason === "revision" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void engine.retryConflict(conflict.opId).then(() => engine.sync())}>
                Сохранить мою версию
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void engine.dismissConflict(conflict.opId)}>
                Оставить версию узла
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => void engine.dismissConflict(conflict.opId)}>
              Понятно
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

const STATE_TONE: Record<Exclude<SyncState, "synced">, "warning" | "danger" | "neutral"> = {
  local: "warning",
  queued: "neutral",
  conflict: "danger"
};

/** Маленькая метка состояния записи; для `synced` ничего не рисует. */
export function SyncStateMark({ state }: { state: SyncState }): React.ReactElement | null {
  if (state === "synced") return null;
  return (
    <span title={SYNC_STATE_LABELS[state]}>
      <Badge tone={STATE_TONE[state]}>{state === "local" ? "на устройстве" : state === "queued" ? "в очереди" : "конфликт"}</Badge>
    </span>
  );
}

export type { SyncEntityType };
