import type { Prisma } from "@prisma/client";
import type { PublicationContent, PublicationKind, PublicationSource, PublicationRuleConfig, TaskStatus } from "@orion/shared-types";

/** Registered by domain modules; no concrete module imports in the publication host. */
export interface PublicationAdapter {
  kind: PublicationKind;
  read(tx: Prisma.TransactionClient, source: PublicationSource): Promise<{ content: PublicationContent; revision: number }>;
  copy(tx: Prisma.TransactionClient, userId: string, workspaceId: string, content: PublicationContent): Promise<string>;
  /** Owner-scoped source filtering; the host never queries a concrete module table. */
  ruleCandidates?(tx: Prisma.TransactionClient, config: PublicationRuleConfig, sourceId?: string): Promise<Array<{ sourceId: string; revision: number; content: PublicationContent }>>;
  changeStatus?(tx: Prisma.TransactionClient, publisherId: string, source: PublicationSource, revision: number, status: TaskStatus, actorLabel: string): Promise<number>;
}

/** Remove delimited blocks in one pass, including an unfinished final block. */
function stripBlocks(value: string, open: string, close: string, replacement: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(open, cursor);
    if (start < 0) { parts.push(value.slice(cursor)); break; }
    parts.push(value.slice(cursor, start), replacement);
    const end = value.indexOf(close, start + open.length);
    if (end < 0) break;
    cursor = end + close.length;
  }
  return parts.join("");
}

/** Phase one transfers plain text only, never resolvable markup or dependency URLs. */
export function publicationText(value: string): string {
  const withoutComments = stripBlocks(value, "<!--", "-->", "");
  const withoutWiki = stripBlocks(withoutComments, "[[", "]]", "[связь не передана]");
  return withoutWiki
    .replace(/!?\[[^[\]]*\]\([^)]*\)/g, "[ссылка не передана]")
    .replace(/<[^<>]*>/g, "")
    .replace(/(?:https?:\/\/|file:\/\/|orion:\/\/|data:)[^\s]+/gi, "[адрес не передан]")
    .replace(/!?\[[^[\]]*\]\[[^[\]]*\]/g, "[ссылка не передана]")
    .replace(/^[ \t]*\[[^\]\r\n]+\]:.*$/gm, "");
}
