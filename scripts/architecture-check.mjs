#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  const plugins = join(web, "plugins");
  const panels = join(web, "panels");
  const loader = join(web, "lib", "extensions", "slot.tsx");
  const paths = [join(projectRoot, "packages"), join(projectRoot, "apps", "api", "src"), join(web, "lib"), panels, plugins];
  const violations = [];
  for (const file of paths.flatMap(sourceFiles)) {
    for (const specifier of importSpecifiers(file)) {
      if (!specifier.value.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier.value);
      const base = within(file, plugins) ? "plugin" : "base";
      const composedByRegistry = file === loader && target === plugins;
      if (base === "base" && within(target, plugins) && !composedByRegistry) {
        violations.push(`${relative(projectRoot, file)}:${specifier.line} imports concrete plugin ${specifier.value}`);
      }
      if (base === "plugin" && within(target, panels)) {
        violations.push(`${relative(projectRoot, file)}:${specifier.line} imports host panel ${specifier.value}`);
      }
      if (base === "plugin" && !within(target, plugins) && !within(target, panels) && within(target, web)) {
        const hostPath = relative(web, target).split(sep).join("/");
        const pluginFile = relative(plugins, file).split(sep).join("/");
        const publicSurface = hostPath === "lib/extensions/contracts" || hostPath === "lib/extensions/host-api" ||
          (pluginFile === "index.ts" && hostPath === "lib/extensions/registry");
        if (!publicSurface) {
          violations.push(`${relative(projectRoot, file)}:${specifier.line} imports host internals ${specifier.value} (use lib/extensions/host-api)`);
        }
      }
      if (base === "plugin" && file !== join(plugins, "index.ts") && within(target, plugins)) {
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
  const plugins = join(projectRoot, "apps", "web", "plugins");
  const violations = [];
  for (const file of sourceFiles(plugins)) {
    const rel = relative(plugins, file).split(sep).join("/");
    if (COLOR_ALLOWLIST.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const text = node.text;
        const kind = PALETTE_CLASS.test(text) ? "palette class" : HEX_LITERAL.test(text) ? "hex colour" : COLOR_FUNCTION.test(text) ? "rgb/hsl colour" : null;
        // Import specifiers and the like never contain these shapes, so no extra filtering is needed.
        if (kind) violations.push(`${relative(projectRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} hard-coded ${kind} in plugin (use a theme token): ${text.trim().slice(0, 80)}`);
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
  const plugins = join(projectRoot, "apps", "web", "plugins");
  const catalog = new Set(stringArrayConst(catalogFile, "ORION_PLUGIN_IDS"));
  const slots = new Set(interfaceKeys(contractsFile, "SlotContracts"));
  if (!catalog.size) violations.push("packages/shared-types/src/plugins.ts: ORION_PLUGIN_IDS не найден или пуст");
  if (!slots.size) violations.push("apps/web/lib/extensions/contracts.ts: SlotContracts не найден или пуст");

  const webPlugins = new Set();
  for (const file of sourceFiles(plugins)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = parseTs(file);
    const where = (node) => `${relative(projectRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    (function visit(node) {
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = [...architectureViolations(), ...colorViolations(), ...pluginCatalogViolations()];
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Architecture import boundaries: OK (core/base ↛ concrete plugins; plugins ↛ host panels, host internals or other plugins; no hard-coded colours in plugins; plugin catalog, slots and server usage consistent)");
  }
}
