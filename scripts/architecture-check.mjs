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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = architectureViolations();
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Architecture import boundaries: OK (core/base ↛ concrete plugins; plugins ↛ host panels, host internals or other plugins)");
  }
}
