/**
 * Плагины, подключаемые манифестом (DEV_KIT.md, «Свой плагин»). Зеркало реестра модулей для плагинов интерфейса:
 *
 *   apps/web/plugins-ext/<id>/plugin.manifest.json   ← манифест (единственная точка обнаружения)
 *   apps/web/plugins-ext/<id>/*.tsx                   ← компоненты, которые плагин вносит в слоты
 *
 * Генератор (вызывается из scripts/module-registry.mjs — одна команда `pnpm module-registry`) пишет:
 *
 *   packages/shared-types/src/plugins-ext/registry.generated.ts   id и записи каталога; ядро дописывает их в
 *                                                                  ORION_PLUGIN_IDS / PLUGIN_CATALOG (plugins.ts)
 *   apps/web/plugins-ext/contributions.generated.ts               вклады в слоты (`contribute(...)`) с ленивой загрузкой
 *
 * Плагин здесь — только интерфейс: компоненты в существующие слоты (`SlotContracts`, apps/web/lib/extensions/contracts.ts),
 * доступ к хосту — через lib/extensions/host-api.ts. Серверную часть плагина манифест пока не описывает: такие плагины
 * по-прежнему регистрируются вручную в apps/web/plugins и apps/api/src.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const PLUGIN_MANIFEST_FILE = "plugin.manifest.json";

export const PLUGIN_PATHS = {
  webExt: "apps/web/plugins-ext",
  sharedExt: "packages/shared-types/src/plugins-ext",
  corePlugins: "packages/shared-types/src/plugins.ts",
  coreWebPlugins: "apps/web/plugins",
  contracts: "apps/web/lib/extensions/contracts.ts"
};

export const PLUGIN_GENERATED_FILES = [
  `${PLUGIN_PATHS.sharedExt}/registry.generated.ts`,
  `${PLUGIN_PATHS.webExt}/contributions.generated.ts`
];

const HEADER =
  "// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из plugins-ext/*/plugin.manifest.json — руками не править.\n" +
  "// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.\n";

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const EXPORT_RE = /^[A-Z][A-Za-z0-9]*$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const SURFACES = ["dock", "side", "widget", "floating", "window"];
const CATALOG_STRING_FIELDS = ["label", "summary", "disableBehavior"];

const pascal = (id) => id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
const json = (value) => JSON.stringify(value, null, 2);

function readIfExists(root, path) {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

/** Строки массива-константы `const NAME = [ "...", ... ] as const` (без парсера TS: формат файла держит ядро). */
export function stringArrayLiteral(text, name) {
  if (!text) return [];
  const match = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(text);
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [];
}

/** Ключи интерфейса `SlotContracts` / `SlotMeta` — какие слоты есть и каким нужен `meta`. */
export function interfaceKeys(text, name) {
  if (!text) return [];
  const start = text.indexOf(`export interface ${name} {`);
  if (start === -1) return [];
  const body = text.slice(start, text.indexOf("\n}", start));
  return [...body.matchAll(/^\s+"([a-z][a-z0-9.-]*)"\??:/gm)].map((item) => item[1]);
}

/** Слоты хоста: все, и те, которым вклад обязан передать `meta` (вкладки и т.п.). */
export function hostSlots(root) {
  const text = readIfExists(root, PLUGIN_PATHS.contracts);
  return { slots: new Set(interfaceKeys(text, "SlotContracts")), withMeta: new Set(interfaceKeys(text, "SlotMeta")) };
}

/** Id плагинов ядра (`CORE_PLUGIN_IDS`) и каталоги apps/web/plugins — чтобы поймать столкновение. */
export function corePluginIds(root) {
  const ids = new Set(stringArrayLiteral(readIfExists(root, PLUGIN_PATHS.corePlugins), "CORE_PLUGIN_IDS"));
  const dir = join(root, PLUGIN_PATHS.coreWebPlugins);
  if (existsSync(dir)) for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) ids.add(entry.name);
  return ids;
}

/**
 * Читает и проверяет манифесты плагинов. `moduleIds` — модули, которые плагин вправе расширять (ядро + подключённые
 * манифестом). Возвращает `{ plugins, errors }`; плагин с ошибками в `plugins` не попадает.
 */
