import { z } from "zod";
import { opportunitySchema } from "./opportunity";

/** Shared allowlist; an uploaded script/browser profile is metadata to skip, never executable input. */
export function normalizeHhPath(path: string): string | null {
  const value = path.replace(/\\/g, "/");
  if (!value || value.startsWith("/") || /^[a-z]:/i.test(value) || value.includes("\0")) return null;
  const parts = value.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return null;
  if (parts[0].toLowerCase() === "hh") parts.shift();
  return parts.join("/") || null;
}
export function classifyHhPath(path: string): "resume" | "vacancy" | "history" | "excluded" | "unsupported" {
  const normalized = normalizeHhPath(path);
  if (!normalized) return "excluded";
  const parts = normalized.split("/"); const name = parts[parts.length - 1];
  if (parts.some((p) => p.startsWith(".") || /^(?:hh_.*profile|logs|tmp|__pycache__|hh_edit_shots|autonomous_sessions)$/i.test(p)) || /storage_state|browser_state|cookies|local state|autopilot/i.test(name)) return "excluded";
  if (/\.(?:py|pyc|ps1|exe|dll|html|png|log)$/i.test(name)) return "excluded";
  if (/\.(?:md|txt)$/i.test(name) && /резюме|resume_extracted|вставить_в_hh/i.test(normalized)) return "resume";
  if (/^(?:vacancies_|hh_(?:vacancies|it_vacancies|target_vacancies)|target_vacancies|fresh_vacancies|api_fresh_candidates|search_fintech_ba).*\.json$/i.test(name)) return "vacancy";
  if (/\.json$/i.test(name) && (parts.includes("applications") || name === "applications_log.json")) return "history";
  return "unsupported";
}
export const hhImportPreviewInputSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1).max(500), text: z.string().max(200000) }).strict()).min(1).max(250),
  includeProfiles: z.boolean().default(false), includeHistory: z.boolean().default(false),
  historyProfileId: z.string().uuid().nullable().default(null),
  acknowledgeWorkspaceVisibility: z.literal(true)
}).strict().refine((v) => JSON.stringify(v).length <= 500000, "Пакет слишком большой. Выберите меньше файлов (до 1 МБ текстовых данных).");
export type HhImportPreviewInput = z.infer<typeof hhImportPreviewInputSchema>;
export const hhImportApplyInputSchema = z.object({ manifestHash: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().nonnegative() }).strict();
export type HhImportApplyInput = z.infer<typeof hhImportApplyInputSchema>;
export const hhImportReportSchema = z.object({ opportunitiesCreated: z.number(), opportunitiesExisting: z.number(), capturesCreated: z.number(), profilesCreated: z.number(), materialsCreated: z.number(), materialsExisting: z.number(), historyCreated: z.number(), historyExisting: z.number(), possibleDuplicates: z.number() });
export type HhImportReport = z.infer<typeof hhImportReportSchema>;
export const hhImportRunSchema = z.object({
  id: z.string(), workspaceId: z.string(), manifestHash: z.string(), revision: z.number(),
  status: z.enum(["preview", "applying", "applied", "canceled"]), checkpoint: z.number(), total: z.number(),
  expiresAt: z.string(), createdAt: z.string(), report: hhImportReportSchema,
  preview: z.object({ opportunities: z.number(), materials: z.number(), history: z.number(),
    candidateNames: z.array(z.string()), samples: z.array(z.object({ title: z.string(), sourcePath: z.string() })),
    warnings: z.array(z.object({ path: z.string(), reason: z.string() })) })
});
export type HhImportRun = z.infer<typeof hhImportRunSchema>;
export const hhOpportunitySourcesSchema = z.object({ captures: z.array(z.object({ id: z.string(), sourcePath: z.string(), fileHash: z.string(), contentHash: z.string(), snapshot: z.object({ title: z.string(), company: z.string(), description: z.string(), url: z.string(), conditions: opportunitySchema.shape.conditions }), historical: z.boolean(), capturedAt: z.string() })), history: z.array(z.object({ id: z.string(), profileId: z.string().nullable(), title: z.string(), outcome: z.enum(["already_exists", "legacy_claimed_verified", "failed", "unconfirmed"]), originalStatus: z.string(), reason: z.string(), sourceTime: z.string().nullable(), sourcePath: z.string(), possibleDuplicate: z.boolean() })), limit: z.number() });
