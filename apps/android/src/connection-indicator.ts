import type { ReplicaStatus } from "@orion/core";
/** Confirmation is session-local monotonic time, never a timestamp from the host or cached replica. */
export function connectionIndicator(paired: boolean, loggedIn: boolean, status?: ReplicaStatus, confirmedAt: number | null = null, now = performance.now()) {
  if (!paired) return { tone: "neutral", label: "Подключить компьютер" };
  if (!loggedIn || !status) return { tone: "attention", label: "Завершить настройку связи" };
  if (status.phase === "syncing") return { tone: "working", label: "Обмен с компьютером" };
  if (status.phase !== "idle") return { tone: "attention", label: "Нет подтверждённой связи с ПК" };
  if (!status.hasCopy) return { tone: "attention", label: "Загрузить пространство ПК" };
  if (status.conflicts) return { tone: "attention", label: `Конфликтов: ${status.conflicts}` };
  if (status.pending) return { tone: "attention", label: `В очереди: ${status.pending}` };
  const age = confirmedAt === null ? Infinity : now - confirmedAt;
  if (!Number.isFinite(age) || age < 0 || age > 60_000) return { tone: "neutral", label: "Ожидаем новый ответ ПК" };
  return { tone: "ready", label: "ПК ответил · очередь пуста" };
}
