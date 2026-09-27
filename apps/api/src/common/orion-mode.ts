/**
 * S05 — explicit local/server mode.
 *
 * ORION started life desktop-only: single user, loopback-only, no threat
 * model beyond "don't trust the LAN". `docs/SONNET_IMPLEMENTATION` S05 asks
 * for that assumption to become an explicit, fail-safe switch instead of an
 * implicit one — a workspace exposed on a real network interface (server
 * mode, multi-user) needs the account picker, PIN unlock and dev JWT
 * fallback all turned off, none of which the old code distinguished.
 *
 * `ORION_MODE` is read fresh on every call (not cached at import time) so
 * request-time checks (e.g. `AuthController.listAccounts`) can be exercised
 * in tests by flipping `process.env.ORION_MODE` around a single already-
 * booted Nest app. The one exception is the JWT signing secret — see
 * `jwt-secret.ts` — which Nest's `JwtModule.register()` needs synchronously
 * at module-evaluation time, so it fails fast at process start instead.
 *
 * Default is "local": the safe default for the desktop/solo scenario this
 * app ships as by default (CLAUDE.md — "Tauri не содержит бизнес-логики",
 * no offline-sync, single-node). An operator who wants the multi-user/
 * server posture must opt in explicitly.
 */
export type OrionMode = "local" | "server";

const VALID_MODES: readonly OrionMode[] = ["local", "server"];

export function resolveMode(): OrionMode {
  const raw = (process.env.ORION_MODE ?? "local").trim().toLowerCase();
  if (!VALID_MODES.includes(raw as OrionMode)) {
    throw new Error(
      `ORION_MODE must be "local" or "server" (got "${process.env.ORION_MODE}"). Refusing to guess.`
    );
  }
  return raw as OrionMode;
}

export function isServerMode(): boolean {
  return resolveMode() === "server";
}

/**
 * Bind address the HTTP server should listen on. Local mode binds loopback
 * only, even if left unconfigured — the old code (`app.listen(port)` with no
 * host) bound every interface unconditionally, which is fine for a
 * container/server deploy but silently exposed a desktop install on the
 * LAN. `HOST` lets an operator override either default explicitly.
 */
export function resolveBindHost(mode: OrionMode): string {
  const configured = process.env.HOST?.trim();
  if (configured) return configured;
  return mode === "local" ? "127.0.0.1" : "0.0.0.0";
}
