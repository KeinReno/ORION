import { Controller, Get, Param } from "@nestjs/common";
import type { ProjectCosts } from "@orion/shared-types";
import { RequireModule } from "../../modules/require-module";
import { CurrentUser } from "../../common/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequirePlugin } from "../../plugins/require-plugin";
import { ProjectCostsService } from "./project-costs.service";

@RequireModule("finance")
@RequirePlugin("finance-project-costs")
@Controller("workspaces/:workspaceId/finance/projects/:projectId/costs")
export class ProjectCostsController {
  constructor(private readonly costs: ProjectCostsService) {}

  @Get()
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string
  ): Promise<ProjectCosts> {
    return this.costs.costs(user.userId, workspaceId, projectId);
  }
}
