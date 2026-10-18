#!/usr/bin/env node
// G25: MODULE.md + AI_CONTEXT.md для каждого модуля каталога, с блоком, который генерируется из манифеста
// (packages/shared-types/src/component-manifest.ts) и контроллеров. Текст вне маркеров — ручной и сохраняется.
//   node scripts/module-docs.mjs          записать/обновить файлы
//   node scripts/module-docs.mjs --check  ничего не писать; код выхода 1, если блок устарел, файла нет
//                                         или в документах упомянут несуществующий пакет @orion/<name>
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- generated:manifest:start -->";
const END = "<!-- generated:manifest:end -->";

/** Каталог кода модуля в apps/api/src, если он не совпадает с id. */
const DIR_OVERRIDES = { calendar: "events" };

/** Вводный текст для новых файлов: только то, что видно в сервисах/контроллерах и каталоге. */
const INTROS = {
  tasks: ["Задачи пространства: доска и списки со сроками, подзадачами, зависимостями и сохранёнными видами.", "Кроме самих задач сервис ведёт комментарии (`task-comments.service.ts`) и журнал изменений статуса, исполнителя и срока (`task-activity.service.ts`). Обновление защищено ревизией (`expectedRevision`, 409 при конфликте).", "Напоминания о просроченных задачах шлёт не этот модуль, а `notifications/due-task-checker.service.ts`."],
  notes: ["Текстовые заметки в Markdown: ревизии, wiki-ссылки, теги, шаблоны, корзина.", "Вложения заметок — обычные документы (`note-attachments.service.ts` поверх `DocumentsService`), своего хранилища у модуля нет. Корзина чистится ночным кроном `note-trash-purge.service.ts`.", "Обновление тела идёт через проверку ревизии (CAS); прямые записи мимо `NotesService.update` ревизию не увеличивают."],
  calendar: ["Календарь: события пространства, напоминания о них, входящие внешние ICS-фиды и исходящий ICS-фид по токену.", "Код модуля лежит в каталоге `events/`: `events.service.ts` (события и повторения), `event-reminder.service.ts` (напоминания, каждую минуту), `calendar-connections.service.ts` (подключения ICS, каждые 30 минут), `calendar-feed.controller.ts` (исходящий фид)."],
  documents: ["Файлы и папки пространства: дерево по `parentId`, версии, превью, загрузка и потоковая отдача с `Range`.", "Байты лежат за `StorageAdapter` (`apps/api/src/storage/`), база авторитетна по структуре. Корзина файлов чистится ночным кроном `document-trash-purge.service.ts`."],
  projects: ["Проекты как контейнер работы: статус, сроки, бюджет, ставка, вехи-соседи и привязка других сущностей по `projectId`.", "Рядом с проектом живут обновления (`project-updates`), захваты (`project-captures`), идеи и проблемы; удаление проекта архивирует его, а не стирает историю."],
  time: ["Учёт времени: записи затраченного времени и запущенный таймер.", "Длительность не хранится, её считает `entryMinutes()` из `@orion/shared-types`. Один запущенный таймер на участника пространства обеспечивает частичный уникальный индекс в БД."],
  finance: ["Финансы: счета, категории, операции со строками и разбивкой, бюджеты, цели, обязательства, повторяющиеся платежи, курсы валют, отчёты.", "Крупный модуль из вложенных подкаталогов (`accounts`, `transactions`, `budgets`, `recurring`, …). Повторяющиеся платежи материализует `recurring/recurring-checker.service.ts` (каждый час, под блокировкой строки правила), оповещения по бюджетам — `budget-alerts.service.ts`.", "Ссылки на счёт, категорию и проект проверяются на принадлежность тому же пространству (`finance-refs.util.ts`)."],
  habits: ["Привычки и ежедневные отметки. Отметка — день (`@db.Date`), идемпотентная по паре привычка-день.", "Серия и признаки «на сегодня» вычисляются функциями из `shared-types/src/habit.ts`, в базе не хранятся. Удаление привычки архивирует её."],
  lists: ["Лёгкие общие списки (покупки, дела, сборы): пункты с количеством, группой, ценой и отметкой «кто отметил», шаблоны, ручной порядок.", "Связи со складом и финансами не входят в модуль: их ведут плагины `lists-inventory` и `lists-finance` (серверные каталоги рядом)."],
  inventory: ["Склад: позиции и журнал движений (приход, расход, корректировка).", "Уведомления о низком остатке формирует `inventory-alerts.service.ts`."],
  markets: ["Рынки: список наблюдения, журнал сделок (реальные, бумажные, исторические) и позиции по реальным сделкам; импорт журнала из Compass.", "`compass-engine.service.ts` запускает и проксирует локальный движок Compass (только `ORION_MODE=local`). Модуль по умолчанию выключен."],
  home: ["Дом: квартира, дом, дача, машина как объекты, их счётчики и показания; задачи, списки, вещи, платежи и контакты остаются в своих модулях и лишь привязываются к дому.", "Контроллер отдаёт `workspaces/:workspaceId/homes`; коммунальные расчёты вынесены в соседний каталог `home-utilities/`."],
  health: ["Личный журнал здоровья: люди (вы и те, кого вы ведёте), визиты, профилактика и прививки, лекарства, измерения и симптомы.", "Записи принадлежат человеку (`subjects/:subjectId`) и видны другим участникам только по явному допуску. Врачи — обычные контакты."]
};

