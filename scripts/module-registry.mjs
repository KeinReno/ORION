#!/usr/bin/env node
/**
 * G5/G10 — генератор реестра подключаемых модулей (docs/platform-api/MODULE_REGISTRY.md).
 *
 * Модуль подключается добавлением СВОИХ каталогов с манифестом, без правки файлов ядра:
 *
 *   apps/api/src/modules-ext/<id>/module.manifest.json   ← манифест (единственная точка обнаружения)
 *   apps/api/src/modules-ext/<id>/                       ← Nest-модуль, prisma/models.prisma, prisma/*.sql
 *   apps/web/modules-ext/<id>/                           ← панель
 *   packages/shared-types/src/modules-ext/<id>/index.ts  ← zod-контракты
 *   apps/api/test/modules-ext/<id>/                      ← интеграционные тесты модуля
 *
 * Скрипт сканирует манифесты и (пере)записывает ГЕНЕРИРУЕМЫЕ файлы — единственное общее место, меняющееся
 * при подключении модуля:
 *
 *   packages/shared-types/src/modules-ext/registry.generated.ts   id, запись каталога, основной ресурс, реэкспорт схем
 *   apps/api/src/modules-ext/modules.generated.ts                 список Nest-модулей для app.module.ts
 *   apps/api/src/modules-ext/data.generated.ts                    политика снапшота и класс синхронизации моделей
 *   apps/web/modules-ext/panels.generated.ts                      определения панелей для panel-registry.ts
 *   scripts/module-ownership.generated.mjs                        владельцы моделей для правила границ (G4)
 *   apps/api/prisma/schema.prisma                                 только области между маркерами <module-registry:…>
 *   apps/api/prisma/migrations/<name>/migration.sql               копия миграции модуля
 *
 * Тем же проходом подключаются плагины интерфейса из apps/web/plugins-ext/<id>/plugin.manifest.json
 * (scripts/plugin-registry.mjs): их id и каталог, вклады в слоты.
 *
 * Использование:
 *   node scripts/module-registry.mjs                 записать
 *   node scripts/module-registry.mjs --check         сверить с диском (CI / architecture-check), код 1 при расхождении
 *   node scripts/module-registry.mjs --check-diff <base>
 *                                                    изменения base..HEAD, добавляющие модуль, не должны трогать файлы ядра
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENT_VERSION_RE, requirementErrors } from "./component-requirements.mjs";
import { PLUGIN_GENERATED_FILES, PLUGIN_MANIFEST_FILE, PLUGIN_PATHS, allowedPathsForPlugins, collectPlugins, renderPluginOutputs } from "./plugin-registry.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * G10: шаблон изоляции по пространству — единственный вид RLS, который модуль получает без ручного SQL.
 * Текст обязан совпадать с политиками ядра (`workspace_members` по `app.current_user_id`): структурный тест api-rls это проверяет.
 */
