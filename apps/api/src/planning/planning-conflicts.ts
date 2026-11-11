import { overlapMinutes, type PlanningConflict } from "@orion/shared-types";

/** Всё, что занимает окно на шкале времени: тайм-блок или событие календаря. */
export interface ConflictCandidate {
  id: string;
  title: string;
  startAt: string | Date;
  endAt: string | Date;
}

/**
 * Пересечения блока с другими блоками и событиями. Это предупреждение, а не
 * запрет: иногда наложение осознанно (буфер поверх встречи, переговорная
 * занята двумя людьми). Поэтому сервис возвращает список, а не 409.
 */
export function conflictsFor(
  target: ConflictCandidate,
  blocks: readonly ConflictCandidate[],
  events: readonly ConflictCandidate[]
): PlanningConflict[] {
  const out: PlanningConflict[] = [];
  const push = (kind: "block" | "event", candidate: ConflictCandidate): void => {
    if (candidate.id === target.id) return;
    const minutes = overlapMinutes(target.startAt, target.endAt, candidate.startAt, candidate.endAt);
    if (minutes <= 0) return;
    out.push({
      kind,
      id: candidate.id,
      title: candidate.title,
      startAt: new Date(candidate.startAt).toISOString(),
      endAt: new Date(candidate.endAt).toISOString(),
      minutes
    });
  };
  for (const block of blocks) push("block", block);
  for (const event of events) push("event", event);
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id, "en"));
}
