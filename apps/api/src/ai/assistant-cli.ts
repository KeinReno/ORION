import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssistantEngine } from "@orion/shared-types";
import { clientConfigPath } from "./agent-client-install";

/**
 * The assistant's chat answered by a program the user already has on this computer and pays for (Codex, Cursor), instead
 * of a model by an API key. ORION runs it for ONE answer: a temporary folder as its working directory, ORION's MCP server
 * under the name `orion_chat` with a short-lived token of the chat (issued and revoked by `AssistantChatService`).
 *
 * Safety rules of this file:
 * - nothing the user wrote ever goes into a command line — the prompt goes through stdin (Codex) or a file in the
 *   temporary folder (Cursor); the arguments are ours and checked before a Windows shell sees them;
 * - the token goes to the MCP server through the environment, not through arguments (visible in the process list);
 * - the program gets a read-only sandbox (Codex) and an empty folder; it acts in ORION only through MCP, where the token's
 *   mode, permissions and confirmations apply as for any agent.
 */

export type CliEngine = Exclude<AssistantEngine, "anthropic">;

export const CLI_MCP_SERVER = "orion_chat";
/** Under Node's own 5-minute request timeout: the user must get the reason, not a dropped connection. */
const RUN_TIMEOUT_MS = 4 * 60_000;
const OUTPUT_LIMIT = 200_000;
export const CLI_TASK_FILE = "ORION_TASK.md";

export interface CliBinary {
  file: string;
  /** A `.cmd`/`.bat` shim (npm on Windows) must go through cmd.exe. */
  viaCmd: boolean;
}

const WINDOWS_EXTS = [".exe", ".cmd", ".bat"];

/** `name` on PATH (with Windows extensions); null when absent. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = fs.existsSync): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const names = platform === "win32" ? WINDOWS_EXTS.map((ext) => `${name}${ext}`) : [name];
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = join(dir.replace(/^"|"$/g, ""), candidate);
      if (exists(full)) return full;
    }
  }
  return null;
}

/** Where the program's command line lives: an explicit override, PATH, then the usual install folders. */
export function findCliBinary(engine: CliEngine, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = fs.existsSync): CliBinary | null {
  const home = os.homedir();
  const override = (engine === "codex" ? env.ORION_CODEX_BIN : env.ORION_CURSOR_AGENT_BIN)?.trim();
  const candidates: Array<string | null> = override
    ? [override]
    : engine === "codex"
      ? [
          findOnPath("codex", env, platform, exists),
          platform === "win32" && env.APPDATA ? path.join(env.APPDATA, "npm", "codex.cmd") : null
        ]
      : [
          findOnPath("cursor-agent", env, platform, exists),
          // The CLI is also installed as `agent` — a generic name, so only when it lives in a Cursor folder.
          ((found) => (found && /cursor/i.test(found) ? found : null))(findOnPath("agent", env, platform, exists)),
          platform === "win32" && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "cursor-agent", "cursor-agent.cmd") : null,
          path.join(home, ".local", "bin", "cursor-agent")
        ];
  for (const file of candidates) {
    if (file && exists(file)) return { file, viaCmd: platform === "win32" && /\.(cmd|bat)$/i.test(file) };
  }
  return null;
}

/** Codex keeps its sign-in in `$CODEX_HOME/auth.json`; an API key in the environment works too. */
export function codexSignedIn(env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): boolean {
  if (env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) return true;
  return exists(path.join(path.dirname(clientConfigPath("codex", env)), "auth.json"));
}

/** Codex already has ORION connected as `orion` (one-click install): switched off for this run, so tools are not doubled. */
export function codexHasOrionServer(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return /^\s*\[mcp_servers\.orion\]\s*$/m.test(fs.readFileSync(clientConfigPath("codex", env), "utf8"));
  } catch {
    return false;
  }
}