export function workspaceMemberRlsBlock(table) {
  return [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY ${table}_isolation ON "${table}"`,
    `  USING (EXISTS (`,
    `    SELECT 1 FROM "workspace_members" wm`,
    `    WHERE wm."workspaceId" = "${table}"."workspaceId"`,
    `      AND wm."userId" = current_setting('app.current_user_id', true)`,
    `  ));`,
    ""
  ].join("\n");
}

export const MANIFEST_FILE = "module.manifest.json";
const HEADER = "// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.\n// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.\n";

const PATHS = {
  apiExt: "apps/api/src/modules-ext",
  webExt: "apps/web/modules-ext",
  sharedExt: "packages/shared-types/src/modules-ext",
  apiTestExt: "apps/api/test/modules-ext",
  schema: "apps/api/prisma/schema.prisma",
  migrations: "apps/api/prisma/migrations",
  coreModules: "packages/shared-types/src/modules.ts"
};

export const GENERATED_FILES = [
  `${PATHS.sharedExt}/registry.generated.ts`,
  `${PATHS.sharedExt}/agent-tools.generated.ts`,
  `${PATHS.apiExt}/modules.generated.ts`,
  `${PATHS.apiExt}/data.generated.ts`,
  `${PATHS.webExt}/panels.generated.ts`,
  "scripts/module-ownership.generated.mjs",
  ...PLUGIN_GENERATED_FILES
];

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ICON_RE = /^[A-Z][A-Za-z0-9]*$/;
const MIGRATION_RE = /^\d{14}_[a-z0-9_]+$/;
const SNAPSHOT_POLICIES = ["included", "derived", "identity-excluded", "secret-excluded", "ephemeral-excluded"];
const SYNC_CLASSES = ["mergeable-text", "lww-fields", "append-only", "strict", "not-synced"];
const SYNC_STAGES = ["stage2", "stage3", "later", "never"];
const AGENT_TOOL_OPS = ["read", "create", "delete"];
const AGENT_TOOL_METHOD = { read: "GET", create: "POST", delete: "DELETE" };
/** `delete` is never executed by the agent: the tool files a request a human confirms (`AgentModuleToolsService.change`). */
const AGENT_TOOL_EFFECT = { read: "read", create: "create", delete: "delete_request" };
const CATALOG_STRING_FIELDS = ["label", "summary", "owns", "livesWithout", "disableBehavior", "panelId"];

const pascal = (id) => id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
const json = (value) => JSON.stringify(value, null, 2);

function read(root, path) {
  return readFileSync(join(root, path), "utf8");
}

/** Идентификаторы ядра: из `CORE_MODULE_IDS` в modules.ts — чтобы поймать столкновение id. */
function coreModuleIds(root) {
  const file = join(root, PATHS.coreModules);
  if (!existsSync(file)) return [];
  const match = /CORE_MODULE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(readFileSync(file, "utf8"));
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [];
}

/** Имена моделей и таблиц (`@@map`) из фрагмента schema.prisma. */
export function parsePrismaFragment(text) {
  const models = [];
  for (const match of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const table = /@@map\("([^"]+)"\)/.exec(match[2]);
    models.push({ name: match[1], table: table ? table[1] : null, hasWorkspaceId: /^\s*workspaceId\s+String\b/m.test(match[2]) });
  }
  return models;
}

/** Читает и проверяет все манифесты. Возвращает `{ modules, errors }`; при ошибках модуль в `modules` не попадает. */
export function collectModules(root = defaultRoot) {
  const errors = [];
  const modules = [];
  const apiExt = join(root, PATHS.apiExt);
  const core = new Set(coreModuleIds(root));
  const entries = existsSync(apiExt) ? readdirSync(apiExt, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
  const seenIds = new Set();
  const seenExports = new Set();
  const seenMigrations = new Set();
  const seenModels = new Set();
  const seenToolNames = new Set();

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = `${PATHS.apiExt}/${entry.name}`;
    const manifestPath = `${dir}/${MANIFEST_FILE}`;
    if (!existsSync(join(root, manifestPath))) {
      errors.push(`${dir}: нет ${MANIFEST_FILE} — каталог модуля обязан содержать манифест`);
      continue;
    }
    const problems = [];
    const fail = (message) => problems.push(`${manifestPath}: ${message}`);
    let manifest;
    try {
      manifest = JSON.parse(read(root, manifestPath));
    } catch (error) {
      errors.push(`${manifestPath}: не JSON (${error.message})`);
      continue;
    }

    const id = manifest.id;
    if (typeof id !== "string" || !ID_RE.test(id)) fail(`id "${id}" должен быть в kebab-case`);
    else {
      if (id !== entry.name) fail(`id "${id}" не совпадает с именем каталога "${entry.name}"`);
      if (core.has(id)) fail(`id "${id}" занят модулем ядра`);
      if (seenIds.has(id)) fail(`id "${id}" уже объявлен другим манифестом`);
    }
    if (typeof manifest.version !== "string" || !COMPONENT_VERSION_RE.test(manifest.version)) fail("version должен быть semver");
    for (const error of requirementErrors(manifest.requires)) fail(error);

    const catalog = manifest.catalog ?? {};
    for (const field of CATALOG_STRING_FIELDS) {
      if (typeof catalog[field] !== "string" || catalog[field] === "") fail(`catalog.${field} — непустая строка`);
    }
    if (!["base", "additional"].includes(catalog.kind)) fail('catalog.kind — "base" | "additional"');
    for (const field of ["required", "defaultEnabled"]) {
      if (typeof catalog[field] !== "boolean") fail(`catalog.${field} — boolean`);
    }
    if (!Array.isArray(catalog.provides) || catalog.provides.some((item) => typeof item !== "string")) fail("catalog.provides — массив строк");
    if (!Array.isArray(catalog.optionalDependencies) || catalog.optionalDependencies.some((item) => typeof item !== "string")) {
      fail("catalog.optionalDependencies — массив id модулей");
    }
    if (typeof manifest.permissions?.primaryResource !== "string" || !/^[a-z_]+$/.test(manifest.permissions.primaryResource)) {
      fail("permissions.primaryResource — строка вида [a-z_]+ (ресурс для реестра разрешений)");
    }

    const apiModule = manifest.api?.module;
    if (!apiModule || typeof apiModule.file !== "string" || typeof apiModule.export !== "string") fail("api.module = { file, export }");
    else {
      if (!existsSync(join(root, `${dir}/${apiModule.file}.ts`))) fail(`нет файла ${dir}/${apiModule.file}.ts`);
      if (seenExports.has(apiModule.export)) fail(`экспорт Nest-модуля ${apiModule.export} уже занят`);
    }

    if (typeof manifest.api?.probePath !== "string" || !manifest.api.probePath.startsWith("/")) {
      fail('api.probePath — GET-маршрут внутри пространства (например "/pet-care/pets"), который отвечает 200 при включённом модуле и 409 при выключенном');
    }

    const panel = manifest.web?.panel;
    if (!panel || ["id", "label", "icon", "file", "export", "group"].some((key) => typeof panel[key] !== "string")) {
      fail("web.panel = { id, label, icon, group, file, export }");
    } else {
      if (!ICON_RE.test(panel.icon)) fail(`web.panel.icon "${panel.icon}" — имя компонента lucide-react`);
      if (panel.id !== catalog.panelId) fail("web.panel.id должен совпадать с catalog.panelId");
      if (!existsSync(join(root, `${PATHS.webExt}/${entry.name}/${panel.file}.tsx`))) fail(`нет файла ${PATHS.webExt}/${entry.name}/${panel.file}.tsx`);
    }

    if (!existsSync(join(root, `${PATHS.sharedExt}/${entry.name}/index.ts`))) fail(`нет ${PATHS.sharedExt}/${entry.name}/index.ts (zod-контракты)`);

    const prismaDecl = manifest.prisma ?? {};
    const models = Array.isArray(manifest.data?.models) ? manifest.data.models : [];
    let fragment = "";
    let parsedModels = [];
    if (prismaDecl.fragment) {
      const fragmentPath = `${dir}/${prismaDecl.fragment}`;
      if (!existsSync(join(root, fragmentPath))) fail(`нет фрагмента Prisma ${fragmentPath}`);
      else {
        fragment = read(root, fragmentPath).trim();
        parsedModels = parsePrismaFragment(fragment);
      }
    }
    const declared = new Set(models.map((item) => item.model));
    for (const parsed of parsedModels) {
      if (!declared.has(parsed.name)) fail(`модель ${parsed.name} из фрагмента не описана в data.models (политика снапшота и класс синхронизации обязательны)`);
      if (!parsed.table) fail(`модель ${parsed.name}: нужен @@map("таблица")`);
      if (!parsed.hasWorkspaceId) fail(`модель ${parsed.name}: нужна колонка workspaceId (изоляция по пространству)`);
    }
    for (const item of models) {
      if (!parsedModels.some((parsed) => parsed.name === item.model)) fail(`data.models: модели ${item.model} нет во фрагменте Prisma`);
      if (seenModels.has(item.model)) fail(`модель ${item.model} уже объявлена другим модулем`);
      seenModels.add(item.model);
      if (!SNAPSHOT_POLICIES.includes(item.snapshotPolicy)) fail(`${item.model}: snapshotPolicy ∈ ${SNAPSHOT_POLICIES.join(" | ")}`);
      if (typeof item.reason !== "string" || item.reason === "") fail(`${item.model}: reason (почему такая политика) обязателен`);
      if (item.snapshotPolicy === "included") {
        if (typeof item.snapshotKey !== "string" || typeof item.delegate !== "string") fail(`${item.model}: для included нужны snapshotKey и delegate`);
      } else if (item.snapshotKey != null) fail(`${item.model}: snapshotKey допустим только для included`);
      const sync = item.sync ?? {};
      if (!SYNC_CLASSES.includes(sync.syncClass) || !SYNC_STAGES.includes(sync.stage) || typeof sync.note !== "string" || sync.note === "") {
        fail(`${item.model}: sync = { syncClass ∈ ${SYNC_CLASSES.join(" | ")}, stage ∈ ${SYNC_STAGES.join(" | ")}, note }`);
      }
    }
    const backRelations = Array.isArray(prismaDecl.workspaceBackRelations) ? prismaDecl.workspaceBackRelations : [];
    if (parsedModels.length > 0 && backRelations.length === 0) fail("prisma.workspaceBackRelations: Prisma требует обратное поле в модели Workspace");

    const migrations = [];
    for (const item of Array.isArray(prismaDecl.migrations) ? prismaDecl.migrations : []) {
      if (!MIGRATION_RE.test(item.name ?? "")) fail(`миграция "${item.name}": имя вида ГГГГММДДЧЧММСС_имя`);
      else if (seenMigrations.has(item.name)) fail(`миграция ${item.name} уже объявлена`);
      const sqlPath = `${dir}/${item.file}`;
      if (!existsSync(join(root, sqlPath))) fail(`нет файла миграции ${sqlPath}`);
      else {
        let sql = read(root, sqlPath);
        if (item.rls === "workspace-member") {
          // RLS выводится из шаблона для каждой созданной здесь таблицы модуля с workspaceId; руками его в файле не пишут.
          if (/ENABLE ROW LEVEL SECURITY/.test(sql)) fail(`миграция ${item.name}: rls задан шаблоном — уберите ручной ENABLE ROW LEVEL SECURITY из ${sqlPath}`);
          const created = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
          const own = parsedModels.filter((parsed) => parsed.table && parsed.hasWorkspaceId && created.includes(parsed.table)).map((parsed) => parsed.table);
          const ordered = created.filter((table) => own.includes(table));
          if (ordered.length === 0) fail(`миграция ${item.name}: rls задан, но она не создаёт таблиц модуля с workspaceId`);
          else sql = `${sql.trimEnd()}\n\n-- Row Level Security\n${ordered.map(workspaceMemberRlsBlock).join("\n")}`;
        } else if (item.rls !== undefined) fail(`миграция ${item.name}: rls ∈ "workspace-member"`);
        migrations.push({ name: item.name, sql });
      }
    }
    if (parsedModels.length > 0) {
      const sql = migrations.map((item) => item.sql).join("\n");
      for (const parsed of parsedModels) {
        if (!parsed.table) continue;
        if (!new RegExp(`ALTER TABLE "${parsed.table}" ENABLE ROW LEVEL SECURITY`).test(sql) ||
            !new RegExp(`ALTER TABLE "${parsed.table}" FORCE ROW LEVEL SECURITY`).test(sql) ||
            !new RegExp(`CREATE POLICY \\w+ ON "${parsed.table}"`).test(sql)) {
          fail(`таблица ${parsed.table}: в миграциях модуля нет ENABLE + FORCE ROW LEVEL SECURITY и CREATE POLICY`);
        }
      }
    }

    // G13: инструменты для ИИ-агентов. Разрешение выводится из реестра (`<id>.<основной ресурс>.<op>`), а не объявляется руками;
    // чтение, создание и удаление (удаление — всегда запрос человеку на подтверждение, обработчик регистрирует контроллер).
    const agentTools = [];
    const toolPrefix = typeof id === "string" ? `orion_${id.replaceAll("-", "_")}_` : "";
    for (const tool of Array.isArray(manifest.agent?.tools) ? manifest.agent.tools : []) {
      const label = `agent.tools "${tool?.name}"`;
      if (typeof tool?.name !== "string" || !tool.name.startsWith(toolPrefix) || !/^orion_[a-z_]+$/.test(tool.name)) fail(`${label}: имя вида ${toolPrefix}<действие>`);
      if (!AGENT_TOOL_OPS.includes(tool?.op)) fail(`${label}: op ∈ ${AGENT_TOOL_OPS.join(" | ")}`);
      if (typeof tool?.description !== "string" || tool.description === "") fail(`${label}: description обязателен`);
      const route = tool?.http;
      if (!["GET", "POST", "PATCH", "DELETE"].includes(route?.method) || typeof route?.path !== "string" || !route.path.startsWith(`/ai/v1/${id}/`)) {
        fail(`${label}: http = { method, path }, путь начинается с /ai/v1/${id}/`);
      } else if (AGENT_TOOL_OPS.includes(tool.op) && route.method !== AGENT_TOOL_METHOD[tool.op]) fail(`${label}: read ↔ GET, create ↔ POST, delete ↔ DELETE`);
      const schema = tool?.input;
      if (schema?.type !== "object" || schema.additionalProperties !== false || typeof schema.properties !== "object" || !Array.isArray(schema.required)) {
        fail(`${label}: input — JSON-схема { type: "object", properties, required, additionalProperties: false }`);
      } else {
        for (const name of schema.required) if (!(name in schema.properties)) fail(`${label}: required "${name}" нет в properties`);
        for (const [, param] of String(route?.path ?? "").matchAll(/\{(\w+)\}/g)) {
          if (!schema.required.includes(param)) fail(`${label}: параметр пути {${param}} должен быть обязательным в input`);
        }
      }
      if (agentTools.some((item) => item.name === tool?.name) || seenToolNames.has(tool?.name)) fail(`${label}: имя инструмента уже занято`);
      agentTools.push(tool);
    }
    const primaryResource = manifest.permissions?.primaryResource;
    const agentController = manifest.agent?.controller;
    if (agentTools.length > 0) {
      if (typeof agentController?.file !== "string" || typeof agentController?.export !== "string") fail("agent.controller = { file, export } — контроллер маршрутов ai/v1/<модуль>/* обязателен, если объявлены agent.tools");
      else if (!existsSync(join(root, `${dir}/${agentController.file}.ts`))) fail(`нет файла ${dir}/${agentController.file}.ts`);
    }

    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }
    for (const tool of agentTools) seenToolNames.add(tool.name);
    seenIds.add(id);
    seenExports.add(apiModule.export);
    for (const item of migrations) seenMigrations.add(item.name);
    modules.push({ id, dir, name: entry.name, manifest, fragment, models, migrations, backRelations, agentTools, primaryResource, agentController: agentTools.length > 0 ? agentController : null });
  }
  return { modules, errors };
}

/** Модули и плагины вместе: плагин вправе расширять модуль ядра или модуль, подключённый манифестом. */
export function collectAll(root = defaultRoot) {
  const { modules, errors } = collectModules(root);
  const { plugins, errors: pluginErrors } = collectPlugins(root, [...coreModuleIds(root), ...modules.map((m) => m.id)]);
  return { modules, plugins, errors: [...errors, ...pluginErrors] };
}

/** Заменяет область между маркерами `<module-registry:name>`; null, если маркеров нет. */
export function spliceRegion(content, name, body) {
  const start = `// <module-registry:${name}>`;
  const end = `// </module-registry:${name}>`;
  const startAt = content.indexOf(start);
  const endAt = content.indexOf(end);
  if (startAt === -1 || endAt === -1 || endAt < startAt) return null;
  const lineStart = content.lastIndexOf("\n", startAt) + 1;
  const indent = content.slice(lineStart, startAt);
  const inner = body.length > 0 ? body.map((line) => (line === "" ? "" : indent + line)).join("\n") + "\n" : "";
  return content.slice(0, startAt + start.length) + "\n" + inner + indent + content.slice(endAt);
}

/** Всё, что должно лежать на диске: путь → содержимое. */
export function renderOutputs(modules, root = defaultRoot, plugins = []) {
  const out = new Map(renderPluginOutputs(plugins));

  const ids = modules.map((m) => m.id);
  const catalog = modules.map((m) => ({
    id: m.id,
    kind: m.manifest.catalog.kind,
    required: m.manifest.catalog.required,
    label: m.manifest.catalog.label,
    summary: m.manifest.catalog.summary,
    owns: m.manifest.catalog.owns,
    livesWithout: m.manifest.catalog.livesWithout,
    provides: m.manifest.catalog.provides,
    optionalDependencies: m.manifest.catalog.optionalDependencies,
    disableBehavior: m.manifest.catalog.disableBehavior,
    panelId: m.manifest.catalog.panelId,
    defaultEnabled: m.manifest.catalog.defaultEnabled
  }));
  const resources = Object.fromEntries(modules.map((m) => [m.id, m.manifest.permissions.primaryResource]));
  out.set(
    `${PATHS.sharedExt}/registry.generated.ts`,
    HEADER +
      `\n/** Идентификаторы модулей, подключённых манифестом; ядро дописывает их в закрытый \`z.enum\` (modules.ts). */\n` +
      `export const GENERATED_MODULE_IDS = ${json(ids)} as const;\n\n` +
      `import type { ComponentMetadata } from "../component-manifest";\n` +
      `export const GENERATED_MODULE_METADATA: Record<string, ComponentMetadata> = ${json(Object.fromEntries(modules.map(m => [m.id, { version: m.manifest.version, ...(m.manifest.requires ? { requires: m.manifest.requires } : {}) }])))};\n\n` +
      `/** Форма записи каталога (структурно совпадает с \`ModuleManifest\`; тип задан здесь, чтобы не зациклить modules.ts). */\n` +
      `export interface GeneratedModuleCatalogEntry {\n  id: (typeof GENERATED_MODULE_IDS)[number];\n  kind: "base" | "additional";\n  required: boolean;\n  label: string;\n  summary: string;\n  owns: string;\n  livesWithout: string;\n  provides: readonly string[];\n  optionalDependencies: readonly string[];\n  disableBehavior: string;\n  panelId: string;\n  defaultEnabled: boolean;\n}\n\n` +
      `/** Записи каталога модулей; \`MODULE_CATALOG\` добавляет их к встроенным. */\n` +
      `export const GENERATED_MODULE_CATALOG: readonly GeneratedModuleCatalogEntry[] = ${json(catalog)};\n\n` +
      `/** Основной ресурс модуля для реестра разрешений (\`<module>.<resource>.<action>\`). */\n` +
      `export const GENERATED_PRIMARY_RESOURCES: Record<(typeof GENERATED_MODULE_IDS)[number], string> = ${json(resources)};\n` +
      `\n/** Имена миграций модуля в порядке применения (G11): манифест компонента и \`GET system/components\` сверяют их с базой. */\n` +
      `export const GENERATED_MODULE_MIGRATIONS: Record<(typeof GENERATED_MODULE_IDS)[number], readonly string[]> = ${json(Object.fromEntries(modules.map((m) => [m.id, m.migrations.map((item) => item.name)])))};\n` +
      modules.map((m) => `\nexport * from "./${m.name}";`).join("") +
      (modules.length > 0 ? "\n" : "")
  );

  const agentTools = modules.flatMap((m) =>
    m.agentTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      group: "modules",
      effect: AGENT_TOOL_EFFECT[tool.op],
      scopes: null,
      http: tool.http,
      input: tool.input,
      ...(tool.example ? { example: tool.example } : {}),
      permission: `${m.id}.${m.primaryResource}.${tool.op}`,
      moduleId: m.id
    }))
  );
  out.set(
    `${PATHS.sharedExt}/agent-tools.generated.ts`,
    HEADER +
      `import type { AgentToolDef } from "../agent-tools";

` +
      `/** Инструменты ИИ-агентов, объявленные модулями в манифесте (\`agent.tools\`); \`AGENT_TOOLS\` добавляет их к инструментам ядра. */
` +
      `export const GENERATED_AGENT_TOOLS: readonly AgentToolDef[] = ${json(agentTools)};
`
  );

  out.set(
    `${PATHS.apiExt}/modules.generated.ts`,
    HEADER +
      modules.map((m) => `import { ${m.manifest.api.module.export} } from "./${m.name}/${m.manifest.api.module.file}";\n`).join("") +
      modules.filter((m) => m.agentController).map((m) => `import { ${m.agentController.export} } from "./${m.name}/${m.agentController.file}";\n`).join("") +
      `\n/** Nest-модули подключаемых модулей; app.module.ts разворачивает этот список в \`imports\`. */\n` +
      `export const GENERATED_NEST_MODULES = [${modules.map((m) => m.manifest.api.module.export).join(", ")}];\n\n` +
      `/** Контроллеры маршрутов агента \`ai/v1/<модуль>/*\` (G13): тест «инструмент ↔ маршрут» сверяет их с каталогом. */\n` +
      `export const GENERATED_AGENT_CONTROLLERS = [${modules.filter((m) => m.agentController).map((m) => m.agentController.export).join(", ")}];\n`
  );

  const allModels = modules.flatMap((m) => m.models);
  const registry = allModels.map((item) => ({
    model: item.model,
    snapshotKey: item.snapshotPolicy === "included" ? item.snapshotKey : null,
    policy: item.snapshotPolicy,
    reason: item.reason
  }));
  const specs = allModels.filter((item) => item.snapshotPolicy === "included");
  const sync = Object.fromEntries(allModels.map((item) => [item.model, { syncClass: item.sync.syncClass, stage: item.sync.stage, note: item.sync.note }]));
  out.set(
    `${PATHS.apiExt}/data.generated.ts`,
    HEADER +
      `import type { Prisma } from "@prisma/client";\n` +
      `import type { ModelClassification } from "../sync/snapshot-registry";\n` +
      `import type { SyncClassification } from "../sync/sync-classification";\n\n` +
      `/** GET-маршрут модуля внутри пространства (\`/workspaces/:id\` + путь): матричные тесты включения/выключения опрашивают его. */\n` +
      `export const GENERATED_MODULE_PROBES: Record<string, string> = ${json(Object.fromEntries(modules.map((m) => [m.id, m.manifest.api.probePath])))};\n\n` +
      `/** Политика снапшота моделей подключаемых модулей (в \`SNAPSHOT_MODEL_REGISTRY\`). */\n` +
      `export const GENERATED_SNAPSHOT_REGISTRY: ModelClassification[] = ${json(registry)};\n\n` +
      `/** Делегаты для снапшота; порядок — «родитель раньше ребёнка» (в \`SNAPSHOT_MODELS\`). */\n` +
      `export const GENERATED_SNAPSHOT_SPECS: Array<{ key: string; delegate: (tx: Prisma.TransactionClient) => unknown }> = [\n` +
      specs.map((item) => `  { key: ${JSON.stringify(item.snapshotKey)}, delegate: (tx) => tx.${item.delegate} }`).join(",\n") +
      (specs.length > 0 ? "\n" : "") +
      `];\n\n` +
      `/** Класс гибридной синхронизации моделей подключаемых модулей (в \`SYNC_CLASSIFICATION\`). */\n` +
      `export const GENERATED_SYNC_CLASSIFICATION: Record<string, SyncClassification> = ${json(sync)};\n`
  );

  const panels = modules.map((m) => ({ m, panel: m.manifest.web.panel, ident: `Generated${pascal(m.id)}Panel` }));
  const icons = [...new Set(panels.map((p) => p.panel.icon))].sort();
  out.set(
    `${PATHS.webExt}/panels.generated.ts`,
    HEADER +
      (panels.length > 0
        ? `import { ${icons.join(", ")} } from "lucide-react";\nimport dynamic from "next/dynamic";\nimport { createElement, type ComponentType, type FunctionComponent } from "react";\nimport type { PanelComponentProps, PanelDefinition } from "../lib/panel-registry";\n\n` +
          panels
            .map(
              (p) =>
                `const Lazy${p.ident} = dynamic(() => import("./${p.m.name}/${p.panel.file}").then((module) => module.${p.panel.export}), { ssr: false });\n` +
                `const ${p.ident}: FunctionComponent<PanelComponentProps> = (props) => createElement(Lazy${p.ident} as ComponentType<PanelComponentProps>, props);\n`
            )
            .join("") +
          "\n"
        : `import type { PanelDefinition } from "../lib/panel-registry";\n\n`) +
      `/** Панели подключаемых модулей; panel-registry.ts добавляет их к встроенным, поверхности (G17) выводит из манифеста сам. */\n` +
      `export const generatedPanelDefinitions: Omit<PanelDefinition, "surfaces">[] = [\n` +
      panels
        .map(
          (p) =>
            `  { id: ${JSON.stringify(p.panel.id)}, label: ${JSON.stringify(p.panel.label)}, icon: ${p.panel.icon}, component: ${p.ident}, moduleId: ${JSON.stringify(p.m.id)}, group: ${JSON.stringify(p.panel.group)} }`
        )
        .join(",\n") +
      (panels.length > 0 ? "\n" : "") +
      `];\n`
  );

  // Each manifest module owns its own subtree; siblings must not share an ownership identity.
  out.set(
    "scripts/module-ownership.generated.mjs",
    "// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs — руками не править.\n" +
      "/** Модели подключаемых модулей -> каталог-владелец (см. module-ownership.mjs). */\n" +
      `export const GENERATED_MODEL_OWNERS = ${json(modules.flatMap((m) => m.models.map((item) => [item.model, `modules-ext/${m.name}`])))};\n`
  );

  for (const m of modules) {
    for (const migration of m.migrations) out.set(`${PATHS.migrations}/${migration.name}/migration.sql`, migration.sql);
  }

  const schemaPath = join(root, PATHS.schema);
  if (existsSync(schemaPath)) {
    const modelLines = modules.filter((m) => m.fragment).flatMap((m) => [`// module: ${m.id}`, ...m.fragment.split("\n"), ""]);
    if (modelLines.at(-1) === "") modelLines.pop();
    const relationLines = modules.flatMap((m) => m.backRelations.map((line) => line));
    let schema = readFileSync(schemaPath, "utf8");
    const withModels = spliceRegion(schema, "models", modelLines);
    const withRelations = withModels && spliceRegion(withModels, "workspace-relations", relationLines);
    if (withRelations) schema = withRelations;
    out.set(PATHS.schema, withRelations ? schema : null);
  }
  return out;
}

