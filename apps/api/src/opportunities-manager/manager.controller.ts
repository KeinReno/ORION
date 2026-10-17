import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { createPolicyInputSchema, policyActionInputSchema, type CreatePolicyInput, type PolicyActionInput } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequirePlugin } from "../plugins/require-plugin";
import { ManagerService } from "./manager.service";

const reportQuery = z.object({ cursor: z.string().uuid().optional() }).strict();

/** Owner-only API of the manager. Running a cycle is an explicit command; there is no background scheduler. */
@RequirePlugin("opportunities-manager")
@Controller("workspaces/:workspaceId/opportunity-manager")
export class ManagerController {
  constructor(private readonly service: ManagerService) {}
  @Post("policies") create(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Body(new ZodValidationPipe(createPolicyInputSchema)) b: CreatePolicyInput) { return this.service.createPolicy(u.userId, ws, b); }
  @Get("policies") list(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string) { return this.service.listPolicies(u.userId, ws); }
  @Get("policies/:id/report") report(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(reportQuery)) q: z.infer<typeof reportQuery>) { return this.service.report(u.userId, ws, id, q.cursor); }
  @Post("policies/:id/run") run(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string) { return this.service.tick(u.userId, ws, id); }
  @Post("policies/:id/pause") pause(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(policyActionInputSchema)) b: PolicyActionInput) { return this.service.pause(u.userId, ws, id, b); }
  @Post("policies/:id/resume") resume(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(policyActionInputSchema)) b: PolicyActionInput) { return this.service.resume(u.userId, ws, id, b); }
  @Post("policies/:id/stop") stop(@CurrentUser() u: RequestUser, @Param("workspaceId") ws: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(policyActionInputSchema)) b: PolicyActionInput) { return this.service.stop(u.userId, ws, id, b); }
}
