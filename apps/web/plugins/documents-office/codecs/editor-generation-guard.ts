/**
 * R28-05 (docs/HISTORY.md): the shared
 * "is it safe to accept a refetched blob and overwrite editor state with
 * it" decision used by both `docx-editor.tsx` and `xlsx-editor.tsx`.
 *
 * Both editors re-parse `blob` whenever it changes identity — on first
 * open, but also on every later react-query refetch/invalidation,
 * including right after the editor's own successful save. A parse is slow
 * enough (network + decode) that the user can keep typing while it runs, so
 * the parsed result must not blindly replace whatever is in the editor.
 *
 * The ORIGINAL (buggy) guard snapshotted `editGeneration` at the moment the
 * parse effect started and only rejected the blob if generation changed
 * WHILE that particular parse was in flight:
 *
 *   const generationAtFetchStart = editGeneration;
 *   // ...later...
 *   accept = editGeneration === generationAtFetchStart;
 *
 * That misses a draft that was already dirty BEFORE the effect even
 * started: send A -> type B -> the save response/refetch fires a NEW parse
 * effect AFTER B was typed -> `generationAtFetchStart` already equals the
 * post-B generation -> the check trivially passes -> B is silently replaced
 * by server content for A.
 *
 * The correct question is not "did anything change during this fetch" but
 * "is there ANY unsaved edit right now, from before or during this fetch" —
 * i.e. compare the current edit generation against `savedGeneration` (the
 * generation as of the last successful save), not against a value captured
 * mid-flight.
 */
export function shouldAcceptRefetchedBlob(editGeneration: number, savedGeneration: number): boolean {
  return editGeneration === savedGeneration;
}
