import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { clientIp } from "../common/client-ip";

/**
 * S05 — brute-force protection on `/auth/login`.
 *
 * Evaluated against 08-TEAM-AND-ACCESS.md's "new dependency only when the
 * need is spelled out" rule: `@nestjs/throttler` isn't in `package.json`
 * yet, and pulling in a whole rate-limiting framework (with its own module
 * wiring, storage backend choice, and global-vs-per-route config surface)
 * for "cap unlock attempts per IP" is more than this needs — a fixed-window
 * counter in memory, scoped to two routes, does the job the done-criterion
 * asks for ("retries ограничены") without a new dependency. This is a
 * deliberately narrow tool, not a general-purpose limiter: single-process
 * only (no shared store across horizontally-scaled API instances — out of
 * scope for Стадия 1, which is single-node per docs/HISTORY.md), and it counts
 * failed *and* successful requests alike (simplicity over precision; a
 * legitimate user hitting the cap just waits out the window).
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs = 5 * 60 * 1000;
  private readonly maxAttempts = 10;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = clientIp(req);
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    if (entry.count >= this.maxAttempts) {
      throw new HttpException(
        "Слишком много попыток входа — подождите несколько минут и попробуйте снова",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    entry.count += 1;
    return true;
  }

  /** Bounds memory: drop expired windows opportunistically instead of a timer. */
  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}
