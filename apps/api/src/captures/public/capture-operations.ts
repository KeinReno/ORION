import type { Capture, CaptureAnchorType, CaptureKind, CreateCaptureInput, UpdateCaptureInput, ListCapturesQuery } from "@orion/shared-types";

export interface CaptureAnchor { type: CaptureAnchorType; id: string }
export interface CaptureScope { kind?: CaptureKind; anchor?: CaptureAnchor }
/** Universal capture commands, including scoped legacy project routes. */
export abstract class CaptureOperations {
  abstract list(userId: string, workspaceId: string, query: ListCapturesQuery): Promise<Capture[]>;
  abstract create(userId: string, workspaceId: string, input: CreateCaptureInput): Promise<Capture>;
  abstract update(userId: string, workspaceId: string, captureId: string, input: UpdateCaptureInput, scope?: CaptureScope): Promise<Capture>;
  abstract remove(userId: string, workspaceId: string, captureId: string, scope?: CaptureScope): Promise<void>;
  abstract promote(userId: string, workspaceId: string, captureId: string, scope?: CaptureScope): Promise<Capture>;
}
