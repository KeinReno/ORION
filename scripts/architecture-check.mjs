#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { registryViolations } from "./module-registry.mjs";
import { CORE_MODELS, CORE_MODULE_DIRS, MODEL_OWNERS, moduleOfDir, moduleOfPath } from "./module-ownership.mjs";
import { MODULE_BOUNDARY_EXCEPTIONS } from "./module-boundary-exceptions.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRequire = createRequire(join(root, "apps", "web", "package.json"));
const ts = webRequire("typescript");

function within(path, directory) {
  return path === directory || path.startsWith(directory + sep);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function importSpecifiers(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ value: node.moduleSpecifier.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      found.push({ value: node.arguments[0].text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

// Plugins reach the host only through contracts + host-api; the composition
// registry alone may import registry. There are no legacy exceptions left: the
// DOCX/XLSX codecs now live inside plugins/documents-office/codecs.

export function architectureViolations(projectRoot = root) {
  const web = join(projectRoot, "apps", "web");
  // Plugins of the main build (apps/web/plugins) and plugins declared by a manifest (apps/web/plugins-ext) obey the same rules.
  const pluginRoots = [join(web, "plugins"), join(web, "plugins-ext")];
  const panels = join(web, "panels");
  const loader = join(web, "lib", "extensions", "slot.tsx");
  // The only files that compose plugins: they may import the registry and every plugin of their root.
  const composition = [join(web, "plugins", "index.ts"), join(web, "plugins-ext", "contributions.generated.ts")];
  const composedTargets = [join(web, "plugins"), join(web, "plugins-ext", "contributions.generated")];
  const rootOf = (path) => pluginRoots.find((pluginRoot) => within(path, pluginRoot));
  const paths = [join(projectRoot, "packages"), join(projectRoot, "apps", "api", "src"), join(web, "lib"), panels, ...pluginRoots.filter(existsSync)];
  const violations = [];
  for (const file of paths.flatMap(sourceFiles)) {
    const plugins = rootOf(file);
    for (const specifier of importSpecifiers(file)) {
      if (!specifier.value.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier.value);
      const base = plugins ? "plugin" : "base";
      const composedByRegistry = file === loader && composedTargets.includes(target);
      if (base === "base" && rootOf(target) && !composedByRegistry) {
        violations.push(`${relative(projectRoot, file)}:${specifier.line} imports concrete plugin ${specifier.value}`);
      }
      if (base === "plugin" && within(target, panels)) {
        violations.push(`${relative(projectRoot, file)}:${specifier.line} imports host panel ${specifier.value}`);
      }
      if (base === "plugin" && !rootOf(target) && !within(target, panels) && within(target, web)) {
        const hostPath = relative(web, target).split(sep).join("/");
        const publicSurface = hostPath === "lib/extensions/contracts" || hostPath === "lib/extensions/host-api" ||
          (composition.includes(file) && (hostPath === "lib/extensions/registry" || hostPath === "lib/extensions/places"));
        if (!publicSurface) {
          violations.push(`${relative(projectRoot, file)}:${specifier.line} imports host internals ${specifier.value} (use lib/extensions/host-api)`);
        }
      }
      if (base === "plugin" && rootOf(target) && !(composition.includes(file) && within(target, plugins))) {
        const owner = join(plugins, relative(plugins, file).split(sep)[0]);
        if (!within(target, owner)) {
          violations.push(`${relative(projectRoot, file)}:${specifier.line} imports another plugin ${specifier.value}`);
        }
      }
    }
  }
  return violations;
}

// G18: plugin code must take its colours from theme tokens (text-destructive, bg-card,
// text-muted-foreground …) so a workspace/user theme restyles plugins too. Hard-coded
// colours silently ignore the active theme. Scans string/template literals only, so
// comments and identifiers like `#anchor` in prose are not flagged.
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITY = "text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret|shadow|placeholder";
const PALETTE_CLASS = new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY})-(?:(?:${PALETTE})-\\d{2,3})(?:/\\d+)?(?![\\w-])`);
const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(/;

// Explicit, commented allowlist of `file:reason` entries (paths relative to apps/web/plugins).
// It may only shrink: add nothing here — map the colour to a theme token instead.
const COLOR_ALLOWLIST = new Map([
  ["documents-office/docx-editor.tsx", "DOCX page is rendered as white paper with dark text regardless of theme (WYSIWYG of the exported file)"],
  ["home-utilities/UtilitiesAnalytics.tsx", "chart series palette: cyan/violet have no theme token and categorical series need distinct hues; accent/success/warning/destructive are already tokens"],
  ["time-insights/time-charts.tsx", "SVG data-viz: fixed categorical hex palette for project series, no per-hue theme tokens"]
]);

export function colorViolations(projectRoot = root) {
  const roots = [join(projectRoot, "apps", "web", "plugins"), join(projectRoot, "apps", "web", "plugins-ext")].filter(existsSync);
  const violations = [];
  for (const file of roots.flatMap((pluginRoot) => sourceFiles(pluginRoot).map((path) => ({ path, pluginRoot }))).map(({ path, pluginRoot }) => ({ file: path, rel: relative(pluginRoot, path).split(sep).join("/") }))) {
    const { rel } = file;
    if (COLOR_ALLOWLIST.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const path = file.file;
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const text = node.text;
        const kind = PALETTE_CLASS.test(text) ? "palette class" : HEX_LITERAL.test(text) ? "hex colour" : COLOR_FUNCTION.test(text) ? "rgb/hsl colour" : null;
        // Import specifiers and the like never contain these shapes, so no extra filtering is needed.
        if (kind) violations.push(`${relative(projectRoot, path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} hard-coded ${kind} in plugin (use a theme token): ${text.trim().slice(0, 80)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return violations;
}

// G23: целостность PLUGIN_CATALOG <-> веб-регистрация (`contribute(...)` в apps/web/plugins) <-> сервер
// (`@RequirePlugin` и родственные). Мёртвый плагин (есть в каталоге, нигде не используется) и
// вклад в несуществующий слот (опечатка в динамическом коде) — ошибки.

// Плагины каталога, у которых законно нет ни веб-вклада, ни серверной привязки. Список может только
// сокращаться; добавляйте запись только с причиной.
const PLUGIN_USAGE_ALLOWLIST = new Map([]);

function parseTs(file) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function stringArrayConst(file, name) {
  const found = [];
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      let init = node.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      if (ts.isArrayLiteralExpression(init)) for (const el of init.elements) if (ts.isStringLiteral(el)) found.push(el.text);
    }
    ts.forEachChild(node, visit);
  })(parseTs(file));
  return found;
}