export function collectPlugins(root, moduleIds) {
  const errors = [];
  const plugins = [];
  const webExt = join(root, PLUGIN_PATHS.webExt);
  if (!existsSync(webExt)) return { plugins, errors };
  const core = corePluginIds(root);
  const modules = new Set(moduleIds);
  const { slots, withMeta } = hostSlots(root);
  const seen = new Set();
  const entries = readdirSync(webExt, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = `${PLUGIN_PATHS.webExt}/${entry.name}`;
    const manifestPath = `${dir}/${PLUGIN_MANIFEST_FILE}`;
    if (!existsSync(join(root, manifestPath))) {
      errors.push(`${dir}: нет ${PLUGIN_MANIFEST_FILE} — каталог плагина обязан содержать манифест`);
      continue;
    }
    const problems = [];
    const fail = (message) => problems.push(`${manifestPath}: ${message}`);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
    } catch (error) {
      errors.push(`${manifestPath}: не JSON (${error.message})`);
      continue;
    }

    const id = manifest.id;
    if (typeof id !== "string" || !ID_RE.test(id)) fail(`id "${id}" должен быть в kebab-case`);
    else {
      if (id !== entry.name) fail(`id "${id}" не совпадает с именем каталога "${entry.name}"`);
      if (core.has(id)) fail(`id "${id}" занят плагином ядра`);
      if (modules.has(id)) fail(`id "${id}" занят модулем`);
      if (seen.has(id)) fail(`id "${id}" уже объявлен другим манифестом`);
    }
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) fail("version должен быть semver");
    if (typeof manifest.extends !== "string" || !modules.has(manifest.extends)) {
      fail(`extends "${manifest.extends}" — id модуля, который плагин расширяет (ядро или подключённый манифестом)`);
    }

    const catalog = manifest.catalog ?? {};
    for (const field of CATALOG_STRING_FIELDS) {
      if (typeof catalog[field] !== "string" || catalog[field] === "") fail(`catalog.${field} — непустая строка`);
    }
    if (!Array.isArray(catalog.provides) || catalog.provides.length === 0 || catalog.provides.some((item) => typeof item !== "string")) {
      fail("catalog.provides — непустой массив строк (что плагин добавляет)");
    }
    if (typeof catalog.defaultEnabled !== "boolean") fail("catalog.defaultEnabled — boolean");

    if (manifest.api !== undefined) {
      fail("api: серверную часть плагина манифест пока не описывает — такой плагин регистрируется вручную (DEV_KIT.md)");
    }

    const surfaces = manifest.surfaces ?? [];
    if (!Array.isArray(surfaces) || surfaces.some((item) => !SURFACES.includes(item))) fail(`surfaces — подмножество ${SURFACES.join(" | ")}`);

    const contributions = manifest.web?.contributions;
    const usedSlots = new Set();
    if (!Array.isArray(contributions) || contributions.length === 0) {
      fail("web.contributions — непустой массив { slot, file, export, order?, meta? }");
    } else {
      contributions.forEach((item, index) => {
        const label = `web.contributions[${index}]`;
        if (typeof item?.slot !== "string" || !slots.has(item.slot)) {
          fail(`${label}: слот "${item?.slot}" не существует (см. SlotContracts в ${PLUGIN_PATHS.contracts} или pnpm create:plugin --list-slots)`);
        } else if (usedSlots.has(item.slot)) fail(`${label}: слот "${item.slot}" уже занят этим плагином — один вклад на слот`);
        else usedSlots.add(item.slot);
        if (typeof item?.file !== "string" || !FILE_RE.test(item.file) || item.file.includes("..")) fail(`${label}: file — путь внутри каталога плагина без расширения`);
        else if (!existsSync(join(root, `${dir}/${item.file}.tsx`)) && !existsSync(join(root, `${dir}/${item.file}.ts`))) {
          fail(`${label}: нет файла ${dir}/${item.file}.tsx`);
        }
        if (typeof item?.export !== "string" || !EXPORT_RE.test(item.export)) fail(`${label}: export — имя React-компонента (PascalCase)`);
        if (item?.order !== undefined && typeof item.order !== "number") fail(`${label}: order — число`);
        const needsMeta = typeof item?.slot === "string" && withMeta.has(item.slot);
        if (needsMeta && (typeof item.meta !== "object" || item.meta === null || Array.isArray(item.meta))) {
          fail(`${label}: слоту "${item.slot}" нужен meta (см. SlotMeta в ${PLUGIN_PATHS.contracts})`);
        }
        if (!needsMeta && item?.meta !== undefined) fail(`${label}: слот "${item?.slot}" не принимает meta`);
      });
    }

    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }
    seen.add(id);
    plugins.push({ id, dir, name: entry.name, manifest });
  }
  return { plugins, errors };
}

