import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import {
  runnerBindInputSchema, runnerLeaseInputSchema, runnerReserveInputSchema, runnerResultInputSchema,
  type RunnerBindInput, type RunnerLeaseInput, type RunnerReserveInput, type RunnerResultInput
} from "@orion/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RunnerAuthGuard, SlidingWindow, type RunnerRequest } from "./runner-auth.guard";
import { RunnerService } from "./runner.service";

/** Pairing attempts per client address per 5 minutes; `ORION_RUNNER_BIND_LIMIT` overrides (integration tests pair many runners from one address). */
const bindWindow = new SlidingWindow(() => { const raw = Number(process.env.ORION_RUNNER_BIND_LIMIT); return Number.isInteger(raw) && raw > 0 ? raw : 10; }, 5 * 60_000);

/**
 * Versioned protocol for the local HH runner (`opportunities-executor/v1`). Capability-token auth only; no user JWT, no shell,
 * no arbitrary commands: the runner can claim a job, extend its lease, pass the mandatory pre-submit checkpoint and report a result.
 */
@Controller("opportunities-executor/v1")
export class RunnerController {
  constructor(private readonly runner: RunnerService) {}

  /** The pairing code is the credential for this one call; attempts are rate-limited per client address. */
  @Post("bind") @HttpCode(200) bind(@Req() req: { ip?: string }, @Body(new ZodValidationPipe(runnerBindInputSchema)) b: RunnerBindInput) {
    if (!bindWindow.consume(req.ip ?? "unknown")) throw new HttpException("Слишком много попыток сопряжения", HttpStatus.TOO_MANY_REQUESTS);
    return this.runner.bind(b);
  }
  @UseGuards(RunnerAuthGuard) @Get("whoami") whoami(@Req() req: RunnerRequest) { return this.runner.whoami(req.runner!); }
  @UseGuards(RunnerAuthGuard) @Post("claim") @HttpCode(200) claim(@Req() req: RunnerRequest) { return this.runner.claim(req.runner!); }
  @UseGuards(RunnerAuthGuard) @Post("heartbeat") @HttpCode(200) heartbeat(@Req() req: RunnerRequest, @Body(new ZodValidationPipe(runnerLeaseInputSchema)) b: RunnerLeaseInput) { return this.runner.heartbeat(req.runner!, b); }
  @UseGuards(RunnerAuthGuard) @Post("reserve") @HttpCode(200) reserve(@Req() req: RunnerRequest, @Body(new ZodValidationPipe(runnerReserveInputSchema)) b: RunnerReserveInput) { return this.runner.reserve(req.runner!, b); }
  @UseGuards(RunnerAuthGuard) @Post("result") @HttpCode(200) result(@Req() req: RunnerRequest, @Body(new ZodValidationPipe(runnerResultInputSchema)) b: RunnerResultInput) { return this.runner.result(req.runner!, b); }
}
