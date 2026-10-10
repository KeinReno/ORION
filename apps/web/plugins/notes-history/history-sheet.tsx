"use client";

import { Sheet } from "@orion/ui";
import type { NotesHistorySlotProps } from "../../lib/extensions/contracts";
import { NoteHistory } from "./note-history";

/** Plugin `notes-history`: past versions of one note, diffed against the current text, with restore. */
export function NoteHistorySheet({ workspaceId, noteId, currentTitle, currentBody, open, onClose, onRestored }: NotesHistorySlotProps): React.ReactElement {
  return (
    <Sheet open={open} onClose={onClose} title="История версий" width="40rem" bare>
      <NoteHistory workspaceId={workspaceId} noteId={noteId} currentTitle={currentTitle} currentBody={currentBody} onRestored={onRestored} />
    </Sheet>
  );
}
