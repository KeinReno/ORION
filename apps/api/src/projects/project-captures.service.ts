import { Injectable } from "@nestjs/common";
import type {
  Capture,
  CreateProjectCaptureInput,
  CreateProjectProblemInput,
  ProjectCapture,
  ProjectCaptureKind,
  UpdateProjectCaptureInput
} from "@orion/shared-types";
import { CapturesService, type CaptureScope } from "../captures/captures.service";

/**
 * The «Идеи» / «Проблемы» routes of a project, kept as they were. Since the
 * universal Capture they are a thin wrapper: a project capture is a `Capture`
 * anchored to `("project", projectId)`, and every rule (membership, same
 * workspace, one task per capture) lives in `CapturesService`.
 */
@Injectable()
export class ProjectCapturesService {
  constructor(private readonly captures: CapturesService) {}

  async list(userId: string, workspaceId: string, projectId: string, kind: ProjectCaptureKind): Promise<ProjectCapture[]> {
    const rows = await this.captures.list(userId, workspaceId, { anchorType: "project", anchorId: projectId, kind });
    return rows.map((row) => toLegacy(row, projectId));
  }

  async create(
    userId: string,
    workspaceId: string,
    projectId: string,
    kind: ProjectCaptureKind,
    input: CreateProjectCaptureInput | CreateProjectProblemInput
  ): Promise<ProjectCapture> {
    const row = await this.captures.create(userId, workspaceId, {
      kind,
      title: input.title,
      body: input.body,
      severity: kind === "problem" && "severity" in input ? input.severity : undefined,
      anchorType: "project",
      anchorId: projectId
    });
    return toLegacy(row, projectId);
  }

  async update(
    userId: string,
    workspaceId: string,
    projectId: string,
    captureId: string,
    kind: ProjectCaptureKind,
    input: UpdateProjectCaptureInput
  ): Promise<ProjectCapture> {
    return toLegacy(await this.captures.update(userId, workspaceId, captureId, input, scope(projectId, kind)), projectId);
  }

  async remove(userId: string, workspaceId: string, projectId: string, captureId: string, kind: ProjectCaptureKind): Promise<void> {
    await this.captures.remove(userId, workspaceId, captureId, scope(projectId, kind));
  }

  async promote(userId: string, workspaceId: string, projectId: string, captureId: string, kind: ProjectCaptureKind): Promise<ProjectCapture> {
    return toLegacy(await this.captures.promote(userId, workspaceId, captureId, scope(projectId, kind)), projectId);
  }
}

function scope(projectId: string, kind: ProjectCaptureKind): CaptureScope {
  return { kind, anchor: { type: "project", id: projectId } };
}

function toLegacy(row: Capture, projectId: string): ProjectCapture {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId,
    kind: row.kind as ProjectCaptureKind,
    title: row.title,
    body: row.body,
    status: row.status,
    severity: row.severity,
    taskId: row.taskId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
