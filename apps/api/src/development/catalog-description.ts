import { ConflictException } from "@nestjs/common";

/** Persist the catalog's acceptance criteria as ordinary Orion descriptions. */
export function developmentDescription(row: { phase?: string; acceptance?: readonly string[] }): string {
  if ((row.phase !== undefined && (typeof row.phase !== "string" || !row.phase)) ||
      (row.acceptance !== undefined && (!Array.isArray(row.acceptance) ||
        row.acceptance.some(value => typeof value !== "string" || !value.trim())))) {
    throw new ConflictException("Invalid catalog phase or acceptance criteria");
  }
  return [row.phase ? `ORION DEV · ${row.phase}` : "ORION DEV",
    ...(row.acceptance?.length ? ["Критерии приёмки:", ...row.acceptance.map(value => `- ${value}`)] : [])
  ].join("\n");
}
