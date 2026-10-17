import type { Prisma } from "@prisma/client";

/** Public v1 read boundary: profile facts and the chosen resume, for the assistant. Read-only, archived facts are never exposed. */
export const PROFILE_EVIDENCE_PORT = Symbol("OPPORTUNITY_PROFILE_EVIDENCE_PORT.v1");
export interface ProfileEvidenceFact { id: string; statement: string; category: string; source: string; state: "unverified" | "confirmed" | "disputed"; revision: number }
export interface ProfileEvidence {
  profile: { id: string; revision: number; displayName: string; kind: "person" | "team"; archivedAt: string | null; preferences: { city: string; workFormats: ("remote" | "hybrid" | "office")[]; minSalaryNetRub: number | null; excludedCompanies: string[]; excludedRoles: string[] } };
  facts: ProfileEvidenceFact[];
  tracks: { id: string; name: string }[];
  activeResume: { id: string; title: string; type: string; contentHash: string; content: string } | null;
}
export interface ProfileEvidencePort {
  /** Membership + enabled profiles plugin are checked in the caller's transaction. Profile must belong to this workspace. */
  readEvidenceTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, profileId: string): Promise<ProfileEvidence>;
}
