import type { Prisma } from "@prisma/client";

export const PROFILE_IMPORT_PORT = Symbol("OPPORTUNITY_PROFILE_IMPORT_PORT.v1");
export interface ProfileImportMaterial { candidateName: string; profileSourceKey: string; title: string; sourcePath: string; sourceKey: string; content: string; contentHash: string }
export interface ProfileImportPort {
  importMaterialTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: ProfileImportMaterial): Promise<{ profileId: string; profileCreated: boolean; materialCreated: boolean }>;
  assertImportTargetTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, profileId: string): Promise<void>;
}
