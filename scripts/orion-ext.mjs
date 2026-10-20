#!/usr/bin/env node
/**
 * orion-ext — создать и собрать расширение ORION без пересборки программы (ADR-0022, E2).
 *
 *   node scripts/orion-ext.mjs init <id> [--name "Название"] [--dir <папка расширений>]
 *        создаёт <папка расширений>/<id>/ с манифестом, src/index.tsx (панель, карточка дашборда, команда), tsconfig.json
 *        для подсказок редактора и README, и сразу собирает web.js — ORION увидит расширение за пару секунд
 *   node scripts/orion-ext.mjs build [<папка расширения>] [--watch]
 *        собирает src/index.tsx → web.js; с --watch пересобирает при каждой правке (вместе с «режимом разработчика»
 *        в настройках ORION правка видна без перезапуска)
 *
 * Папка расширений по умолчанию — Документы\ORION\Расширения (ORION_EXTENSIONS_DIR переопределяет), как у сервера.
 * React, @orion/ui, @orion/core-react и @orion/sdk в бандл не попадают: во время выполнения их даёт ORION
 * (`globalThis.__ORION_SDK__`, apps/web/lib/extensions/runtime/sdk.ts). Остальные пакеты (например, lucide-react)
 * берутся из node_modules этого репозитория и попадают в бандл.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Что берётся из ORION во время выполнения. */
export const SDK_MODULES = ["react", "react/jsx-runtime", "@orion/ui", "@orion/core-react", "@orion/sdk"];

export function defaultExtensionsDir(env = process.env, home = os.homedir()) {
  return resolve(env.ORION_EXTENSIONS_DIR?.trim() || join(home, "Documents", "ORION", "Расширения"));
}

function platformVersion() {
  const text = readFileSync(join(root, "packages/shared-types/src/component-manifest.ts"), "utf8");
  return /PLATFORM_API_VERSION = "(\d+\.\d+\.\d+)"/.exec(text)?.[1] ?? "1.0.0";
}

/** esbuild-плагин: модули SDK превращаются в ссылки на `globalThis.__ORION_SDK__.modules[...]`. */
export const orionSdkPlugin = {
  name: "orion-sdk",
  setup(build) {
    const filter = new RegExp(`^(${SDK_MODULES.map((name) => name.replace(/[/.]/g, "\\$&")).join("|")})$`);
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "orion-sdk" }));
    build.onLoad({ filter: /.*/, namespace: "orion-sdk" }, (args) => ({
      contents:
        `const sdk = globalThis.__ORION_SDK__;\n` +
        `if (!sdk) throw new Error("ORION SDK не найден: расширение запускается только внутри ORION");\n` +
        `module.exports = sdk.modules[${JSON.stringify(args.path)}];\n`,
      loader: "js"
    }));
  }
};

export function buildOptions(dir) {
  return {
    entryPoints: [join(dir, "src", "index.tsx")],
    outfile: join(dir, "web.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    charset: "utf8",
    legalComments: "none",
    logLevel: "warning",
    // Packages an extension may bundle (icons, small libraries) resolve from ORION's own install.
    nodePaths: [join(root, "apps/web/node_modules"), join(root, "node_modules")],
    plugins: [orionSdkPlugin]
  };
}

function manifestProblems(manifest) {
  const problems = [];
  if (!ID_RE.test(manifest.id ?? "")) problems.push("id — kebab-case");
  if (typeof manifest.name !== "string" || !manifest.name.trim()) problems.push("name — название");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) problems.push("version — semver вида 1.0.0");
  if (!/^(\^|~|>=)?\d+\.\d+\.\d+$/.test(manifest.engines?.orion ?? "")) problems.push("engines.orion — диапазон вида ^1.1.0");
  return problems;
}

export async function build(dir, { watch = false } = {}) {
  const manifestPath = join(dir, "orion.extension.json");
  if (!existsSync(manifestPath)) throw new Error(`${dir}: нет orion.extension.json — это не папка расширения`);
  const problems = manifestProblems(JSON.parse(readFileSync(manifestPath, "utf8").trimStart()));
  if (problems.length > 0) throw new Error(`orion.extension.json: ${problems.join("; ")}`);
  if (!existsSync(join(dir, "src", "index.tsx"))) throw new Error(`${dir}: нет src/index.tsx`);
  const esbuild = await import("esbuild");
  if (!watch) {
    await esbuild.build(buildOptions(dir));
    return;
  }
  const context = await esbuild.context({
    ...buildOptions(dir),
    plugins: [
      orionSdkPlugin,
      { name: "report", setup: (b) => b.onEnd((result) => console.log(result.errors.length ? "Ошибки сборки — см. выше" : `Собрано ${new Date().toLocaleTimeString("ru-RU")}`)) }
    ]
  });
  await context.watch();
  console.log("Слежу за src/ — Ctrl+C, чтобы остановить");
}

const pascal = (id) => id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");

