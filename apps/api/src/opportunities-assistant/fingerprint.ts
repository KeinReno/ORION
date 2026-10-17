import { createHash } from "node:crypto";
import type { AssessmentInputs, Opportunity } from "@orion/shared-types";
import type { ProfileEvidence } from "../opportunities-profiles/public";

/**
 * Отпечаток входных данных оценки/черновика. Любое существенное изменение вакансии, фактов, предпочтений, треков или
 * активного резюме меняет отпечаток, и прежняя оценка/одобрение становятся устаревшими. Отпечаток считается по
 * СОДЕРЖИМОМУ (а не по номеру ревизии), чтобы смена статуса или архивирование карточки не делали оценку устаревшей зря.
 */

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export type Components = AssessmentInputs["components"];

export function computeComponents(opportunity: Opportunity, evidence: ProfileEvidence): Components {
  return {
    opportunity: sha256(stable({ kind: opportunity.kind, title: opportunity.title, organizationName: opportunity.organizationName, description: opportunity.description, conditions: opportunity.conditions })),
    preferences: sha256(stable(evidence.profile.preferences)),
    facts: sha256(stable(evidence.facts.map((f) => [f.id, f.revision, f.state]).sort())),
    tracks: sha256(stable(evidence.tracks.map((t) => [t.id, t.name]).sort())),
    resume: sha256(evidence.activeResume ? `${evidence.activeResume.id}:${evidence.activeResume.contentHash}` : "none")
  };
}

export const inputHash = (components: Components, providerId: string, rulesVersion: string) => sha256(stable({ components, providerId, rulesVersion }));

const LABEL: Record<keyof Components, string> = {
  opportunity: "Изменилась карточка вакансии или заказа (название, описание, условия)",
  preferences: "Изменились предпочтения профиля",
  facts: "Изменились факты профиля (текст, подтверждение, оспаривание или архив)",
  tracks: "Изменились треки профиля",
  resume: "Изменилось активное резюме"
};

export function staleReasons(stored: Components, current: Components): string[] {
  return (Object.keys(LABEL) as (keyof Components)[]).filter((key) => stored[key] !== current[key]).map((key) => LABEL[key]);
}
