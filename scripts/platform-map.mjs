#!/usr/bin/env node
import { buildSync } from "esbuild";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_MODELS, CORE_MODULE_DIRS, MODEL_OWNERS, moduleOfPath } from "./module-ownership.mjs";
import { MODULE_BOUNDARY_EXCEPTIONS } from "./module-boundary-exceptions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MAP_PATH = "docs/platform-api/capabilities.generated.json";
const slash = value => value.replaceAll("\\", "/");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}

/** Load only repository contracts; no server, user config, database, or network access. */
export async function buildPlatformMap() {
  const result = buildSync({ entryPoints: [join(root, "packages/shared-types/src/index.ts")], bundle: true, write: false, format: "esm", platform: "node", target: "node22" });
  const contracts = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
  const source = [...files(join(root, "apps/api/src")), ...files(join(root, "apps/web/lib/extensions"))].map(f => slash(relative(root, f))).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
  const publicContracts = source.filter(f => f.includes("/public/") || f.startsWith("apps/web/lib/extensions/"));
  const registryEntryPoints = source.filter(f => /registry[^/]*\.ts$/.test(f));
  const passports = files(join(root, "apps/api/src")).filter(f => f.endsWith("/MODULE.md") || f.endsWith("\\MODULE.md") || f.endsWith("/AI_CONTEXT.md") || f.endsWith("\\AI_CONTEXT.md")).map(f => slash(relative(root, f))).sort();
  const moduleSources = Object.fromEntries(passports.filter(p => p.endsWith("/MODULE.md")).flatMap(p => {
    const id = readFileSync(join(root, p), "utf8").match(/\| id \/ версия \| `([^`]+)`/u)?.[1];
    return id ? [[id, slash(dirname(p))]] : [];
  }));
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
  const slotText = readFileSync(join(root, "apps/web/lib/extensions/contracts.ts"), "utf8");
  const slotBody = slotText.split("export interface SlotContracts {")[1]?.split("\n}")[0] ?? "";
  return {
    schemaVersion: "1.0.0",
    meaning: "Declarations generated from code, not runtime acceptance or test results",
    platformVersion: contracts.PLATFORM_API_VERSION,
    contractVersions: contracts.PLATFORM_CONTRACT_VERSIONS,
    components: contracts.COMPONENT_MANIFESTS.map(component => {
      const sourceDirectory = component.kind === "module" ? moduleSources[component.id] ?? null : ["apps/web/plugins", "apps/web/plugins-ext"].map(p => `${p}/${component.id}`).find(p => existsSync(join(root, p))) ?? null;
      const owner = sourceDirectory?.startsWith("apps/api/src/") ? moduleOfPath(sourceDirectory.slice("apps/api/src/".length)) : null;
      return { ...component, sourceDirectory, dataModels: owner ? [...MODEL_OWNERS].filter(([, value]) => value === owner).map(([key]) => key).sort() : [] };
    }),
    dataOwnership: { core: [...CORE_MODELS].sort(), modules: Object.fromEntries([...MODEL_OWNERS].sort(([a], [b]) => a.localeCompare(b, "en"))) },
    coreDirectories: [...CORE_MODULE_DIRS].sort(),
    publicContracts,
    registryEntryPoints,
    uiSlots: [...slotBody.matchAll(/^\s*"([^"]+)"\s*:/gm)].map(m => m[1]).sort(),
    events: { types: contracts.DOMAIN_EVENT_TYPES, subscriptions: contracts.DOMAIN_EVENT_SUBSCRIPTIONS },
    permissions: contracts.PERMISSION_IDS,
    passports,
    commands: Object.fromEntries(Object.entries(scripts).filter(([name]) => /^(create:module|orion-ext|module-registry|module-docs|platform-map|architecture-check|plugin-contract-check|typecheck|lint|test|db:generate)/.test(name))),
    boundaryExceptions: MODULE_BOUNDARY_EXCEPTIONS,
    boundaryCheckLimits: ["Prisma delegates in *.service.ts; receiver names tx/trx/db/client/prisma", "Raw SQL and arbitrary aliases require manual review", "Public contract paths are discovery entries, not permission grants"],
    governingDocuments: ["AGENTS.md", "ORION_CONSTITUTION.md", "docs/PLATFORM.md", "docs/STATUS.md", "docs/AI_REFACTOR_MIGRATION_MAP.md"]
  };
}

export async function platformMapProblems() {
  const expected = JSON.stringify(await buildPlatformMap(), null, 2) + "\n";
  const file = join(root, MAP_PATH);
  return !existsSync(file) || readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== expected ? [`${MAP_PATH}: устарел; pnpm platform-map`] : [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--component")) {
    const id = process.argv[process.argv.indexOf("--component") + 1];
    const component = (await buildPlatformMap()).components.find(c => c.id === id);
    if (!component) { console.error(`Unknown component: ${id}`); process.exitCode = 1; }
    else console.log(JSON.stringify(component, null, 2));
  } else if (process.argv.includes("--check")) {
    const problems = await platformMapProblems();
    if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
    else console.log("Platform map: OK");
  } else {
    writeFileSync(join(root, MAP_PATH), JSON.stringify(await buildPlatformMap(), null, 2) + "\n");
    console.log(`Generated ${MAP_PATH}`);
  }
}
