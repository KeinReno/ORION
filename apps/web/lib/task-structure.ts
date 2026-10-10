"use client";

import type { Task, TaskStatus, UpdateTaskInput } from "@orion/shared-types";
import { isTaskClosed } from "@orion/shared-types";
import { useCallback, useState } from "react";

/**
 * Подзадачи (`Task.parentId`): чистые помощники по дереву задач и ручному порядку,
 * которыми пользуются доска (TasksPanel), карточка (TaskCard) и проекты. Секция
 * подзадач в панели деталей — часть плагина `tasks-planning`. Вынесено из TasksPanel.tsx по правилу «два независимых
 * concern'а» из CLAUDE.md: доска — про раскладку, дерево задач — про
 * иерархию и ручной порядок (`Task.sortOrder`).
 *
 * Бэкенд уже проверяет и циклы, и принадлежность родителя пространству
 * (`assertParentTx` в tasks.service.ts); здесь считается только то, что нужно,
 * чтобы UI не предлагал заведомо неверный вариант (потомок в роли родителя).
 */

export interface SubtaskProgress {
  total: number;
  done: number;
}

/** Прогресс по детям для каждой задачи-родителя: сколько всего и сколько закрыто. */
export function subtaskProgressMap(tasks: Task[]): Map<string, SubtaskProgress> {
  const map = new Map<string, SubtaskProgress>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const current = map.get(task.parentId) ?? { total: 0, done: 0 };
    current.total += 1;
    if (isTaskClosed(task.status)) current.done += 1;
    map.set(task.parentId, current);
  }
  return map;
}

