import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { RunnerService, type RunnerPrincipal } from "./runner.service";

export type RunnerRequest = { headers: Record<string, string | string[] | undefined>; ip?: string; runner?: RunnerPrincipal };

/** Small in-memory sliding window (per process): protects the unauthenticated pairing step and the runner endpoints from hammering. */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number | (() => number), private readonly windowMs: number, private readonly now: () => number = Date.now) {}
  consume(key: string): boolean {
    const t = this.now(); const recent = (this.hits.get(key) ?? []).filter((at) => at > t - this.windowMs);
    if (recent.length >= (typeof this.limit === "function" ? this.limit() : this.limit)) { this.hits.set(key, recent); return false; }
    recent.push(t); this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, list] of this.hits) if (!list.length || list[list.length - 1] <= t - this.windowMs) this.hits.delete(k);
    return true;
  }
}

/** Authenticates `Authorization: Bearer ohr_...` (a connection-scoped capability). A user JWT is NOT accepted here. */
@Injectable()
export class RunnerAuthGuard implements CanActivate {
  private readonly window = new SlidingWindow(240, 60_000);
  constructor(private readonly runner: RunnerService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RunnerRequest>();
    const header = request.headers.authorization; const value = Array.isArray(header) ? header[0] : header;
    const principal = await this.runner.authenticate(value?.startsWith("Bearer ") ? value.slice(7).trim() : null);
    if (!this.window.consume(principal.connectionId)) throw new HttpException("Слишком много запросов исполнителя", HttpStatus.TOO_MANY_REQUESTS);
    request.runner = principal;
    return true;
  }
}
