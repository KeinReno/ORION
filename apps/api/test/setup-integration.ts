process.env.DATABASE_URL ??= "postgresql://orion:orion_local_dev@127.0.0.1:5433/orion";
process.env.APP_DATABASE_URL ??=
  "postgresql://orion_app:OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI@127.0.0.1:5433/orion";
process.env.JWT_SECRET ??= "orion-integration-test-secret-that-is-not-used-outside-tests";
process.env.JWT_EXPIRES_IN ??= "15m";
process.env.STORAGE_DRIVER ??= "local";
process.env.STORAGE_DIR ??= "./tmp/integration-documents";
// Must decode to exactly 32 bytes (`sync-crypto.ts` `rootKey()` rejects
// anything else) — found broken while writing S02's sync/backup regression
// tests: the previous placeholder here decoded to 38 bytes, so
// `syncSecretAvailable()` was silently `false` for the whole integration
// suite and every sync/calendar-WebDAV-password test would 400 without an
// explicit override. Regenerate with
// `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
process.env.SYNC_SECRET ??= "gqnzEEdiChs+nfvHWYR9NA36qBGOCjVZq0xqXHtdHn8=";