// ---------- загрузка TS-контрактов без сборки ----------
function loadManifests() {
  const sharedSrc = join(root, "packages", "shared-types", "src");
  const ts = createRequire(join(root, "apps", "web", "package.json"))("typescript");
  const sharedRequire = createRequire(join(root, "packages", "shared-types", "package.json"));
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (spec) => (spec.startsWith(".") ? load(join(dirname(file), spec + ".ts")) : sharedRequire(spec));
    new Function("exports", "require", "module", outputText)(mod.exports, req, mod);
    return mod.exports;
  }
  const manifests = load(join(sharedSrc, "component-manifest.ts"));
  const modules = load(join(sharedSrc, "modules.ts"));
  return { components: manifests.buildComponentManifests(), catalog: modules.MODULE_CATALOG };
}

// ---------- маршруты API из контроллеров ----------
function controllerFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : controllerFiles(p);
    return e.name.endsWith(".controller.ts") ? [p] : [];
  });
}

function routesByModule(projectRoot) {
  const result = new Map();
  for (const file of controllerFiles(join(projectRoot, "apps", "api", "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/((?:@\w+\([^)]*\)\s*)+)export class/g)) {
      const mod = /@RequireModule\("([^"]+)"\)/.exec(match[1]);
      const route = /@Controller\("([^"]*)"\)/.exec(match[1]);
      if (!mod || !route) continue;
      if (!result.has(mod[1])) result.set(mod[1], new Set());
      result.get(mod[1]).add(route[1]);
    }
  }
  // Оставляем только корневые префиксы: вложенные маршруты не дублируем.
  return new Map([...result].map(([id, set]) => {
    const all = [...set].sort();
    return [id, all.filter((r) => !all.some((o) => o !== r && r.startsWith(o + "/")))];
  }));
}

// ---------- генерируемые блоки ----------
const list = (items) => (items.length ? items.map((i) => `\`${i}\``).join(", ") : "—");
const mdDir = (projectRoot, id) => join(projectRoot, "apps", "api", "src", DIR_OVERRIDES[id] ?? id);

function context(projectRoot) {
  const { components, catalog } = loadManifests();
  const routes = routesByModule(projectRoot);
  const modules = components.filter((c) => c.kind === "module");
  return modules.map((manifest) => {
    const entry = catalog.find((c) => c.id === manifest.id);
    const plugins = components.filter((c) => c.kind === "plugin" && c.requires.modules.includes(manifest.id)).map((c) => c.id);
    return { manifest, entry, routes: routes.get(manifest.id) ?? [], plugins, dir: mdDir(projectRoot, manifest.id) };
  });
}

function moduleBlock({ manifest: m, entry, routes, plugins, dir }, projectRoot) {
  return [
    START,
    "## Манифест (генерируется)",
    "",
    "Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.",
    "",
    "| Поле | Значение |",
    "|---|---|",
    `| id / версия | \`${m.id}\` / ${m.version} (платформа ${m.requires.platform}) |`,
    `| Вид | ${entry.kind === "base" ? "базовый" : "дополнительный"}, по умолчанию ${entry.defaultEnabled ? "включён" : "выключен"} |`,
    `| Жёсткие зависимости | ${list(m.requires.modules)} |`,
    `| Мягкие зависимости | ${list(m.requires.optionalModules)} |`,
    `| Права (permissions) | ${list(m.permissions)}${m.permissions.length ? "" : " (в манифесте пока не объявлены)"} |`,
    `| События | публикует: ${list(m.events.publishes)}; слушает: ${list(m.events.subscribes)} |`,
    `| Панели веба | ${list(m.contributions.panels ?? [])} |`,
    `| Слоты | ${list(m.contributions.slots ?? [])} |`,
    `| Маршруты API | ${list(routes)} |`,
    `| Плагины, расширяющие модуль | ${list(plugins)} |`,
    `| Миграции в манифесте | ${list(m.migrations)} |`,
    `| Код на сервере | \`${relative(projectRoot, dir).split("\\").join("/")}/\` |`,
    `| При выключении | ${entry.disableBehavior} |`,
    END
  ].join("\n");
}

