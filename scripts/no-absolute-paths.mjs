#!/usr/bin/env node
// P1-1: запрет абсолютных путей разработчика в исходниках (см.
// docs/REMEDIATION_REPORT.md). Пути типа D:\Projects или C:\Users\Reno
// не существуют у пользователей установщика; корни репозиториев настраиваются
// через ORION_DEV_REPOSITORY_ROOTS, а не через литералы в коде.
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "packages"];
const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".cjs", ".mjs", ".rs", ".json"]);
// Пропускаем сгенерированное и вендорное.
const skip = /node_modules|[/\\]\.next|[/\\]dist[/\\]|[/\\]target[/\\]|src-tauri[/\\](gen|resources)[/\\]|\.config\.(js|mjs)$|\.test\.(ts|tsx)$/;

const patterns = [
  { re: /[A-Za-z]:\\(?:Users|Projects|Work|Dev|Coding|Repos)\\/i, label: "абсолютный путь Windows" },
  { re: /[A-Za-z]:\/Users\//i, label: "абсолютный путь (forward slashes)" }
];

const files = roots
  .flatMap((root) => globSync(`${root}/**/*`, { nodir: true }))
  .filter((file) => extensions.has(file.slice(file.lastIndexOf("."))))
  .filter((file) => !skip.test(file));

let violations = 0;
for (const file of files) {
  const text = readFileSync(join(process.cwd(), file), "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Комментарии с примерами путей — документация, не код.
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const { re, label } of patterns) {
      if (re.test(line)) {
        violations += 1;
        console.error(`${file}:${index + 1}: ${label}: ${line.trim().slice(0, 120)}`);
      }
    }
  });
}

if (violations > 0) {
  console.error(`\nНайдено абсолютных путей: ${violations}. Используйте конфигурацию (env), не литералы.`);
  process.exit(1);
}
console.log(`no-absolute-paths: OK (${files.length} файлов проверено)`);