/** A TOML literal string: no escapes, so a Windows path stays as it is. A value with `'` cannot be one. */
function tomlLiteral(value: string): string {
  if (/['\r\n]/.test(value)) throw new Error(`Нельзя передать Codex путь «${value}»`);
  return `'${value}'`;
}

export interface McpLaunch {
  command: string;
  args: string[];
}

/** `codex exec` reading the prompt from stdin, ORION's MCP server through `-c` overrides, the token from the environment. */
export function codexArgs(mcp: McpLaunch, outFile: string, disableInstalledOrion: boolean): string[] {
  const key = `mcp_servers.${CLI_MCP_SERVER}`;
  return [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-last-message",
    outFile,
    "-c",
    `${key}.command=${tomlLiteral(mcp.command)}`,
    "-c",
    `${key}.args=[${mcp.args.map(tomlLiteral).join(",")}]`,
    "-c",
    `${key}.env_vars=['ORION_AGENT_TOKEN','ORION_API_URL']`,
    "-c",
    `${key}.required=true`,
    // ORION decides what needs a human (requests with confirmation); Codex asking again would block a headless run.
    "-c",
    `${key}.default_tools_approval_mode='approve'`,
    ...(disableInstalledOrion ? ["-c", "mcp_servers.orion.enabled=false"] : []),
    "-"
  ];
}

/**
 * Cursor reads MCP servers from `.cursor/mcp.json` of its working folder; the prompt is a file there. `--trust`: a fresh
 * temporary folder is otherwise «untrusted» and Cursor waits for a yes nobody can give (the run hung until the timeout
 * on a real machine). `--sandbox enabled`: in print mode Cursor may run shell commands — they stay sandboxed.
 */
export function cursorArgs(workspace: string): string[] {
  return [
    "-p",
    "--trust",
    "--approve-mcps",
    "--sandbox",
    "enabled",
    "--workspace",
    workspace,
    "--output-format",
    "text",
    `Read the file ${CLI_TASK_FILE} in the current folder and do exactly what it asks. Answer in Russian.`
  ];
}

export function cursorMcpJson(mcp: McpLaunch, env: Record<string, string>): string {
  return JSON.stringify({ mcpServers: { [CLI_MCP_SERVER]: { command: mcp.command, args: mcp.args, env } } }, null, 2);
}

/** One argument for cmd.exe: quoted; refused when it could break out of the quotes or expand a variable. */
export function cmdQuote(value: string): string {
  if (/["%\r\n]/.test(value)) throw new Error("Недопустимый символ в аргументе программы");
  return `"${value}"`;
}

export interface CliRun {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/** Runs the program; Windows shims go through `cmd.exe /d /s /c` with every argument quoted by `cmdQuote`. */
export function runCli(binary: CliBinary, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number }): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = binary.viaCmd
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${[binary.file, ...args].map(cmdQuote).join(" ")}"`], {
          cwd: options.cwd,
          env: options.env,
          windowsVerbatimArguments: true,
          windowsHide: true
        })
      : spawn(binary.file, args, { cwd: options.cwd, env: options.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      else child.kill("SIGKILL");
    }, options.timeoutMs ?? RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin ?? "");
  });
}

/**
 * What the program may see of ORION's environment: what it needs to start, find its own sign-in and reach the network.
 * Never the server's secrets (JWT_SECRET, SYNC_SECRET, database URLs) — the program could print its environment into
 * the conversation with its model.
 */
const CLI_ENV_ALLOW = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "COMSPEC", "SystemDrive",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USERNAME", "USER", "LOGNAME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "TEMP", "TMP", "TMPDIR", "XDG_CONFIG_HOME",
  "XDG_DATA_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL", "TERM", "SHELL", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
  "CODEX_HOME", "CODEX_API_KEY", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CURSOR_API_KEY"
];

export function cliEnvironment(source: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of CLI_ENV_ALLOW) if (source[name] !== undefined) env[name] = source[name];
  return { ...env, ...extra };
}

export interface CliAnswer {
  reply: string;
  failed: string | null;
  /** The tail of the program's own output when it failed — for the server log, never for the user. */
  detail: string | null;
}

/**
 * One answer from the program. `prompt` is the whole task (instructions + conversation); `env` carries the token for
 * the MCP server. The temporary folder is removed afterwards whatever happens.
 */
export async function askCli(engine: CliEngine, binary: CliBinary, mcp: McpLaunch, prompt: string, tokenEnv: Record<string, string>): Promise<CliAnswer> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `orion-${engine}-`));
  try {
    const env = cliEnvironment(process.env, tokenEnv);
    let run: CliRun;
    let reply: string;
    if (engine === "codex") {
      const outFile = path.join(dir, "answer.md");
      run = await runCli(binary, codexArgs(mcp, outFile, codexHasOrionServer()), { cwd: dir, env, stdin: prompt });
      reply = await fs.promises.readFile(outFile, "utf8").catch(() => "");
    } else {
      await fs.promises.mkdir(path.join(dir, ".cursor"));
      await fs.promises.writeFile(path.join(dir, ".cursor", "mcp.json"), cursorMcpJson(mcp, tokenEnv), "utf8");
      await fs.promises.writeFile(path.join(dir, CLI_TASK_FILE), prompt, "utf8");
      run = await runCli(binary, cursorArgs(dir), { cwd: dir, env });
      reply = run.stdout;
    }
    const detail = `код ${run.code ?? "—"}; ${(run.stderr || run.stdout).trim().slice(-800)}`;
    if (run.timedOut) {
      return {
        reply: reply.trim(),
        failed: `${engine === "codex" ? "Codex" : "Cursor"} не ответил за 4 минуты — ответ прерван. Проверьте, что программа отвечает в терминале без вопросов (вход выполнен).`,
        detail
      };
    }
    if (run.code !== 0 && !reply.trim()) return { reply: "", failed: cliFailure(engine, run.stderr || run.stdout), detail };
    return { reply: reply.trim(), failed: null, detail: null };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A short Russian reason from the program's error output; the raw tail stays for the log only. */
export function cliFailure(engine: CliEngine, output: string): string {
  const text = output.toLowerCase();
  const name = engine === "codex" ? "Codex" : "Cursor";
  if (/log ?in|sign ?in|not authenticated|unauthori[sz]ed|401|auth/.test(text)) {
    return engine === "codex" ? "Codex не вошёл в учётную запись — выполните «codex login» в терминале." : "Cursor CLI не вошёл — выполните «cursor-agent login» в терминале.";
  }
  if (/rate limit|usage limit|quota|429/.test(text)) return `${name}: исчерпан лимит подписки — попробуйте позже.`;
  return `${name} завершился с ошибкой. Проверьте, что программа запускается в терминале.`;
}
