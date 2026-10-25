const part = "(?:0|[1-9]\\d*)";
export const COMPONENT_VERSION_RE = new RegExp(`^${part}\\.${part}\\.${part}$`);
const range = new RegExp(`^(?:\\^|~|>=)?${part}\\.${part}\\.${part}$`);

/** Source metadata is data, never executable policy. Errors fail registry generation. */
export function requirementErrors(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["requires — объект"];
  const errors = [];
  for (const key of Object.keys(value)) if (!["platform", "modules", "moduleVersions", "contracts"].includes(key)) errors.push(`requires.${key} неизвестно`);
  if (value.platform !== undefined && (typeof value.platform !== "string" || !range.test(value.platform))) errors.push("requires.platform — диапазон semver");
  if (value.modules !== undefined && (!Array.isArray(value.modules) || value.modules.some((id) => typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) || new Set(value.modules).size !== value.modules.length)) errors.push("requires.modules — уникальные id модулей");
  for (const key of ["moduleVersions", "contracts"]) {
    if (value[key] === undefined) continue;
    if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) { errors.push(`requires.${key} — объект диапазонов`); continue; }
    for (const [id, version] of Object.entries(value[key])) {
      if (typeof version !== "string" || !range.test(version)) errors.push(`requires.${key}.${id} — диапазон semver`);
      if (key === "moduleVersions" && !value.modules?.includes(id)) errors.push(`requires.moduleVersions.${id} не объявлен в requires.modules`);
    }
  }
  return errors;
}
