import { Injectable } from "@nestjs/common";
import type { ResolveUserByEmailResult } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

/**
 * R29-05 (docs/SONNET_IMPLEMENTATION/29-REVIEW-GRANTS.md) — the "по email"
 * half of the grant-issue recipient picker. `WorkspacesService.searchMembers`
 * only ever sees people already inside a workspace the caller owns; this is
 * the deliberately narrow escape hatch for "share with someone who isn't a
 * member of my source workspace, without making them one" (раздел 6 of the
 * review — a grant's whole point is access WITHOUT membership).
 *
 * NOT a general user directory: exact email match only (no substring/prefix
 * search), and the result never distinguishes "no such account" from
 * "account exists" in its wording — both come back as `{ found: false }` —
 * so this can't be walked as an oracle to enumerate registered emails one
 * guess at a time. This is intentionally the smallest possible slice: no
 * contacts list, no pending-invite-for-nonexistent-email flow. Those are
 * documented future work, not implemented here.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveByEmail(callerUserId: string, email: string): Promise<ResolveUserByEmailResult> {
    const trimmed = email.trim().toLowerCase();
    if (trimmed.length === 0) return { found: false };
    // No workspace context applies here by definition (the whole point is
    // finding someone OUTSIDE the caller's own workspaces), so an ordinary
    // `withUser` read — which only ever sees rows a workspace-membership RLS
    // policy allows — cannot do this lookup. `asSystem` is the same narrow,
    // audited exception `SharedGrantsService.listMine`/`listForWorkspace`
    // already use to resolve a display name outside the caller's own
    // workspaces; this widens it by one field (email match instead of id
    // match) but keeps the same "authenticated caller, minimal output" shape.
    const user = await this.prisma.asSystem((tx) =>
      tx.user.findUnique({ where: { email: trimmed }, select: { id: true, name: true } })
    );
    if (!user || user.id === callerUserId) return { found: false };
    return { found: true, userId: user.id, name: user.name };
  }
}
