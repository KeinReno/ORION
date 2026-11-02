import { Body, Controller, Get, Param, Post, UseGuards, ConflictException } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { loadDevelopmentCatalog, configuredDevelopmentCatalogRoot } from "./catalog-loader";
import { readDevelopmentImportSnapshotTx } from "./catalog-import-snapshot";
import { digestDevelopmentPreview } from "./catalog-preview-digest";
import { planDevelopmentImport } from "./catalog-server-plan";
import { buildReviewedConsentScope } from "./catalog-reviewed-consent";
import { issueImportConsentTx, consumeImportConsentTx } from "./catalog-import-consent";
import { lockDevelopmentImportTx } from "./catalog-write-lock";
import { developmentProjectCatalog } from "../projects/public/development-catalog";
import { developmentTaskCatalog } from "../tasks/public/development-catalog";
import { TaskOperations } from "../tasks/public/task-operations";
import { buildDevelopmentImport } from "./catalog-import-builder";
import { applyConfirmedDevelopmentImportTx } from "./catalog-import-transaction";
import { RequireModule } from "../modules/require-module";
import { RequirePermission } from "../common/require-permission";

interface ReviewRequest {
  token?: string;
  workspaceConfirmed?: boolean;
  previewDigest?: string;
  choices?: Record<string, string>;
}

function validateReview(body: ReviewRequest): asserts body is ReviewRequest & {
  previewDigest: string; choices: Record<string, string>;
} {
  if (!body || body.workspaceConfirmed !== true || typeof body.previewDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.previewDigest) || !body.choices ||
      typeof body.choices !== "object" || Array.isArray(body.choices) ||
      Object.values(body.choices).some(value => typeof value !== "string" || !value)) {
    throw new ConflictException("Explicit workspace confirmation and valid preview decisions required");
  }
}

/**
 * Reviewed import of the fixed server-owned catalog. Client requests select
 * existing matches and a workspace; they cannot supply catalog content or paths.
 */
@UseGuards(JwtAuthGuard)
@RequireModule("orion-dev")
@Controller("workspaces/:workspaceId/development-import")
export class DevelopmentImportController {
  constructor(private readonly prisma: PrismaService, private readonly modules: ModulesService,
    private readonly tasks: TaskOperations) {}

  @Post("apply")
  @RequirePermission("orion-dev.development_import.create")
  async apply(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body() body: ReviewRequest & { token?: string }
  ) {
    validateReview(body);
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) {
      throw new ConflictException("Invalid import consent token");
    }
    const repoRoot = configuredDevelopmentCatalogRoot();
    const loaded = loadDevelopmentCatalog(repoRoot);
    return this.prisma.withUser(user.userId, async tx => {
      // All locks precede the fresh snapshot. Workspace/role locks also retain
      // module settings and authorization until the transaction commits.
      await lockDevelopmentImportTx(tx, user.userId, workspaceId);
      await developmentProjectCatalog.lockTx(tx, workspaceId);
      await developmentTaskCatalog.lockGraphTx(tx, workspaceId);
      const snapshot = await readDevelopmentImportSnapshotTx(
        tx, user.userId, workspaceId, loaded.catalog.catalogId, this.modules
      );
      const plan = planDevelopmentImport(loaded.catalog, snapshot);
      const digest = digestDevelopmentPreview({ userId: user.userId, workspaceId,
        catalogId: loaded.catalog.catalogId, catalogSha256: loaded.sha256 }, snapshot);
      if (body.previewDigest !== digest) {
        throw new ConflictException("Development preview changed; review again");
      }
      const scope = buildReviewedConsentScope({ userId: user.userId, workspaceId,
        catalogSha256: loaded.sha256, previewDigest: digest, preview: plan, choices: body.choices });
      const projects: Record<string, string> = {};
      const tasks: Record<string, string> = {};
      for (const row of plan.actions) {
        if (row.action === "review_possible_match") {
          (row.kind === "project" ? projects : tasks)[row.externalId] = body.choices[`${row.kind}:${row.externalId}`]!;
        }
      }
      const input = buildDevelopmentImport(loaded.catalog, workspaceId, { projects, tasks });
      await consumeImportConsentTx(tx, scope, body.token!);
      const result = await applyConfirmedDevelopmentImportTx(tx, user.userId, input, this.tasks);
      return { workspaceId, catalogId: scope.catalogId, catalogSha256: loaded.sha256,
        previewDigest: digest, writePerformed: true, ...result };
    });
  }

  /**
   * Issues a short-lived, single-use consent for a freshly recomputed preview.
   * This endpoint does NOT execute the import or write canonical projects/tasks.
   */
  @Post("consent")
  @RequirePermission("orion-dev.development_import.create")
  async consent(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body() body: ReviewRequest
  ) {
    const repoRoot = configuredDevelopmentCatalogRoot();
    validateReview(body);
    const loaded = loadDevelopmentCatalog(repoRoot);
    const choices = body.choices;
    return this.prisma.withUser(user.userId, async (tx) => {
      const snapshot = await readDevelopmentImportSnapshotTx(
        tx, user.userId, workspaceId, loaded.catalog.catalogId, this.modules
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
        previewDigest: digest, preview: plan, choices
      });
      const issued = await issueImportConsentTx(tx, scope);
      return { ...issued, catalogId: scope.catalogId, previewDigest: digest,
        selectionHash: scope.selectionHash, writePerformed: false };
    });
  }

  @Get("preview")
  @RequirePermission("orion-dev.development_import.read")
  async preview(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const repoRoot = configuredDevelopmentCatalogRoot();
    const loaded = loadDevelopmentCatalog(repoRoot);
    return this.prisma.withUser(user.userId, async (tx) => {
      const snapshot = await readDevelopmentImportSnapshotTx(tx, user.userId, workspaceId, loaded.catalog.catalogId, this.modules);
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
