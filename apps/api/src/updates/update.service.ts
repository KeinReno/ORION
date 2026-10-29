import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  APP_UPDATE_DEFAULT_REPO,
  type AppUpdateConfig,
  type AppUpdateRelease,
  type AppUpdateStatus,
  type SetAppUpdateConfigInput
} from "@orion/shared-types";
import { nodeDir, writeJsonAtomic } from "../lan/node-config";
import { openSecret, sealSecret } from "../sync/sync-crypto";
import { buildApplyScript } from "./apply-script";
import { compareTags, extractSha256, pickInstallerAsset, pickPayloadAsset, pickLatestRelease, type GithubRelease } from "./release-feed";

interface StoredConfig {
  repo: string;
  tokenEnc: string | null;
  autoCheck: boolean;
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;

/** Адрес API GitHub берётся только из окружения (тесты подставляют свой сервер), не из запроса пользователя. */
function githubApi(): string {
  return (process.env.ORION_GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

const READ_IDLE_MS = 20_000;

/** Read at most `size` bytes, then cancel. A quiet connection fails instead of leaving the bar at 100%. */
async function readBodyUpTo(
  body: ReadableStream<Uint8Array>,
  file: string,
  size: number,
  onProgress: (received: number) => void
): Promise<{ received: number; sha256: string }> {
  const hash = createHash("sha256");
  const out = fs.createWriteStream(file);
  const reader = body.getReader();
  let received = 0;
  try {
    while (received < size) {
      const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Скачивание остановилось — соединение замолчало")), READ_IDLE_MS);
        reader.read().then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); }
        );
      });
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      const take = Math.min(chunk.length, size - received);
      const bytes = take === chunk.length ? chunk : chunk.subarray(0, take);
      hash.update(bytes);
      received += bytes.length;
      await new Promise<void>((resolve, reject) => out.write(bytes, (error) => (error ? reject(error) : resolve())));
      onProgress(received);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  return { received, sha256: hash.digest("hex") };
}

function downloadFailure(error: unknown): string {
  if (error instanceof BadRequestException) return error.message;
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    const line = stderr.split(/\r?\n/).find((item) => item.trim() !== "");
    if (line) return line.trim();
  }
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "Не удалось скачать обновление";
}

/**
 * GitHub Releases: prefer a signed application payload compatible with the immutable shell;
 * retain the full-installer path for old hosts and native/schema changes. Payload verification
 * and selection belong to the shell verifier, outside the replaceable application.
 * Credentials stay encrypted with sealSecret and are never returned.
 */
