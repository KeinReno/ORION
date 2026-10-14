import type { Opportunity } from "@orion/shared-types";

/** UTF-8/BOM and semicolon suit the Russian Excel workflow; every value is escaped. */
export function opportunitiesCsv(rows: Opportunity[]): string {
  const columns: (keyof Opportunity)[] = ["id", "workspaceId", "kind", "title", "organizationName", "description", "status", "sourceType", "canonicalUrl", "externalId", "conditions", "revision", "capturedAt", "archivedAt", "createdAt", "updatedAt", "history"];
  function cell(value: unknown): string {
    const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    // Quoting alone does not stop Excel interpreting a cell as a formula.
    const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return "\uFEFF" + [columns.join(";"), ...rows.map((row) => columns.map((key) => cell(row[key])).join(";"))].join("\r\n");
}
