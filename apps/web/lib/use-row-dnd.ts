"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

/**
 * Native HTML5 drag-and-drop for one reorderable column (list entries, list cards) — the same
 * hand-rolled approach as the task board, no DnD library (CLAUDE.md «осознанные упрощения»).
 *
 * `bind(id)` returns the props of a draggable row; dropping on a row moves the dragged one in front of it.
 * `bindEnd()` makes a zone (the empty tail, a group header) that appends instead. A drag that started
 * elsewhere (a file, text) is ignored: only drags this hook started carry its MIME type.
 */
export const ROW_DND_MIME = "application/x-orion-row";

export interface RowDnd {
  dragId: string | null;
  /** The row the pointer is over (`"end"` for the tail zone), for a drop indicator. */
  overId: string | null;
  bind: (id: string) => {
    draggable: true;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
  bindEnd: (scope?: string) => {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
}

/**
 * @param scope names the column: a row dragged from another column (another list's card) is ignored.
 * @param onMove `beforeId === null` appends to the end of `endScope`.
 */
export function useRowDnd(scope: string, onMove: (movedId: string, beforeId: string | null, endScope?: string) => void): RowDnd {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  const accepts = useCallback(
    (event: DragEvent): boolean => event.dataTransfer.types.includes(ROW_DND_MIME) && dragRef.current !== null,
    []
  );

  const finish = useCallback(() => {
    dragRef.current = null;
    setDragId(null);
    setOverId(null);
  }, []);

  const bind: RowDnd["bind"] = (id) => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData(ROW_DND_MIME, `${scope}:${id}`);
      event.dataTransfer.effectAllowed = "move";
      dragRef.current = id;
      setDragId(id);
    },
    onDragEnd: finish,
    onDragOver: (event) => {
      if (!accepts(event) || dragRef.current === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOverId(id);
    },
    onDragLeave: () => setOverId((current) => (current === id ? null : current)),
    onDrop: (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      const moved = dragRef.current;
      finish();
      if (moved && moved !== id) onMove(moved, id);
    }
  });

  const bindEnd: RowDnd["bindEnd"] = (endScope) => ({
    onDragOver: (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOverId(`end:${endScope ?? ""}`);
    },
    onDragLeave: () => setOverId((current) => (current === `end:${endScope ?? ""}` ? null : current)),
    onDrop: (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      const moved = dragRef.current;
      finish();
      if (moved) onMove(moved, null, endScope);
    }
  });

  return { dragId, overId, bind, bindEnd };
}