/** Нарушения реестра: ошибки манифестов и устаревшие/отсутствующие генерируемые файлы. */
export function registryViolations(root = defaultRoot) {
  const { modules, plugins, errors } = collectAll(root);
  const violations = [...errors];
  if (errors.length > 0) return violations;
  for (const [path, content] of renderOutputs(modules, root, plugins)) {
    if (content === null) {
      violations.push(`${path}: нет маркеров <module-registry:…> — реестр не может записать модели модулей`);
      continue;
    }
    const full = join(root, path);
    if (!existsSync(full) || readFileSync(full, "utf8") !== content) {
      violations.push(`${path}: расходится с манифестами модулей и плагинов — запустите \`pnpm module-registry\``);
    }
  }
  return violations;
}

/** Записывает генерируемые файлы; возвращает пути, которые изменились. */
export function writeRegistry(root = defaultRoot) {
  const { modules, plugins, errors } = collectAll(root);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const changed = [];
  for (const [path, content] of renderOutputs(modules, root, plugins)) {
    if (content === null) throw new Error(`${path}: нет маркеров <module-registry:…>`);
    const full = join(root, path);
    if (existsSync(full) && readFileSync(full, "utf8") === content) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    changed.push(path);
  }
  return changed;
}

/**
 * Пути, которые вправе менять добавление модуля. Всё остальное — файлы ядра.
 * Документацию (`docs/`) допускаем: описание модуля — не код ядра.
 */