/** Все потомки задачи (транзитивно) по `parentId` — защита от цикла в селекте. */
export function descendantIds(tasks: Task[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const siblings = childrenOf.get(task.parentId);
    if (siblings) siblings.push(task.id);
    else childrenOf.set(task.parentId, [task.id]);
  }
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;
    for (const child of childrenOf.get(current) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

/**
 * Варианты для селекта «Родительская задача». Исключаются сама задача и её
 * потомки: такой выбор сервер отклонит с 400 («Нельзя создать цикл подзадач»),
 * поэтому предлагать его нельзя.
 */
export function parentOptions(tasks: Task[], excludeId?: string): { id: string; title: string }[] {
  const excluded = excludeId ? descendantIds(tasks, excludeId) : new Set<string>();
  if (excludeId) excluded.add(excludeId);
  return tasks
    .filter((task) => !excluded.has(task.id))
    .map((task) => ({ id: task.id, title: task.title }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

/**
 * Порядок задач внутри колонки. При `bySortOrder` (группировка по статусу)
 * база — ручной порядок `sortOrder` с прежним фолбэком по `createdAt`;
 * затем дети вставляются сразу под своим родителем, а дети, чей родитель
 * в другой колонке или отфильтрован, остаются на общем уровне (с маркером
 * вложенности на карточке). Прочие группировки сохраняют исходный порядок.
 */
export function orderColumnTasks(tasks: Task[], bySortOrder: boolean): Task[] {
  const ids = new Set(tasks.map((task) => task.id));
  // Сортировка стабильная, поэтому при равных `sortOrder` сохраняется прежний
  // порядок (его задаёт сервер: sortOrder, срок, createdAt).
  const base = bySortOrder ? [...tasks].sort((a, b) => a.sortOrder - b.sortOrder) : tasks;

  const childrenOf = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of base) {
    if (task.parentId && ids.has(task.parentId)) {
      const siblings = childrenOf.get(task.parentId);
      if (siblings) siblings.push(task);
      else childrenOf.set(task.parentId, [task]);
      continue;
    }
    roots.push(task);
  }

  const ordered: Task[] = [];
  const seen = new Set<string>();
  const push = (task: Task): void => {
    // `seen` — не только дедуп: битые данные с циклом не должны зациклить рендер.
    if (seen.has(task.id)) return;
    seen.add(task.id);
    ordered.push(task);
    for (const child of childrenOf.get(task.id) ?? []) push(child);
  };
  for (const root of roots) push(root);
  for (const task of base) push(task);
  return ordered;
}

/**
 * Новый `sortOrder` для задачи, брошенной на `targetId`: середина между целью и
 * предыдущим элементом колонки, иначе `target.sortOrder - 1000`. `null` —
 * бросать некуда (цель не найдена или задача уже стоит прямо над целью).
 */
export function sortOrderForDrop(ordered: Task[], draggedId: string, targetId: string): number | null {
  const index = ordered.findIndex((task) => task.id === targetId);
  if (index < 0 || draggedId === targetId) return null;
  const target = ordered[index];
  const dragged = ordered.find((task) => task.id === draggedId);
  if (dragged) {
    // Родителя бросают на его же потомка: дети всё равно рисуются сразу за
    // родителем, поэтому новый `sortOrder` на экране ничего не изменит.
    const byId = new Map(ordered.map((item) => [item.id, item]));
    if (isAncestor(byId, dragged, targetId)) return null;
  }
  const previous = ordered[index - 1];
  if (!previous) return target.sortOrder - 1000;
  if (previous.id === draggedId) return null;
  return Math.round((previous.sortOrder + target.sortOrder) / 2);
}

export interface SortOrderSwap {
  taskId: string;
  sortOrder: number;
  neighborId: string;
  neighborSortOrder: number;
}

/** Предок ли `candidate` для задачи `nodeId` — по цепочке `parentId` внутри списка. */
function isAncestor(byId: Map<string, Task>, candidate: Task, nodeId: string): boolean {
  const seen = new Set<string>();
  let cursor = byId.get(nodeId)?.parentId ?? null;
  while (cursor) {
    if (cursor === candidate.id) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/**
 * Обмен `sortOrder` с соседом по колонке — детерминированный (и доступный с
 * клавиатуры) аналог drag-and-drop. При равных значениях простой обмен ничего
 * не изменил бы, поэтому задача сдвигается на единицу за соседа.
 */
export function neighborSwap(ordered: Task[], taskId: string, direction: -1 | 1): SortOrderSwap | null {
  const index = ordered.findIndex((task) => task.id === taskId);
  if (index < 0) return null;
  const task = ordered[index];
  const byId = new Map(ordered.map((item) => [item.id, item]));
  // Дети всегда идут сразу за родителем: обмен с собственным ребёнком (вниз) или
  // с родителем (вверх) на экране ничего бы не поменял. Вниз поэтому шагаем
  // через всё своё поддерево, а вверх из своей ветки идти некуда.
  let neighborIndex = index + direction;
  while (neighborIndex >= 0 && neighborIndex < ordered.length) {
    const candidate = ordered[neighborIndex];
    if (!isAncestor(byId, candidate, task.id) && !isAncestor(byId, task, candidate.id)) break;
    if (direction === -1) return null;
    neighborIndex += 1;
  }
  const neighbor = ordered[neighborIndex];
  if (!neighbor) return null;
  return {
    taskId: task.id,
    sortOrder: task.sortOrder === neighbor.sortOrder ? neighbor.sortOrder + direction : neighbor.sortOrder,
    neighborId: neighbor.id,
    neighborSortOrder: task.sortOrder
  };
}

/** Есть ли вообще сосед в этом направлении (иначе пункт меню не показываем). */
export function canMoveNeighbor(ordered: Task[], taskId: string, direction: -1 | 1): boolean {
  return neighborSwap(ordered, taskId, direction) !== null;
}

/**
 * Ручной порядок в колонках статусов: приём дропа на карточку и обмен
 * `sortOrder` с соседом. Живёт здесь, а не в TasksPanel, чтобы доска оставалась
 * про раскладку, а дерево/порядок задач — в одном месте.
 */
export function useTaskReorder(
  tasks: Task[] | undefined,
  mutateTask: (variables: { taskId: string; input: UpdateTaskInput }) => void
): {
  dragOverKey: string | null;
  setDragOverKey: React.Dispatch<React.SetStateAction<string | null>>;
  dropOnTask: (columnKey: string, columnTasks: Task[], draggedId: string, targetId: string) => void;
  moveToNeighbor: (columnTasks: Task[], taskId: string, direction: -1 | 1) => void;
} {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  /**
   * Дроп задачи A на карточку B той же колонки — вставка перед B (при
   * группировке по статусу, где порядок задаёт `sortOrder`). Дроп из другой
   * колонки остаётся сменой статуса: иначе карточка «съедала» бы обычный
   * перенос между колонками.
   */
  const dropOnTask = useCallback(
    (columnKey: string, columnTasks: Task[], draggedId: string, targetId: string): void => {
      // Дроп на карточку не всплывает до колонки, поэтому подсветку снимаем сами.
      setDragOverKey(null);
      const task = tasks?.find((item) => item.id === draggedId);
      if (!task || draggedId === targetId) return;
      if (task.status !== columnKey) {
        mutateTask({ taskId: draggedId, input: { status: columnKey as TaskStatus } });
        return;
      }
      const sortOrder = sortOrderForDrop(columnTasks, draggedId, targetId);
      if (sortOrder === null) return;
      mutateTask({ taskId: draggedId, input: { sortOrder } });
    },
    [tasks, mutateTask]
  );

  /** «Вверх»/«Вниз» в меню карточки — обмен `sortOrder` с соседом по колонке. */
  const moveToNeighbor = useCallback(
    (columnTasks: Task[], taskId: string, direction: -1 | 1): void => {
      const swap = neighborSwap(columnTasks, taskId, direction);
      if (!swap) return;
      mutateTask({ taskId: swap.taskId, input: { sortOrder: swap.sortOrder } });
      mutateTask({ taskId: swap.neighborId, input: { sortOrder: swap.neighborSortOrder } });
    },
    [mutateTask]
  );

  return { dragOverKey, setDragOverKey, dropOnTask, moveToNeighbor };
}
