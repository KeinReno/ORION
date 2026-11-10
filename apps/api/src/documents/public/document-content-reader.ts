import type { Readable } from "node:stream";

/** Authorized document content access for integrations. */
export abstract class DocumentContentReader {
  abstract openContent(userId: string, workspaceId: string, id: string): Promise<{
    stream: Readable;
    mime: string;
    size: number;
    name: string;
    range: { start: number; end: number } | null;
  }>;
}
