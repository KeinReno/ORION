import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { SharedGrantSummary, SharedObjectView } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import type { RequestUser } from "../auth/jwt.strategy";
import { SharedGrantsService } from "./shared-grants.service";
import { SharedService } from "./shared.service";

/**
 * U09 — deliberately NOT `workspaces/:workspaceId/...` (threat model раздел
 * 2.3, point 2): the grantee is not a member of the source workspace, so
 * there is no workspaceId to scope this controller under, and mounting a
 * grant-aware branch inside an existing per-module controller would risk a
 * future edit accidentally exposing it on a mutating route. This controller
 * is read-only by construction — it has no POST/PATCH/DELETE routes at all
 * (T5).
 */
@UseGuards(JwtAuthGuard)
@Controller("shared")
export class SharedController {
  constructor(
    private readonly grants: SharedGrantsService,
    private readonly shared: SharedService
  ) {}

  /** Active grants where I'm the grantee — "Доступно мне". */
  @Get()
  listMine(@CurrentUser() user: RequestUser): Promise<SharedGrantSummary[]> {
    return this.grants.listMine(user.userId);
  }

  /** The one object a grant points at, allowlisted per type (раздел 3.1). */
  @Get(":grantId")
  getObject(@CurrentUser() user: RequestUser, @Param("grantId") grantId: string): Promise<SharedObjectView> {
    return this.shared.getObject(user.userId, grantId);
  }

  /**
   * File bytes for a `document`-type grant — same Range/disposition handling
   * as `DocumentsController.content`. Placed after `:grantId` intentionally;
   * NestJS matches `:grantId/content` as a distinct, more specific route.
   */
  @Get(":grantId/content")
  async content(
    @CurrentUser() user: RequestUser,
    @Param("grantId") grantId: string,
    @Query("disposition") disposition: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const { stream, mime, size, name, range } = await this.shared.getDocumentContent(user.userId, grantId, req.headers.range);
    const filename = encodeURIComponent(name);
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `${disposition === "attachment" ? "attachment" : "inline"}; filename*=UTF-8''${filename}`
    );
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
    } else {
      res.setHeader("Content-Length", String(size));
    }
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.destroy();
    });
    stream.pipe(res);
  }
}