@Injectable()
export class UpdateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpdateService.name);
  private timer: NodeJS.Timeout | null = null;
  private status: Pick<AppUpdateStatus, "state" | "latest" | "progress" | "error" | "lastCheckedAt"> = {
    state: "idle",
    latest: null,
    progress: 0,
    error: null,
    lastCheckedAt: null
  };
  private downloaded: { tag: string; file: string; payloadId?: string } | null = null;

  private payloadBase(): string | undefined {
    const runtime = process.env.ORION_SHELL_RUNTIME;
    if (!runtime || !fs.existsSync(path.join(runtime, "update-public-key.pem"))) return undefined;
    return process.env.ORION_SHELL_BASE_TAG || undefined;
  }

  private async payloadCommand(command: string, ...args: string[]): Promise<string> {
    const runtime = process.env.ORION_SHELL_RUNTIME;
    if (!runtime || !this.payloadBase()) throw new BadRequestException("Для пакетов обновлений нужна новая полная установка ORION");
    // Copying the unchanged files of a payload is a few hundred megabytes. 120s was killing a
    // healthy prepare, and the settings screen then sat at 100% with no install button.
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(runtime, "payload.cjs"), command, runtime, nodeDir(), ...args], { windowsHide: true, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 });
    return stdout;
  }

  acknowledgeUi(tag: string): { accepted: boolean } {
    const marker = process.env.ORION_PAYLOAD_ACK_FILE;
    if (marker && fs.existsSync(marker) && tag === this.currentTag()) { fs.writeFileSync(marker, tag, { flag: "w" }); return { accepted: true }; }
    return { accepted: false };
  }

  onModuleInit(): void {
    const first = setTimeout(() => void this.autoCheck(), FIRST_CHECK_DELAY_MS);
    first.unref();
    this.timer = setInterval(() => void this.autoCheck(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── настройки ───────────────────────────────────────────────────────────────────────────────
  private configPath(): string {
    return path.join(nodeDir(), "update-config.json");
  }

  private readConfig(): StoredConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath(), "utf8")) as Partial<StoredConfig>;
      return { repo: raw.repo || APP_UPDATE_DEFAULT_REPO, tokenEnc: raw.tokenEnc ?? null, autoCheck: raw.autoCheck ?? true };
    } catch {
      return { repo: APP_UPDATE_DEFAULT_REPO, tokenEnc: null, autoCheck: true };
    }
  }

  getConfig(): AppUpdateConfig {
    const config = this.readConfig();
    return { repo: config.repo, tokenSet: config.tokenEnc !== null, autoCheck: config.autoCheck };
  }

  setConfig(input: SetAppUpdateConfigInput): AppUpdateConfig {
    if (["checking", "downloading", "applying"].includes(this.status.state)) throw new ConflictException("Дождитесь завершения текущего обновления");
    const current = this.readConfig();
    let tokenEnc = current.tokenEnc;
    if (input.token === null) tokenEnc = null;
    else if (typeof input.token === "string") {
      try {
        tokenEnc = sealSecret(input.token);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Не удалось зашифровать токен");
      }
    }
    writeJsonAtomic(this.configPath(), { repo: input.repo ?? current.repo, tokenEnc, autoCheck: input.autoCheck ?? current.autoCheck });
    // Другая учётная запись или репозиторий — прежний результат проверки недействителен.
    this.status = { state: "idle", latest: null, progress: 0, error: null, lastCheckedAt: null };
    this.downloaded = null;
    return this.getConfig();
  }

  private token(): string | null {
    const config = this.readConfig();
    if (!config.tokenEnc) return null;
    try {
      return openSecret(config.tokenEnc);
    } catch {
      return null;
    }
  }

  // ── состояние ───────────────────────────────────────────────────────────────────────────────
  private installDir(): string | null {
    const fromEnv = process.env.ORION_INSTALL_DIR?.trim();
    return fromEnv && fs.existsSync(path.join(fromEnv, "orion-desktop.exe")) ? fromEnv : null;
  }

  currentTag(): string | null {
    return process.env.ORION_BUILD_TAG?.trim() || null;
  }

  getStatus(): AppUpdateStatus {
    return {
      currentTag: this.currentTag(),
      currentVersion: process.env.APP_VERSION ?? "0.0.0",
      configured: this.token() !== null,
      canApply: process.platform === "win32" && this.installDir() !== null,
      ...this.status,
      error: this.status.error || process.env.ORION_PAYLOAD_FAILURE || null
    };
  }

  private fail(message: string): never {
    this.status = { ...this.status, state: "error", error: message, progress: 0 };
    throw new BadRequestException(message);
  }

  private async autoCheck(): Promise<void> {
    if (!this.readConfig().autoCheck || !this.token()) return;
    if (this.status.state === "downloading" || this.status.state === "applying" || this.status.state === "ready") return;
    try {
      await this.check();
    } catch (error) {
      this.logger.warn(`Автопроверка обновлений: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── проверка ────────────────────────────────────────────────────────────────────────────────
  async check(): Promise<AppUpdateStatus> {
    const token = this.token();
    if (!token) this.fail("Токен GitHub не задан: добавьте его в настройках обновлений");
    if (["checking", "downloading", "applying"].includes(this.status.state)) throw new ConflictException("Сейчас идёт проверка, скачивание или установка обновления");
    const repo = this.readConfig().repo;
    this.status = { ...this.status, state: "checking", error: null };
    let releases: GithubRelease[];
    try {
      const response = await fetch(`${githubApi()}/repos/${repo}/releases?per_page=30`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "orion-desktop-updater" },
        signal: AbortSignal.timeout(20_000)
      });
      if (response.status === 401 || response.status === 403) this.fail("GitHub отклонил токен: проверьте его и права на репозиторий");
      if (response.status === 404) this.fail("Репозиторий не найден или у токена нет к нему доступа");
      if (!response.ok) this.fail(`GitHub ответил ошибкой (код ${response.status})`);
      releases = (await response.json()) as GithubRelease[];
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.fail("Не удалось связаться с GitHub — проверьте подключение к интернету");
    }
    const latest = pickLatestRelease(releases, true, this.payloadBase());
    const lastCheckedAt = new Date().toISOString();
    if (!latest) {
      this.status = { state: "up_to_date", latest: null, progress: 0, error: null, lastCheckedAt };
      return this.getStatus();
    }
    const payloadAsset = pickPayloadAsset(latest, this.payloadBase());
    const asset = payloadAsset ?? pickInstallerAsset(latest)!;
    const info: AppUpdateRelease = {
      tag: latest.tag_name,
      name: latest.name ?? latest.tag_name,
      notes: latest.body ?? "",
      publishedAt: latest.published_at,
      sizeBytes: asset.size,
      kind: payloadAsset ? "payload" : "installer",
      assetName: asset.name,
      sha256: payloadAsset ? null : extractSha256(latest.body)
    };
    const current = this.currentTag();
    // Сборка без метки (старая установка) не знает своей версии — предлагаем самую новую.
    const newer = current === null || compareTags(info.tag, current) > 0;
    const ready = this.downloaded?.tag === info.tag && fs.existsSync(this.downloaded.file);
    this.status = { state: newer ? (ready ? "ready" : "available") : "up_to_date", latest: newer ? info : null, progress: 0, error: null, lastCheckedAt };
    return this.getStatus();
  }

  // ── скачивание ──────────────────────────────────────────────────────────────────────────────
  async download(): Promise<AppUpdateStatus> {
    const latest = this.status.latest;
    if (!latest || (this.status.state !== "available" && this.status.state !== "error" && this.status.state !== "ready")) {
      throw new ConflictException("Сначала проверьте наличие обновления");
    }
    if (latest.kind !== "payload" && !latest.sha256) this.fail("В описании релиза нет контрольной суммы SHA-256 — установщик не будет применён");
    const token = this.token();
    if (!token) this.fail("Токен GitHub не задан");
    const repo = this.readConfig().repo;
    const dir = path.join(nodeDir(), "updates", latest.tag.replace(/[^0-9A-Za-z._-]/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    this.status = { ...this.status, state: "downloading", progress: 0, error: null };
    this.downloaded = null;
    let downloadPath: string | null = null;
    try {
      const releases = await fetch(`${githubApi()}/repos/${repo}/releases/tags/${encodeURIComponent(latest.tag)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orion-desktop-updater" },
        signal: AbortSignal.timeout(20_000)
      });
      if (!releases.ok) this.fail(`GitHub ответил ошибкой (код ${releases.status})`);
      const release = (await releases.json()) as GithubRelease;
      const asset = latest.kind === "payload" ? pickPayloadAsset(release, this.payloadBase()) : pickInstallerAsset(release);
      if (!asset) this.fail("В релизе нет установщика");
      if (asset.name !== latest.assetName || asset.size !== latest.sizeBytes || asset.size > 512 * 1024 * 1024) this.fail("Файл релиза изменился или превышает лимит — проверьте обновления заново");
      const file = path.join(dir, asset.name.replace(/[^0-9A-Za-z._-]/g, "_"));
      downloadPath = file;
      const response = await fetch(`${githubApi()}/repos/${repo}/releases/assets/${asset.id}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream", "User-Agent": "orion-desktop-updater" },
        redirect: "follow",
        signal: AbortSignal.timeout(10 * 60_000)
      });
      if (!response.ok || !response.body) this.fail(`Не удалось скачать установщик (код ${response.status})`);
      // Stop at the declared size. Waiting for the GitHub connection to close left the bar at
      // 100% forever: the body was already complete, `end` never arrived, and the install button
      // only exists in the `ready` state.
      const downloadedBody = await readBodyUpTo(response.body, `${file}.part`, asset.size, (received) => {
        this.status = { ...this.status, progress: Math.min(1, received / Math.max(1, asset.size)) };
      });
      if (downloadedBody.received !== asset.size) {
        fs.rmSync(`${file}.part`, { force: true });
        this.fail(`Скачано ${downloadedBody.received} байт вместо ${asset.size}: файл повреждён, повторите`);
      }
      if (latest.kind !== "payload" && downloadedBody.sha256 !== latest.sha256) {
        fs.rmSync(`${file}.part`, { force: true });
        this.fail("Контрольная сумма скачанного установщика не совпала — файл отвергнут");
      }
      fs.renameSync(`${file}.part`, file);
      const prepared = latest.kind === "payload" ? JSON.parse(await this.payloadCommand("prepare", file, latest.tag)) as { id: string } : null;
      this.downloaded = { tag: latest.tag, file, ...(prepared ? { payloadId: prepared.id } : {}) };
      this.status = { ...this.status, state: "ready", progress: 1, error: null };
    } catch (error) {
      if (downloadPath) { fs.rmSync(`${downloadPath}.part`, { force: true }); fs.rmSync(downloadPath, { force: true }); }
      const message = downloadFailure(error);
      if (this.status.state !== "error") {
        this.status = { ...this.status, state: "error", progress: 0, error: message };
        this.logger.warn(`Скачивание обновления: ${message}`);
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(this.status.error ?? message);
    }
    return this.getStatus();
  }

  // ── применение ──────────────────────────────────────────────────────────────────────────────
  async apply(): Promise<{ started: true }> {
    const status = this.getStatus();
    const installDir = this.installDir();
    if (status.state !== "ready" || !this.downloaded) throw new ConflictException("Обновление ещё не скачано");
    if (process.platform !== "win32" || !installDir) throw new ConflictException("Автоматическое применение доступно только в установленной версии для Windows");
    this.status = { ...this.status, state: "applying" };
    try {
      if (this.downloaded.payloadId) await this.payloadCommand("queue", this.downloaded.payloadId);
      const dir = path.dirname(this.downloaded.file);
      const scriptPath = path.join(dir, "apply-update.ps1");
      const script = buildApplyScript({
        installer: this.downloaded.payloadId ? null : this.downloaded.file,
        appExe: path.join(installDir, "orion-desktop.exe"),
        installDir,
        pgCtl: process.env.ORION_PG_CTL?.trim() || null,
        cluster: process.env.ORION_PG_CLUSTER?.trim() || null,
        logFile: path.join(dir, "apply-update.log")
      });
      // BOM — чтобы PowerShell 5.1 прочитал кириллицу в путях как UTF-8.
      fs.writeFileSync(scriptPath, String.fromCharCode(0xfeff) + script, "utf8");
      // The apply script's own first act is to stop `orion-desktop.exe` — but that process owns a Windows
      // Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (apps/desktop/src-tauri/src/main.rs,
      // `bind_launcher_lifetime`, added to stop orphaned node/postgres processes surviving a crash).
      // Windows nests every descendant into that same job by default — including a `cmd /c start`-detached
      // PowerShell child of this API process — so the moment the script's own `Stop-Process -Name
      // 'orion-desktop'` line runs, the whole job closes and kills the script along with it, one line in.
      // Observed in practice: apply-update.log stops dead after "обновление: старт", every time.
      // Launching through the Task Scheduler sidesteps this entirely: the script then runs as a child of
      // the Task Scheduler service, never a descendant of this process or its job, so it survives
      // `orion-desktop.exe` dying by construction rather than by hoping a detach trick isn't swept up too.
      const taskName = `OrionApplyUpdate_${Date.now()}`;
      const run = promisify(execFile);
      await run("schtasks.exe", ["/create", "/tn", taskName, "/tr", `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, "/sc", "once", "/st", "23:59", "/f"], { windowsHide: true });
      await run("schtasks.exe", ["/run", "/tn", taskName], { windowsHide: true });
      // The task has already fired by the time /run returns; deleting its definition doesn't touch the
      // now-independent running script. Best-effort only — a failed cleanup must never undo the update.
      run("schtasks.exe", ["/delete", "/tn", taskName, "/f"], { windowsHide: true }).catch(() => {});
      this.status = { ...this.status, state: "applying" };
      this.logger.warn(`Запущено применение обновления ${this.downloaded.tag}`);
      return { started: true };
    } catch (error) { this.status = { ...this.status, state: "error", error: "Не удалось подготовить перезапуск" }; throw error; }
  }
}
