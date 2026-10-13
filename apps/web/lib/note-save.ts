import { ApiError } from "@orion/core";
import type { Note, UpdateNoteInput } from "@orion/shared-types";
import { isNoteConflictPayload, type AutosaveConflict } from "./note-autosave";

/**
 * The CAS save `NoteAutosave` drives, shared by the notes list and a note opened
 * as a panel of its own. A 409 becomes the editor's `AutosaveConflict` (with the
 * server's real content) instead of a generic error, so the conflict UI can offer
 * "load the server version" / "save mine on top".
 */
export async function saveNoteWithRevision(
  update: (variables: { noteId: string; input: UpdateNoteInput }) => Promise<Note>,
  id: string,
  input: Omit<UpdateNoteInput, "expectedRevision">,
  expectedRevision: number
): Promise<Note> {
  try {
    return await update({ noteId: id, input: { ...input, expectedRevision } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && isNoteConflictPayload(err.details)) {
      const payload = err.details;
      const conflict: AutosaveConflict = {
        conflict: true,
        currentRevision: payload.currentRevision,
        current: {
          title: payload.current.title as string,
          summary: (payload.current.summary as string | undefined) ?? "",
          body: payload.current.body as string,
          tags: payload.current.tags as string[],
          eventAt: (payload.current.eventAt as string | null) ?? null,
          projectId: (payload.current.projectId as string | null) ?? null
        }
      };
      throw conflict;
    }
    throw err;
  }
}
