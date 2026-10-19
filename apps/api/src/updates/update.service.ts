import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
import { compareTags, extractSha256, pickInstallerAsset, pickLatestRelease, type GithubRelease } from "./release-feed";

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

/**
 * Обновления программы с GitHub Releases (приватный репозиторий, доступ по токену владельца). Схема: проверка → скачивание
 * установщика с проверкой размера и SHA-256 из описания релиза → по подтверждению отдельный скрипт останавливает программу,
 * ставит новый установщик поверх и запускает её снова. Токен хранится зашифрованным (`sealSecret`) и наружу не отдаётся.
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
  private downloaded: { tag: string; file: string } | null = null;

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
      ...this.status
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
    if (this.status.state === "downloading" || this.status.state === "applying") throw new ConflictException("Сейчас идёт скачивание или установка обновления");
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
    const latest = pickLatestRelease(releases);
    const lastCheckedAt = new Date().toISOString();
    if (!latest) {
      this.status = { state: "up_to_date", latest: null, progress: 0, error: null, lastCheckedAt };
      return this.getStatus();
    }
    const asset = pickInstallerAsset(latest)!;
    const info: AppUpdateRelease = {
      tag: latest.tag_name,
      name: latest.name ?? latest.tag_name,
      notes: latest.body ?? "",
      publishedAt: latest.published_at,
      sizeBytes: asset.size,
      sha256: extractSha256(latest.body)
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
    if (!latest.sha256) this.fail("В описании релиза нет контрольной суммы SHA-256 — установщик не будет применён");
    const token = this.token();
    if (!token) this.fail("Токен GitHub не задан");
    const repo = this.readConfig().repo;
    const dir = path.join(nodeDir(), "updates", latest.tag.replace(/[^0-9A-Za-z._-]/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    this.status = { ...this.status, state: "downloading", progress: 0, error: null };
    try {
      const releases = await fetch(`${githubApi()}/repos/${repo}/releases/tags/${encodeURIComponent(latest.tag)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orion-desktop-updater" },
        signal: AbortSignal.timeout(20_000)
      });
      if (!releases.ok) this.fail(`GitHub ответил ошибкой (код ${releases.status})`);
      const asset = pickInstallerAsset((await releases.json()) as GithubRelease);
      if (!asset) this.fail("В релизе нет установщика");
      const file = path.join(dir, asset.name.replace(/[^0-9A-Za-z._-]/g, "_"));
      const response = await fetch(`${githubApi()}/repos/${repo}/releases/assets/${asset.id}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream", "User-Agent": "orion-desktop-updater" },
        redirect: "follow"
      });
      if (!response.ok || !response.body) this.fail(`Не удалось скачать установщик (код ${response.status})`);
      const hash = createHash("sha256");
      let received = 0;
      const source = Readable.fromWeb(response.body as never);
      source.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        received += chunk.length;
        this.status = { ...this.status, progress: Math.min(1, received / Math.max(1, asset.size)) };
      });
      await pipeline(source, fs.createWriteStream(`${file}.part`));
      if (received !== asset.size) {
        fs.rmSync(`${file}.part`, { force: true });
        this.fail(`Скачано ${received} байт вместо ${asset.size}: файл повреждён, повторите`);
      }
      if (hash.digest("hex") !== latest.sha256) {
        fs.rmSync(`${file}.part`, { force: true });
        this.fail("Контрольная сумма скачанного установщика не совпала — файл отвергнут");
      }
      fs.renameSync(`${file}.part`, file);
      this.downloaded = { tag: latest.tag, file };
      this.status = { ...this.status, state: "ready", progress: 1, error: null };
    } catch (error) {
      if (this.status.state !== "error") {
        this.status = { ...this.status, state: "error", progress: 0, error: "Не удалось скачать обновление" };
        this.logger.warn(`Скачивание обновления: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(this.status.error ?? "Не удалось скачать обновление");
    }
    return this.getStatus();
  }

  // ── применение ──────────────────────────────────────────────────────────────────────────────
  apply(): { started: true } {
    const status = this.getStatus();
    const installDir = this.installDir();
    if (status.state !== "ready" || !this.downloaded) throw new ConflictException("Обновление ещё не скачано");
    if (process.platform !== "win32" || !installDir) throw new ConflictException("Автоматическое применение доступно только в установленной версии для Windows");
    const dir = path.dirname(this.downloaded.file);
    const scriptPath = path.join(dir, "apply-update.ps1");
    const script = buildApplyScript({
      installer: this.downloaded.file,
      appExe: path.join(installDir, "orion-desktop.exe"),
      installDir,
      pgCtl: process.env.ORION_PG_CTL?.trim() || null,
      cluster: process.env.ORION_PG_CLUSTER?.trim() || null,
      logFile: path.join(dir, "apply-update.log")
    });
    // BOM — чтобы PowerShell 5.1 прочитал кириллицу в путях как UTF-8.
    fs.writeFileSync(scriptPath, String.fromCharCode(0xfeff) + script, "utf8");
    // Запуск через `cmd /c start /B`: PowerShell, запущенный напрямую с `detached`, тихо завершается, не выполнив скрипт, а
    // запущенный без `detached` умирает вместе с родителем (проверено на установленной программе). Через `start` скрипт
    // становится независимым процессом и переживает остановку API.
    const child = spawn("cmd.exe", ["/c", "start", "", "/B", "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    this.status = { ...this.status, state: "applying" };
    this.logger.warn(`Запущено применение обновления ${this.downloaded.tag}`);
    return { started: true };
  }
}