function aiBlock({ manifest: m, entry, routes, plugins, dir }, projectRoot) {
  const rel = relative(projectRoot, dir).split("\\").join("/");
  return [
    START,
    "## Для агента (генерируется)",
    "",
    "Блок собирается `pnpm module-docs`; руками не править.",
    "",
    `- Точки входа: API ${list(routes)} (за \`@RequireModule("${m.id}")\`); панель веба ${list(m.contributions.panels ?? [])}; код \`${rel}/\`.`,
    `- Права: ${m.permissions.length ? list(m.permissions) : "в манифесте не объявлены — действуют роли пространства (assertMember) и RLS"}.`,
    `- Модуль владеет: ${entry.owns}`,
    `- Соседи: жёсткие: ${list(m.requires.modules)}; мягкие: ${list(m.requires.optionalModules)}; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через \`isEnabled\`.`,
    `- Расширения: плагины: ${list(plugins)}.`,
    "- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.",
    END
  ].join("\n");
}

const MODULE_HEAD = (id, entry, intro) => `# ${entry.label} (\`${id}\`)\n\n${intro.join("\n\n")}\n\n${entry.livesWithout}\n`;
const AI_HEAD = (id, intro) => `# Контекст агента: модуль ${id}\n\nСначала прочитайте \`MODULE.md\` рядом. ${intro[0]}\n\nКаждый метод сервиса начинается с проверки членства и идёт через \`PrismaService.withUser\`; ссылки на другие записи проверяются на принадлежность тому же пространству; ответы собираются \`toDto\`, а входы валидируются zod-схемами из \`shared-types\`.\n`;

function withBlock(existing, block) {
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s !== -1 && e > s) return existing.slice(0, s) + block + existing.slice(e + END.length);
  return existing.replace(/\s*$/, "\n\n") + block + "\n";
}

/** Ожидаемое содержимое файла; `existing === null` — файла нет. */
function expected(existing, block, head) {
  return withBlock(existing ?? head + "\n", block);
}

// ---------- проверка упоминаний пакетов ----------
function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return [".next", "node_modules", "target", ".git", "graft", "dist"].includes(e.name) ? [] : markdownFiles(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

function realPackageNames(projectRoot) {
  const names = new Set();
  for (const group of ["packages", "apps"]) {
    const base = join(projectRoot, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      const pkg = join(base, d.name, "package.json");
      if (d.isDirectory() && existsSync(pkg)) {
        const name = JSON.parse(readFileSync(pkg, "utf8")).name;
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Строка с пометкой «планируется»/«planned» может ссылаться на ещё не существующий пакет. */
export function packageMentionProblems(projectRoot = root) {
  const real = realPackageNames(projectRoot);
  const files = [...markdownFiles(join(projectRoot, "docs")), ...readdirSync(projectRoot).filter((f) => f.endsWith(".md")).map((f) => join(projectRoot, f))];
  const problems = [];
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (/планируется|planned/i.test(line)) return;
      for (const m of line.matchAll(/@orion\/([a-z0-9][a-z0-9-]*)/g)) {
        if (!real.has(`@orion/${m[1]}`)) problems.push(`${relative(projectRoot, file)}:${i + 1} упоминает несуществующий пакет @orion/${m[1]} (нужна пометка «планируется (G24)»)`);
      }
    });
  }
  return problems;
}

// ---------- основной проход ----------
export function moduleDocsProblems(projectRoot = root, { write = false } = {}) {
  const problems = [];
  for (const ctx of context(projectRoot)) {
    const id = ctx.manifest.id;
    if (!existsSync(ctx.dir)) { problems.push(`модуль ${id}: нет каталога ${relative(projectRoot, ctx.dir)}`); continue; }
    if (!ctx.routes.length) problems.push(`модуль ${id}: не найден контроллер с @RequireModule("${id}")`);
    const intro = INTROS[id] ?? [ctx.entry.summary];
    for (const [name, block, head] of [
      ["MODULE.md", moduleBlock(ctx, projectRoot), MODULE_HEAD(id, ctx.entry, intro)],
      ["AI_CONTEXT.md", aiBlock(ctx, projectRoot), AI_HEAD(id, intro)]
    ]) {
      const file = join(ctx.dir, name);
      const current = existsSync(file) ? readFileSync(file, "utf8") : null;
      const next = expected(current, block, head);
      if (current === next) continue;
      if (write) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, next); }
      else problems.push(`${relative(projectRoot, file)}: ${current === null ? "файл отсутствует" : "генерируемый блок устарел или не создан"} (pnpm module-docs)`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const problems = [...moduleDocsProblems(root, { write: !check }), ...packageMentionProblems(root)];
  if (problems.length) {
    console.error(problems.map((p) => `- ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(check ? "Module docs: OK" : "Module docs: обновлены");
}
