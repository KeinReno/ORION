import { ConflictException } from "@nestjs/common";
import type { planDevelopmentImport } from "./catalog-server-plan";

export type DevelopmentPreview = ReturnType<typeof planDevelopmentImport>;

export function requireReviewedPreviewMatches(preview: DevelopmentPreview, choices: Record<string, string>): void {
  const expected = preview.actions.filter(row => row.action === "review_possible_match");
  if (Object.keys(choices).length !== expected.length) throw new ConflictException("Incomplete preview decisions");
  for (const row of expected) {
    if (choices[row.kind + ":" + row.externalId] !== row.candidateId) {
      throw new ConflictException("Stale preview decision");
    }
  }
}
