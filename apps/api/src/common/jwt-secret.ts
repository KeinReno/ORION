import { isServerMode } from "./orion-mode";

/**
 * S05 / 15-FIRST-TASKS: `AuthModule`/`JwtStrategy` used to fall back to this
 * literal whenever `JWT_SECRET` was unset — fine for a first `pnpm dev:api`
 * run with no `.env`, but a silent, well-known secret is a full auth bypass
 * the moment the process is reachable from anywhere but loopback. Server
 * mode (`ORION_MODE=server`) must fail to start rather than boot with it.
 */
const DEV_FALLBACK_JWT_SECRET = "dev-only-insecure-secret";

export function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (isServerMode()) {
    throw new Error(
      "JWT_SECRET is required when ORION_MODE=server. Refusing to start with the insecure development fallback secret."
    );
  }
  return DEV_FALLBACK_JWT_SECRET;
}
