import type { AgentPolicySubject, AgentScope } from "@orion/shared-types";

/** Authenticated agent identity and grants supplied by AgentTokenGuard. */
export interface AgentContext extends AgentPolicySubject {
  tokenId: string;
  tokenName: string;
  workspaceId: string;
  userId: string;
  scopes: AgentScope[];
  modulePermissions: string[];
  allowedProjectIds: string[];
  writeLimitPerHour: number | null;
  autoCommitProjectIds: string[];
}
