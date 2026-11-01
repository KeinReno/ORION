import { Controller, Get, Param, UseGuards, ConflictException } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { PrismaService } from "../common/prisma.service";
import { loadDevelopmentCatalog } from "./catalog-loader";
import { readDevelopmentImportSnapshotTx } from "./catalog-import-snapshot";
import { digestDevelopmentPreview } from "./catalog-preview-digest";

/**
 * Read-only development import preview. The fixed catalog root is configured
 * by the server administrator; no catalog path or write payload is accepted.
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/development-import")
export class DevelopmentImportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("preview")
  async preview(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const repoRoot = process.env.ORION_DEV_CATALOG_ROOT;
    if (!repoRoot) throw new ConflictException("ORION_DEV_CATALOG_ROOT is not configured");
    const loaded = loadDevelopmentCatalog(repoRoot);
    const snapshot = await this.prisma.withUser(user.userId, (tx) =>
      readDevelopmentImportSnapshotTx(tx, user.userId, workspaceId, loaded.catalog.catalogId)
    );
    const digest = digestDevelopmentPreview({
      userId: user.userId,
      workspaceId,
      catalogId: loaded.catalog.catalogId,
      catalogSha256: loaded.sha256
    }, snapshot);
    return {
      catalogId: loaded.catalog.catalogId,
      catalogSha256: loaded.sha256,
      previewDigest: digest,
      catalog: loaded.catalog,
      snapshot,
      readOnly: true
    };
  }
}
