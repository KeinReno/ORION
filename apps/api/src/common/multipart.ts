/**
 * Shared bits of every `multipart/form-data` upload endpoint (documents and
 * note attachments). Kept here rather than duplicated per controller so the
 * size limit stays one number: a file that "Документы" accepts must not be
 * rejected by the notes module.
 */

/** Max size of a single uploaded file, from `MAX_UPLOAD_MB` (default 50). */
export const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 50)) * 1024 * 1024;

/**
 * Busboy (under `multer`/`FilesInterceptor`) decodes the multipart
 * `Content-Disposition: filename="…"` header as Latin-1 by default — it
 * doesn't know the browser actually sent UTF-8 bytes for a non-ASCII name.
 * The result is exactly the mojibake pattern below ("Смета.csv" → "Ð¡Ð¼ÐµÑ‚Ð°.csv").
 * Reversing that one mis-decode (bytes → Latin-1 → back to UTF-8) is a
 * no-op for a plain ASCII filename, so this is safe to apply unconditionally
 * for this interceptor. See docs/PLAN.md v0.13.
 */
export function fixMultipartFilename(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}