function interfaceKeys(file, name) {
  const found = [];
  (function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      for (const member of node.members) {
        if (member.name && (ts.isStringLiteral(member.name) || ts.isIdentifier(member.name))) found.push(member.name.text);
      }
    }
    ts.forEachChild(node, visit);
  })(parseTs(file));
  return found;
}

function propertyString(object, key) {
  for (const prop of object.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === key && ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
  }
  return null;
}

export function pluginCatalogViolations(projectRoot = root) {
  const violations = [];
  const catalogFile = join(projectRoot, "packages", "shared-types", "src", "plugins.ts");
  const contractsFile = join(projectRoot, "apps", "web", "lib", "extensions", "contracts.ts");
  const generatedFile = join(projectRoot, "packages", "shared-types", "src", "plugins-ext", "registry.generated.ts");
  const pluginRoots = [join(projectRoot, "apps", "web", "plugins"), join(projectRoot, "apps", "web", "plugins-ext")].filter(existsSync);
  const catalog = new Set([
    ...stringArrayConst(catalogFile, "CORE_PLUGIN_IDS"),
    ...(existsSync(generatedFile) ? stringArrayConst(generatedFile, "GENERATED_PLUGIN_IDS") : [])
  ]);
  const slots = new Set(interfaceKeys(contractsFile, "SlotContracts"));
  if (!catalog.size) violations.push("packages/shared-types/src/plugins.ts: CORE_PLUGIN_IDS не найден или пуст");
  if (!slots.size) violations.push("apps/web/lib/extensions/contracts.ts: SlotContracts не найден или пуст");

  const webPlugins = new Set();
  for (const file of pluginRoots.flatMap(sourceFiles)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = parseTs(file);
    const where = (node) => `${relative(projectRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    (function visit(node) {
      // A place the plugin ADDS (ADR-0022, `addPlace(kind, { pluginId, … })`) is web usage too.
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "addPlace" &&
        node.arguments.length >= 2 && ts.isObjectLiteralExpression(node.arguments[1])) {
        const pluginId = propertyString(node.arguments[1], "pluginId");
        if (pluginId) {
          webPlugins.add(pluginId);
          if (!catalog.has(pluginId)) violations.push(`${where(node)} плагин "${pluginId}" добавляет место, но отсутствует в PLUGIN_CATALOG`);
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "contribute" &&
        node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && ts.isObjectLiteralExpression(node.arguments[1])) {
        const slot = node.arguments[0].text;
        const pluginId = propertyString(node.arguments[1], "pluginId");
        if (!slots.has(slot)) violations.push(`${where(node)} плагин вносит вклад в неизвестный слот "${slot}" (нет в SlotContracts)`);
        if (pluginId) {
          webPlugins.add(pluginId);
          if (!catalog.has(pluginId)) violations.push(`${where(node)} плагин "${pluginId}" зарегистрирован в вебе, но отсутствует в PLUGIN_CATALOG`);
        }
      }
      ts.forEachChild(node, visit);
    })(source);
  }

  const serverPlugins = new Set();
  const SERVER_CALLS = new Set(["RequirePlugin", "pluginOffWhere", "isPluginEnabled"]);
  for (const file of sourceFiles(join(projectRoot, "apps", "api", "src"))) {
    if (/\.test\.tsx?$/.test(file)) continue;
    (function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SERVER_CALLS.has(node.expression.text)) {
        for (const arg of node.arguments) if (ts.isStringLiteral(arg) && catalog.has(arg.text)) serverPlugins.add(arg.text);
      } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "pluginId" &&
        ts.isStringLiteral(node.initializer) && catalog.has(node.initializer.text)) {
        serverPlugins.add(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    })(parseTs(file));
  }

  for (const id of catalog) {
    if (!webPlugins.has(id) && !serverPlugins.has(id) && !PLUGIN_USAGE_ALLOWLIST.has(id)) {
      violations.push(`плагин "${id}" есть в PLUGIN_CATALOG, но не вносит вклад в веб (contribute) и не используется на сервере (@RequirePlugin)`);
    }
  }
  return violations;
}

// G4: сервис модуля A не берёт таблицы модуля B (`tx.<модель B>`) и не импортирует сервис B. Связь между
// модулями идёт через контракт (провайдер агрегата / команда / событие), а не через чужие таблицы: иначе
// отключение или замена модуля B молча ломает A. Владение — scripts/module-ownership.mjs; уже существующие
// нарушения перечислены в scripts/module-boundary-exceptions.mjs (список только сокращается).
// Ограничение: ловятся вызовы делегатов Prisma (tx.task.findMany…); сырой SQL по именам таблиц не разбирается.
const PRISMA_METHODS = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "create", "createMany",
  "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany", "count", "aggregate", "groupBy"]);
const PRISMA_RECEIVERS = new Set(["tx", "trx", "db", "client", "prisma"]);
const lowerFirst = (name) => name[0].toLowerCase() + name.slice(1);
const DELEGATE_TO_MODEL = new Map([...MODEL_OWNERS.keys(), ...CORE_MODELS].map((model) => [lowerFirst(model), model]));

function isPrismaReceiver(expr) {
  if (ts.isIdentifier(expr)) return PRISMA_RECEIVERS.has(expr.text);
  // this.prisma.<модель>
  return ts.isPropertyAccessExpression(expr) && expr.expression.kind === ts.SyntaxKind.ThisKeyword && expr.name.text === "prisma";
}

/** file (относительно корня репозитория) -> { models: Set, services: Set } — все текущие пересечения границ модулей. */
export function moduleBoundaryUsages(projectRoot = root) {
  const apiSrc = join(projectRoot, "apps", "api", "src");
  const usages = new Map();
  if (!existsSync(apiSrc)) return usages;
  for (const file of sourceFiles(apiSrc)) {
    if (!/\.service\.ts$/.test(file) || /\.test\.ts$/.test(file)) continue;
    const dir = relative(apiSrc, file).split(sep)[0];
    if (CORE_MODULE_DIRS.has(dir)) continue;
    const self = moduleOfPath(relative(apiSrc, file));
    const models = new Set();
    const services = new Set();
    (function visit(node) {
      // tx.task.findMany(...) -> PropertyAccess(PropertyAccess(tx, task), findMany)
      if (ts.isPropertyAccessExpression(node) && PRISMA_METHODS.has(node.name.text) && ts.isPropertyAccessExpression(node.expression) &&
        isPrismaReceiver(node.expression.expression)) {
        const model = DELEGATE_TO_MODEL.get(node.expression.name.text);
        const owner = model && MODEL_OWNERS.get(model);
        if (owner && moduleOfDir(owner) !== self) models.add(model);
      }
      ts.forEachChild(node, visit);
    })(parseTs(file));
    for (const specifier of importSpecifiers(file)) {
      if (!specifier.value.startsWith(".") || !/\.service$/.test(specifier.value)) continue;
      const target = relative(apiSrc, resolve(dirname(file), specifier.value)).split(sep);
      if (target[0] === ".." || CORE_MODULE_DIRS.has(target[0]) || moduleOfPath(target.join("/")) === self) continue;
      services.add(target.join("/"));
    }
    if (models.size || services.size) usages.set(relative(projectRoot, file).split(sep).join("/"), { models, services });
  }
  return usages;
}

/** Модели schema.prisma без владельца в module-ownership.mjs (карта обязана оставаться полной). */
export function ownershipMapViolations(projectRoot = root) {
  const schema = join(projectRoot, "apps", "api", "prisma", "schema.prisma");
  if (!existsSync(schema)) return [];
  const models = [...readFileSync(schema, "utf8").matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  return models
    .filter((model) => !MODEL_OWNERS.has(model) && !CORE_MODELS.has(model))
    .map((model) => `scripts/module-ownership.mjs: модель ${model} из schema.prisma без владельца (добавьте в MODEL_OWNERS или CORE_MODELS)`);
}

export function moduleBoundaryViolations(projectRoot = root, exceptions = MODULE_BOUNDARY_EXCEPTIONS) {
  const violations = [];
  const usages = moduleBoundaryUsages(projectRoot);
  for (const [file, { models, services }] of usages) {
    const allowed = exceptions[file] ?? {};
    for (const model of [...models].sort()) {
      if (!(allowed.models ?? []).includes(model)) {
        violations.push(`${file} использует чужую модель ${model} (модуль ${MODEL_OWNERS.get(model)}): нужен провайдер агрегата/команда/событие, а не tx.${lowerFirst(model)}`);
      }
    }
    for (const service of [...services].sort()) {
      if (!(allowed.services ?? []).includes(service)) violations.push(`${file} импортирует сервис другого модуля ${service}`);
    }
  }
  // Устаревшая запись — тоже ошибка: список исключений обязан отражать реальность и только сокращаться.
  for (const [file, allowed] of Object.entries(exceptions)) {
    const actual = usages.get(file);
    for (const model of allowed.models ?? []) {
      if (!actual?.models.has(model)) violations.push(`${file}: исключение для модели ${model} устарело, удалите его из module-boundary-exceptions.mjs`);
    }
    for (const service of allowed.services ?? []) {
      if (!actual?.services.has(service)) violations.push(`${file}: исключение для сервиса ${service} устарело, удалите его из module-boundary-exceptions.mjs`);
    }
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = [...architectureViolations(), ...colorViolations(), ...pluginCatalogViolations(), ...ownershipMapViolations(), ...moduleBoundaryViolations(), ...registryViolations()];
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Architecture import boundaries: OK (core/base ↛ concrete plugins; plugins ↛ host panels, host internals or other plugins; no hard-coded colours in plugins; plugin catalog, slots and server usage consistent; API services stay within their module\u2019s tables and services apart from the exception list)");
  }
}
