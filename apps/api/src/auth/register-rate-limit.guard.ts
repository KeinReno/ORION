import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { clientIp } from "../common/client-ip";

/**
 * S05 — narrow abuse guard on `/auth/register`, added after the 2026-09-21
 * session deliberately left this route unlimited (see `AuthController` —
 * that comment is kept, this guard supersedes the "not rate-limited"
 * decision, not the reasoning behind it).
 *
 * A flat per-IP counter like `LoginRateLimitGuard` doesn't fit here: login
 * caps *guessing a secret that already exists* (10 tries is already
 * generous), but register has a real legitimate bulk pattern — seed
 * scripts and this repo's own integration tests create dozens of distinct
 * accounts from one loopback IP inside a single test run
 * (`api-rls.integration.test.ts` alone registers ~35 in one app instance).
 * A 10/5min cap tuned for login breaks that outright (this is exactly what
 * happened the first time `LoginRateLimitGuard` was applied to both routes).
 *
 * So this guard keys on **two** independent windows instead of one:
 *   - per-IP, generous (`ipMax`): stops a flood of registrations from one
 *     source regardless of email, threshold picked well above the heaviest
 *     legitimate test file's attempt count so `pnpm test:integration` keeps
 *     passing unmodified.
 *   - per (IP, email), tight (`emailMax`): stops repeated registration
 *     attempts against the *same* email from the *same* IP — the actual
 *     abuse pattern named in the done-criterion ("email-enumeration
 *     защищено"): an attacker probing whether an address is already taken,
 *     or spamming registration/verification emails at one victim address.
 *     Legitimate bulk flows use a distinct email per account, so this
 *     window essentially never fires for them.
 * Both windows count every request (success or 4xx), same simplicity
 * trade-off as `LoginRateLimitGuard`. Single-process in-memory state only —
 * fine for Стадия 1 (single-node), same as the login guard.
 */
@Injectable()
export class RegisterRateLimitGuard implements CanActivate {
  private readonly perIp = new Map<string, { count: number; resetAt: number }>();
  private readonly perEmail = new Map<string, { count: number; resetAt: number }>();

  private readonly ipWindowMs = 5 * 60 * 1000;
  // The e2e suite (playwright.config.ts) raises it: one run registers more accounts from 127.0.0.1 than any real client.
  private readonly ipMax = positiveInt(process.env.REGISTER_RATE_LIMIT_PER_IP) ?? 60;

  private readonly emailWindowMs = 15 * 60 * 1000;
  private readonly emailMax = 5;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    const now = Date.now();

    this.bump(
      this.perIp,
      ip,
      this.ipWindowMs,
      this.ipMax,
      now,
      "Слишком много регистраций с этого адреса — подождите несколько минут и попробуйте снова"
    );

    const email = normalizeEmail((req.body as { email?: unknown } | undefined)?.email);
    if (email) {
      this.bump(
        this.perEmail,
        `${ip}:${email}`,
        this.emailWindowMs,
        this.emailMax,
        now,
        "Слишком много попыток регистрации для этого email — подождите и попробуйте снова"
      );
    }

    this.sweep(this.perIp, now);
    this.sweep(this.perEmail, now);
    return true;
  }

  private bump(
    store: Map<string, { count: number; resetAt: number }>,
    key: string,
    windowMs: number,
    max: number,
    now: number,
    message: string
  ): void {
    const entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (entry.count >= max) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
    entry.count += 1;
  }

  /** Bounds memory: drop expired windows opportunistically instead of a timer. */
  private sweep(store: Map<string, { count: number; resetAt: number }>, now: number): void {
    if (store.size < 2000) return;
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveInt(raw: string | undefined): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