/** Генерируемые файлы плагинов: путь → содержимое. */
export function renderPluginOutputs(plugins) {
  const out = new Map();
  const catalog = plugins.map((p) => ({
    id: p.id,
    extendsModuleId: p.manifest.extends,
    label: p.manifest.catalog.label,
    summary: p.manifest.catalog.summary,
    provides: p.manifest.catalog.provides,
    disableBehavior: p.manifest.catalog.disableBehavior,
    defaultEnabled: p.manifest.catalog.defaultEnabled
  }));
  const surfaces = Object.fromEntries(plugins.filter((p) => (p.manifest.surfaces ?? []).length > 0).map((p) => [p.id, p.manifest.surfaces]));
  out.set(
    `${PLUGIN_PATHS.sharedExt}/registry.generated.ts`,
    HEADER +
      `import type { OrionModuleId } from "../modules";\n\n` +
      `/** Идентификаторы плагинов, подключённых манифестом; ядро дописывает их в закрытый \`z.enum\` (plugins.ts). */\n` +
      `export const GENERATED_PLUGIN_IDS = ${json(plugins.map((p) => p.id))} as const;\n\n` +
      `/** Форма записи каталога (структурно совпадает с \`PluginManifest\`; тип задан здесь, чтобы не зациклить plugins.ts). */\n` +
      `export interface GeneratedPluginCatalogEntry {\n  id: (typeof GENERATED_PLUGIN_IDS)[number];\n  extendsModuleId: OrionModuleId;\n  label: string;\n  summary: string;\n  provides: string[];\n  disableBehavior: string;\n  defaultEnabled: boolean;\n}\n\n` +
      `/** Записи каталога плагинов; \`PLUGIN_CATALOG\` добавляет их к встроенным. */\n` +
      `export const GENERATED_PLUGIN_CATALOG: readonly GeneratedPluginCatalogEntry[] = ${json(catalog)};\n\n` +
      `/** Поверхности плагинов (G17), если плагин их объявил; манифест компонента берёт их отсюда. */\n` +
      `export const GENERATED_PLUGIN_SURFACES: Record<string, readonly ("dock" | "side" | "widget" | "floating" | "window")[]> = ${json(surfaces)};\n`
  );

  const lines = [];
  for (const p of plugins) {
    for (const item of p.manifest.web.contributions) {
      const ident = `${pascal(p.id)}${item.export}`;
      const slot = JSON.stringify(item.slot);
      lines.push(
        `const ${ident} = dynamic<SlotContracts[${slot}]>(() => import("./${p.name}/${item.file}").then((module) => module.${item.export}), { ssr: false });`,
        `contribute(${slot}, { pluginId: ${JSON.stringify(p.id)}, component: ${ident}` +
          (item.order !== undefined ? `, order: ${item.order}` : "") +
          (item.meta !== undefined ? `, meta: ${JSON.stringify(item.meta)}` : "") +
          ` });`,
        ""
      );
    }
  }
  out.set(
    `${PLUGIN_PATHS.webExt}/contributions.generated.ts`,
    HEADER +
      (lines.length > 0
        ? `import dynamic from "next/dynamic";\nimport type { SlotContracts } from "../lib/extensions/contracts";\nimport { contribute } from "../lib/extensions/registry";\n\n` +
          `/** Вклады плагинов, подключённых манифестом; импорт этого файла (lib/extensions/slot.tsx) их регистрирует. */\n\n` +
          lines.join("\n")
        : `/** Вклады плагинов, подключённых манифестом; пока таких плагинов нет. */\nexport {};\n`)
  );
  return out;
}

/** Пути, которые вправе менять добавление плагина (всё остальное — файлы ядра). */
export function allowedPathsForPlugins(plugins) {
  return { prefixes: plugins.map((p) => `${p.dir}/`), exact: [...PLUGIN_GENERATED_FILES] };
}