export function templateFiles(id, name) {
  const component = pascal(id);
  const sdkPaths = {
    "@orion/sdk": [join(root, "apps/web/lib/extensions/host-api.ts")],
    "@orion/ui": [join(root, "packages/ui/src/index.ts")],
    "@orion/core-react": [join(root, "packages/core-react/src/index.ts")],
    "@orion/shared-types": [join(root, "packages/shared-types/src/index.ts")],
    "react": [join(root, "apps/web/node_modules/@types/react")],
    "lucide-react": [join(root, "apps/web/node_modules/lucide-react")]
  };
  return {
    "orion.extension.json": JSON.stringify(
      {
        id,
        name,
        version: "0.1.0",
        description: "Новое расширение ORION.",
        engines: { orion: `^${platformVersion()}` },
        entry: "web.js",
        permissions: { network: [], secrets: [], storage: false }
      },
      null,
      2
    ) + "\n",
    "src/index.tsx": `import { useTasks } from "@orion/core-react";
import { openPanel, type ExtensionContext, type ExtensionPanelProps, type ExtensionPlaceProps } from "@orion/sdk";
import { PanelBody, PanelHeader, PanelShell } from "@orion/ui";
import { Sparkles } from "lucide-react";

/** Панель расширения: своя вкладка дока и пункт меню (группа «Расширения»). */
function ${component}Panel({ workspaceId }: ExtensionPanelProps) {
  const tasks = useTasks(workspaceId);
  return (
    <PanelShell>
      <PanelHeader icon={Sparkles} title=${JSON.stringify(name)} subtitle="Расширение из папки" />
      <PanelBody>
        <p className="text-sm text-muted-foreground">Задач в этом пространстве: {tasks.data?.length ?? "…"}</p>
      </PanelBody>
    </PanelShell>
  );
}

/** Карточка на дашборде. */
function ${component}Card({ workspaceId }: ExtensionPlaceProps) {
  const tasks = useTasks(workspaceId);
  return <p className="text-label text-muted-foreground">Задач: {tasks.data?.length ?? "…"}</p>;
}

/** Вызывается, когда ORION загружает расширение; всё зарегистрированное снимется само при выключении. */
export function activate(ctx: ExtensionContext) {
  ctx.addPanel({ id: "main", label: ${JSON.stringify(name)}, icon: Sparkles, component: ${component}Panel });
  ctx.addWidget({ id: "card", title: ${JSON.stringify(name)}, component: ${component}Card });
  ctx.addCommand({ id: "open", label: ${JSON.stringify(`Открыть «${name}»`)}, icon: Sparkles, run: () => openPanel(\`ext:\${ctx.id}.main\`) });
}
`,
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: ".",
          // Подсказки редактора из исходников ORION на этом компьютере (путь к репозиторию; поменялся — запустите init заново в другой папке).
          paths: sdkPaths
        },
        include: ["src"]
      },
      null,
      2
    ) + "\n",
    "README.md": `# ${name}

Расширение ORION (ADR-0022). Папка лежит в папке расширений — ORION замечает её сам.

1. Правьте \`src/index.tsx\`.
2. Соберите: \`node <репозиторий ORION>/scripts/orion-ext.mjs build "${"<эта папка>"}"\` (или \`--watch\`, чтобы пересобирать на каждую правку).
3. В ORION: «Настройки → Этот компьютер → Расширения» — подтвердите расширение. Пока правите, включите «Режим разработчика»:
   изменения видны без повторного подтверждения и без перезапуска.

Что доступно коду: \`ctx.addPanel / addWidget / addSettings / addCommand\`, компоненты \`@orion/ui\`, хуки данных \`@orion/core-react\`
(с правами пользователя), функции \`@orion/sdk\` (openPanel, openEntity, форматирование…).
`
  };
}

export async function init(id, { name, dir }) {
  if (!ID_RE.test(id)) throw new Error(`id «${id}»: kebab-case — строчные латинские буквы и цифры через дефис`);
  const target = join(dir, id);
  if (existsSync(target)) throw new Error(`${target} уже существует — ничего не перезаписываю`);
  for (const [file, content] of Object.entries(templateFiles(id, name))) {
    const path = join(target, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  await build(target);
  return target;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const run = async () => {
    if (command === "init") {
      const id = args.find((arg) => !arg.startsWith("--") && arg !== option(args, "--name") && arg !== option(args, "--dir"));
      if (!id) throw new Error('Укажите id: orion-ext init ai-tokens --name "Расход токенов"');
      const target = await init(id, { name: option(args, "--name") ?? id, dir: resolve(option(args, "--dir") ?? defaultExtensionsDir()) });
      console.log(`Создано и собрано: ${target}\nДальше: «Настройки → Этот компьютер → Расширения» в ORION — подтвердите расширение.`);
    } else if (command === "build") {
      const target = resolve(args.find((arg) => !arg.startsWith("--")) ?? process.cwd());
      await build(target, { watch: args.includes("--watch") });
      if (!args.includes("--watch")) console.log(`Собрано: ${join(target, "web.js")}`);
    } else {
      console.log("orion-ext init <id> [--name \"Название\"] [--dir <папка>] | build [<папка расширения>] [--watch]");
      process.exitCode = command ? 2 : 0;
    }
  };
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
