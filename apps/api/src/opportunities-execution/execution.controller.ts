import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  approveAttemptInputSchema, cancelAttemptInputSchema, connectionActionInputSchema, createAttemptInputSchema, createConnectionInputSchema, reconcileAttemptInputSchema,
  type ApproveAttemptInput, type CancelAttemptInput, type ConnectionActionInput, type CreateAttemptInput, type CreateConnectionInput, type ReconcileAttemptInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequirePlugin } from "../plugins/require-plugin";
import { ExecutionService } from "./execution.service";

const attemptQuery = z.object({ cursor: z.string().uuid().optional(), connectionId: z.string().uuid().optional(), state: z.string().max(40).optional() }).strict();

/** Owner-only human API of the execution plugin. The local runner uses a separate capability-token controller. */
@RequirePlugin("opportunities-execution")
@Controller("workspaces/:workspaceId/opportunity-execution")
export class ExecutionController {
  constructor(private readonly service: ExecutionService) {}
  @Post("connections") createConnection(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createConnectionInputSchema)) b: CreateConnectionInput) { return this.service.createConnection(u.userId, ws, b); }
  @Get("connections") connections(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string) { return this.service.listConnections(u.userId, ws); }
  @Post("connections/:id/pause") pause(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(connectionActionInputSchema)) b: ConnectionActionInput) { return this.service.pause(u.userId, ws, id, b); }
  @Post("connections/:id/resume") resume(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(connectionActionInputSchema)) b: ConnectionActionInput) { return this.service.resume(u.userId, ws, id, b); }
  @Post("connections/:id/stop") stop(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(connectionActionInputSchema)) b: ConnectionActionInput) { return this.service.stop(u.userId, ws, id, b); }
  @Post("connections/:id/revoke") revoke(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(connectionActionInputSchema)) b: ConnectionActionInput) { return this.service.revoke(u.userId, ws, id, b); }
  @Post("attempts") createAttempt(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createAttemptInputSchema)) b: CreateAttemptInput) { return this.service.createAttempt(u.userId, ws, b); }
  @Get("attempts") attempts(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Query(new ZodValidationPipe(attemptQuery)) q: z.infer<typeof attemptQuery>) { return this.service.listAttempts(u.userId, ws, q); }
  @Get("attempts/:id") attempt(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.getAttempt(u.userId, ws, id); }
  @Post("attempts/:id/approve") approve(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approveAttemptInputSchema)) b: ApproveAttemptInput) { return this.service.approveAttempt(u.userId, ws, id, b); }
  @Post("attempts/:id/cancel") cancel(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(cancelAttemptInputSchema)) b: CancelAttemptInput) { return this.service.cancelAttempt(u.userId, ws, id, b); }
  @Post("attempts/:id/reconcile") reconcile(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reconcileAttemptInputSchema)) b: ReconcileAttemptInput) { return this.service.reconcileAttempt(u.userId, ws, id, b); }
}
