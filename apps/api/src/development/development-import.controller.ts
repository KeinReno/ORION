import { Body, Controller, Get, Param, Post, UseGuards, ConflictException } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { PrismaService } from "../common/prisma.service";
import { loadDevelopmentCatalog } from "./catalog-loader";
import { readDevelopmentImportSnapshotTx } from "./catalog-import-snapshot";
import { digestDevelopmentPreview } from "./catalog-preview-digest";
import { planDevelopmentImport } from "./catalog-server-plan";
import { buildReviewedConsentScope } from "./catalog-reviewed-consent";
import { issueImportConsentTx } from "./catalog-import-consent";

/**
 * Read-only development import preview. The fixed catalog root is configured
 * by the server administrator; no catalog path or write payload is accepted.
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/development-import")
export class DevelopmentImportController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a short-lived, single-use consent for a freshly recomputed preview.
   * This endpoint does NOT execute the import or write canonical projects/tasks.
   */
  @Post("consent")
  async consent(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body() body: { previewDigest?: string; choices?: Record<string, string> }
  ) {
    const repoRoot = process.env.ORION_DEV_CATALOG_ROOT;
    if (!repoRoot) throw new ConflictException("ORION_DEV_CATALOG_ROOT is not configured");
    if (!body || typeof body.previewDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.previewDigest) ||
        !body.choices || typeof body.choices !== "object" || Array.isArray(body.choices)) {
      throw new ConflictException("Invalid consent request");
    }
    const loaded = loadDevelopmentCatalog(repoRoot);
    return this.prisma.withUser(user.userId, async (tx) => {
      const snapshot = await readDevelopmentImportSnapshotTx(
        tx, user.userId, workspaceId, loaded.catalog.catalogId
      );
      const plan = planDevelopmentImport(loaded.catalog, snapshot);
      const digest = digestDevelopmentPreview({
        userId: user.userId, workspaceId,
        catalogId: loaded.catalog.catalogId, catalogSha256: loaded.sha256
      }, snapshot);
      if (body.previewDigest !== digest) {
        throw new ConflictException("Development preview changed; review again");
      }
      const scope = buildReviewedConsentScope({
        userId: user.userId, workspaceId,
        catalogSha256: loaded.sha256,
        previewDigest: digest, preview: plan, choices: body.choices
      });
      const issued = await issueImportConsentTx(tx, scope);
      return { ...issued, catalogId: scope.catalogId, previewDigest: digest,
        selectionHash: scope.selectionHash, writePerformed: false };
    });
  }

  @Get("preview")
  async preview(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const repoRoot = process.env.ORION_DEV_CATALOG_ROOT;
    if (!repoRoot) throw new ConflictException("ORION_DEV_CATALOG_ROOT is not configured");
    const loaded = loadDevelopmentCatalog(repoRoot);
    return this.prisma.withUser(user.userId, async (tx) => {
      const snapshot = await readDevelopmentImportSnapshotTx(tx, user.userId, workspaceId, loaded.catalog.catalogId);
    const plan = planDevelopmentImport(loaded.catalog, snapshot);
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
      plan,
      readOnly: true
      };
    });
  }
}