export function allowedPathsForModules(modules) {
  const dirs = modules.flatMap((m) => [`${m.dir}/`, `${PATHS.webExt}/${m.name}/`, `${PATHS.sharedExt}/${m.name}/`, `${PATHS.apiTestExt}/${m.name}/`]);
  const migrations = modules.flatMap((m) => m.migrations.map((item) => `${PATHS.migrations}/${item.name}/`));
  return { prefixes: [...dirs, ...migrations, "docs/"], exact: [...GENERATED_FILES, PATHS.schema] };
}

export function coreFilesTouched(changedFiles, modules, plugins = []) {
  const forModules = allowedPathsForModules(modules);
  const forPlugins = allowedPathsForPlugins(plugins);
  const prefixes = [...forModules.prefixes, ...forPlugins.prefixes];
  const exact = [...forModules.exact, ...forPlugins.exact];
  return changedFiles.filter((file) => !exact.includes(file) && !prefixes.some((prefix) => file.startsWith(prefix)));
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** `--check-diff`: если изменения base..HEAD добавили манифест модуля или плагина, то файлы ядра они менять не вправе. */
export function diffViolations(base, root = defaultRoot) {
  const addedFiles = git(root, ["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`]);
  const addedModules = addedFiles.filter((file) => file.endsWith(`/${MANIFEST_FILE}`) && file.startsWith(PATHS.apiExt));
  const addedPlugins = addedFiles.filter((file) => file.endsWith(`/${PLUGIN_MANIFEST_FILE}`) && file.startsWith(PLUGIN_PATHS.webExt));
  if (addedModules.length === 0 && addedPlugins.length === 0) return { addedModules: [], violations: [] };
  const { modules, plugins } = collectAll(root);
  const moduleNames = new Set(addedModules.map((file) => file.split("/").at(-2)));
  const pluginNames = new Set(addedPlugins.map((file) => file.split("/").at(-2)));
  const subjectModules = modules.filter((m) => moduleNames.has(m.name));
  const subjectPlugins = plugins.filter((p) => pluginNames.has(p.name));
  const changed = git(root, ["diff", "--name-only", `${base}...HEAD`]);
  const touched = coreFilesTouched(changed, subjectModules, subjectPlugins);
  const names = [...moduleNames, ...pluginNames].join(", ");
  return {
    addedModules: [...subjectModules.map((m) => m.id), ...subjectPlugins.map((p) => p.id)],
    violations: touched.map((file) => `${file}: файл ядра изменён вместе с добавлением ${names}`)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const violations = registryViolations();
    if (violations.length > 0) {
      console.error(violations.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("Module registry: OK (манифесты модулей и плагинов валидны, генерируемые файлы актуальны)");
    }
  } else if (args.includes("--check-diff")) {
    const base = args[args.indexOf("--check-diff") + 1];
    if (!base) {
      console.error("Укажите базовую ревизию: --check-diff <base>");
      process.exitCode = 2;
    } else {
      const { addedModules, violations } = diffViolations(base);
      if (violations.length > 0) {
        console.error(violations.join("\n"));
        process.exitCode = 1;
      } else {
        console.log(addedModules.length > 0 ? `Добавление (${addedModules.join(", ")}) не изменило файлов ядра` : "Новых модулей и плагинов в изменениях нет");
      }
    }
  } else {
    try {
      const changed = writeRegistry();
      console.log(changed.length > 0 ? `Обновлено:\n${changed.map((file) => `  ${file}`).join("\n")}` : "Реестр модулей актуален");
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
