import { Injectable } from "@nestjs/common";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import type { AgentRequest } from "../ai/agent-token.guard";
import type { ModuleChangeHandler } from "../ai/agent-module-proposals.service";
import type { Response } from "express";

/** Public MCP bridge for registered module change tools; keeps domain modules off AI internals. */
@Injectable()
export class AgentChangeRunner {
  constructor(private readonly tools: AgentModuleToolsService) {}

  register(toolName: string, handler: ModuleChangeHandler): void {
    this.tools.register(toolName, handler);
  }

  change(
    req: AgentRequest,
    res: Response,
    toolName: string,
    targetId: string,
    args: Record<string, unknown>,
    options: { reason?: string; allowDirect?: boolean } = {}
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, toolName, targetId, args, options);
  }
}
