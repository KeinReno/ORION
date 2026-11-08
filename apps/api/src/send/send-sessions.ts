import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SendTransfer, SendTransferStatus } from "@orion/shared-types";
import { safeRelativePath } from "@orion/shared-types";
import { writeJsonAtomic } from "../lan/node-config";

export class SendFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface SessionFile {
  relativePath: string;
  size: number;
  sha256: string;
  receivedBytes: number;
  state: "pending" | "transferring" | "verified" | "failed";
}

export interface SessionRecord {
  transferId: string;
  direction: "incoming" | "outgoing";
  channel: "orion" | "localsend";
  sourceDeviceId: string;
  targetDeviceId: string;
  peerName: string;
  status: SendTransferStatus;
  files: SessionFile[];
  saveDir: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  paused: boolean;
  /** Локальные пути исходящей передачи. В ответ API не входят. */
  sources: string[];
  fileTokens: string[];
}

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export async function hashFile(file: string, size?: number): Promise<string> {
  const stat = await fs.promises.stat(file);
  const bytes = size ?? stat.size;
  if (bytes === 0) return EMPTY_SHA;
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file, { start: 0, end: bytes - 1 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

export async function collectPaths(entries: readonly string[]): Promise<Array<{ absolute: string; relativePath: string; size: number; sha256: string }>> {
  const found: Array<{ absolute: string; relativePath: string; size: number; sha256: string }> = [];
  const seen = new Set<string>();
  async function add(absolute: string, relativePath: string): Promise<void> {
    const safe = safeRelativePath(relativePath);
    if (!safe || seen.has(safe)) return;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(absolute);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of await fs.promises.readdir(absolute)) await add(path.join(absolute, name), `${safe}/${name}`);
      return;
    }
    if (!stat.isFile()) return;
    seen.add(safe);
    found.push({ absolute, relativePath: safe, size: stat.size, sha256: await hashFile(absolute, stat.size) });
  }
  for (const entry of entries) await add(entry, path.basename(entry));
  if (found.length === 0) throw new SendFailure(400, "nothing_to_send", "Нет файлов для отправки");
  if (found.length > 5000) throw new SendFailure(400, "too_many_files", "Слишком много файлов за одну передачу");
  return found;
}

export async function collectTree(root: string): Promise<Array<{ absolute: string; relativePath: string; size: number; sha256: string }>> {
  const names = await fs.promises.readdir(root).catch(() => [] as string[]);
  if (names.length === 0) throw new SendFailure(400, "nothing_to_send", "Нет файлов для отправки");
  return collectPaths(names.map((name) => path.join(root, name)));
}

/**
 * Приём пишет во временный каталог внутри папки назначения и переносит файл
 * только после SHA-256. Незавершённое после перезапуска становится паузой.
 */
export class SendSessions {
  private readonly file: string;
  private sessions: SessionRecord[];
  private readonly speeds = new Map<string, Array<{ at: number; bytes: number }>>();

  constructor(
    private readonly dir: string,
    private readonly freeBytes: (directory: string) => Promise<number | null> = defaultFreeBytes
  ) {
    this.file = path.join(dir, "send-sessions.json");
    this.sessions = this.read().map((session) => ({ ...session, sources: session.sources ?? [], fileTokens: session.fileTokens ?? [] }));
    let changed = false;
    for (const session of this.sessions) {
      if (session.status === "transferring" || session.status === "verifying") {
        session.status = "paused";
        session.paused = true;
        session.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  private read(): SessionRecord[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as { sessions?: SessionRecord[] };
      return Array.isArray(parsed.sessions) ? parsed.sessions : [];
    } catch {
      return [];
    }
  }

  private flush(): void {
    const done = this.sessions.filter((session) => ["completed", "rejected", "cancelled", "failed"].includes(session.status));
    const active = this.sessions.filter((session) => !done.includes(session));
    this.sessions = [...active, ...done.slice(-100)];
    writeJsonAtomic(this.file, { sessions: this.sessions });
  }

  private touch(session: SessionRecord, status?: SendTransferStatus): void {
    if (status) session.status = status;
    session.updatedAt = new Date().toISOString();
    this.flush();
  }

  list(): SessionRecord[] {
    return this.sessions;
  }

  get(id: string): SessionRecord | undefined {
    return this.sessions.find((session) => session.transferId === id);
  }

  toDto(session: SessionRecord): SendTransfer {
    const transferredBytes = session.files.reduce((sum, file) => sum + file.receivedBytes, 0);
    const now = Date.now();
    const samples = [...(this.speeds.get(session.transferId) ?? []), { at: now, bytes: transferredBytes }].filter((sample) => now - sample.at <= 2000);
    this.speeds.set(session.transferId, samples);
    const first = samples[0];
    const last = samples[samples.length - 1];
    const bytesPerSecond = first && last && last.at !== first.at ? Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.at - first.at)) : 0;
    return {
      transferId: session.transferId,
      sourceDeviceId: session.sourceDeviceId,
      targetDeviceId: session.targetDeviceId,
      direction: session.direction,
      status: session.status,
      files: session.files.map((file, index) => ({ index, ...file })),
      totalBytes: session.files.reduce((sum, file) => sum + file.size, 0),
      transferredBytes,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      peerName: session.peerName,
      error: session.error,
      bytesPerSecond,
      channel: session.channel
    };
  }

  createIncoming(input: {
    transferId: string;
    sourceDeviceId: string;
    targetDeviceId: string;
    peerName: string;
    channel: "orion" | "localsend";
    files: Array<{ relativePath: string; size: number; sha256: string }>;
    fileTokens?: string[];
  }): SessionRecord {
    const existing = this.get(input.transferId);
    if (existing) {
      const same =
        existing.files.length === input.files.length &&
        existing.files.every((file, index) => file.sha256 === input.files[index]?.sha256 && file.size === input.files[index]?.size);
      if (!same) throw new SendFailure(409, "transfer_conflict", "Передача с таким идентификатором уже есть и отличается");
      return existing;
    }
    const files: SessionFile[] = [];
    const used = new Set<string>();
    for (const file of input.files) {
      const relativePath = safeRelativePath(file.relativePath);
      if (!relativePath || used.has(relativePath)) throw new SendFailure(400, "path_rejected", "Имя файла отклонено");
      used.add(relativePath);
      files.push({ relativePath, size: file.size, sha256: file.sha256, receivedBytes: 0, state: "pending" });
    }
    const now = new Date().toISOString();
    const session: SessionRecord = {
      transferId: input.transferId,
      direction: "incoming",
      channel: input.channel,
      sourceDeviceId: input.sourceDeviceId,
      targetDeviceId: input.targetDeviceId,
      peerName: input.peerName,
      status: "pending",
      files,
      saveDir: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      paused: false,
      sources: [],
      fileTokens: input.fileTokens ?? []
    };
    this.sessions.push(session);
    this.flush();
    return session;
  }

  createOutgoing(input: {
    transferId?: string;
    sourceDeviceId: string;
    targetDeviceId: string;
    peerName: string;
    channel?: "orion" | "localsend";
    files: SessionFile[];
    sources: string[];
  }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      transferId: input.transferId ?? randomUUID(),
      direction: "outgoing",
      channel: input.channel ?? "orion",
      sourceDeviceId: input.sourceDeviceId,
      targetDeviceId: input.targetDeviceId,
      peerName: input.peerName,
      status: "pending",
      files: input.files,
      saveDir: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      paused: false,
      sources: input.sources,
      fileTokens: []
    };
    this.sessions.push(session);
    this.flush();
    return session;
  }

  async accept(id: string, directory: string): Promise<SessionRecord> {
    const session = this.requireIncoming(id);
    if (session.status !== "pending") throw new SendFailure(409, "not_pending", "Передача уже решена");
    if (!path.isAbsolute(directory)) throw new SendFailure(400, "bad_directory", "Нужен полный путь к папке");
    const stat = await fs.promises.lstat(directory).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new SendFailure(400, "bad_directory", "Папка для сохранения недоступна");
    const root = await fs.promises.realpath(directory);
    const total = session.files.reduce((sum, file) => sum + file.size, 0);
    const free = await this.freeBytes(root);
    if (free !== null && free < total + 16 * 1024 * 1024) throw new SendFailure(507, "no_space", "Недостаточно места на диске");
    await fs.promises.mkdir(path.join(root, ".orion-partial", session.transferId), { recursive: true });
    session.saveDir = root;
    session.paused = false;
    this.touch(session, "accepted");
    return session;
  }

  reject(id: string): SessionRecord {
    const session = this.requireIncoming(id);
    if (session.status !== "pending") throw new SendFailure(409, "not_pending", "Передача уже решена");
    this.touch(session, "rejected");
    return session;
  }

  pause(id: string): SessionRecord {
    const session = this.must(id);
    if (["completed", "rejected", "cancelled", "failed"].includes(session.status)) throw new SendFailure(409, "finished", "Передача уже завершена");
    session.paused = true;
    this.touch(session, "paused");
    return session;
  }

  resume(id: string): SessionRecord {
    const session = this.must(id);
    if (!session.paused && session.status !== "paused" && session.status !== "failed") throw new SendFailure(409, "not_paused", "Передача не на паузе");
    session.paused = false;
    session.error = null;
    const started = session.files.some((file) => file.receivedBytes > 0);
    const next = session.direction === "incoming" && session.saveDir ? (started ? "transferring" : "accepted") : started ? "transferring" : "pending";
    this.touch(session, next);
    return session;
  }

  async cancel(id: string): Promise<SessionRecord> {
    const session = this.must(id);
    await this.removePartial(session);
    this.touch(session, "cancelled");
    return session;
  }

  mark(id: string, status: SendTransferStatus, error: string | null = null): SessionRecord {
    const session = this.must(id);
    session.error = error;
    if (status === "paused") session.paused = true;
    this.touch(session, status);
    return session;
  }

  noteOutgoing(id: string, index: number, receivedBytes: number): void {
    const session = this.get(id);
    const file = session?.files[index];
    if (!session || !file) return;
    file.receivedBytes = receivedBytes;
    file.state = receivedBytes >= file.size ? "verified" : "transferring";
    if (!session.paused) session.status = "transferring";
    session.updatedAt = new Date().toISOString();
    this.flush();
  }

  partialFile(session: SessionRecord, index: number): string {
    const file = session.files[index];
    if (!file || !session.saveDir) throw new SendFailure(409, "not_accepted", "Получатель ещё не принял передачу");
    const target = inside(path.join(session.saveDir, ".orion-partial", session.transferId), file.relativePath);
    if (!target) throw new SendFailure(400, "path_rejected", "Имя файла отклонено");
    return target;
  }

  async commitChunk(id: string, index: number, offset: number, bytes: Buffer): Promise<number> {
    const session = this.requireWritable(id);
    const file = session.files[index];
    if (!file) throw new SendFailure(404, "no_file", "Файл не входит в передачу");
    if (file.state === "verified") return file.size;
    if (offset > file.receivedBytes || offset + bytes.length > file.size) throw new SendFailure(409, "bad_offset", "Смещение блока не совпало с подтверждённым");
    if (offset + bytes.length <= file.receivedBytes) return file.receivedBytes;
    if (offset < file.receivedBytes) throw new SendFailure(409, "bad_offset", "Повтор блока пересекается с уже записанным");
    const target = this.partialFile(session, index);
    await mkdirNoFollow(path.dirname(target));
    await assertNoSymlink(target);
    const handle = await fs.promises.open(target, "a+");
    try {
      await handle.write(bytes, 0, bytes.length, offset);
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
        session.error = "Недостаточно места на диске";
        this.touch(session, "failed");
      }
      throw error;
    } finally {
      await handle.close();
    }
    file.receivedBytes = offset + bytes.length;
    file.state = "transferring";
    this.touch(session, "transferring");
    return file.receivedBytes;
  }

  async writeStream(id: string, index: number, source: AsyncIterable<Buffer | string>, length: number): Promise<number> {
    const session = this.requireWritable(id);
    const file = session.files[index];
    if (!file) throw new SendFailure(404, "no_file", "Файл не входит в передачу");
    if (length !== file.size || file.receivedBytes !== 0) throw new SendFailure(409, "bad_offset", "Поток не совпал с ожидаемым файлом");
    const target = this.partialFile(session, index);
    await mkdirNoFollow(path.dirname(target));
    await assertNoSymlink(target);
    const handle = await fs.promises.open(target, "w");
    let written = 0;
    try {
      for await (const chunk of source) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (written + bytes.length > length) throw new SendFailure(400, "too_long", "Тело больше объявленного размера");
        if (bytes.length === 0) continue;
        await handle.write(bytes, 0, bytes.length, written);
        written += bytes.length;
      }
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
        session.error = "Недостаточно места на диске";
        this.touch(session, "failed");
      }
      throw error;
    } finally {
      await handle.close();
    }
    if (written !== length) throw new SendFailure(400, "short_body", "Соединение оборвалось до конца файла");
    file.receivedBytes = written;
    file.state = "transferring";
    this.touch(session, "transferring");
    return written;
  }

  async finishFile(id: string, index: number): Promise<SessionRecord> {
    const session = this.requireWritable(id);
    const file = session.files[index];
    if (!file) throw new SendFailure(404, "no_file", "Файл не входит в передачу");
    if (file.receivedBytes !== file.size) throw new SendFailure(409, "incomplete", "Файл получен не полностью");
    this.touch(session, "verifying");
    const partial = this.partialFile(session, index);
    const actual = await hashFile(partial, file.size);
    if (actual !== file.sha256) {
      file.state = "failed";
      file.receivedBytes = 0;
      session.error = "Контрольная сумма не совпала";
      await fs.promises.rm(partial, { force: true });
      this.touch(session, "failed");
      throw new SendFailure(422, "checksum_mismatch", "Контрольная сумма не совпала");
    }
    const destination = uniqueDestination(session.saveDir!, file.relativePath);
    await mkdirNoFollow(path.dirname(destination));
    await fs.promises.rename(partial, destination);
    file.state = "verified";
    if (session.files.every((item) => item.state === "verified")) {
      await this.removePartial(session);
      session.error = null;
      this.touch(session, "completed");
    } else this.touch(session, "transferring");
    return session;
  }

  private must(id: string): SessionRecord {
    const session = this.get(id);
    if (!session) throw new SendFailure(404, "not_found", "Передача не найдена");
    return session;
  }

  private requireIncoming(id: string): SessionRecord {
    const session = this.must(id);
    if (session.direction !== "incoming") throw new SendFailure(404, "not_found", "Входящая передача не найдена");
    return session;
  }

  private requireWritable(id: string): SessionRecord {
    const session = this.requireIncoming(id);
    if (session.paused || session.status === "paused") throw new SendFailure(409, "paused", "Передача на паузе");
    if (["rejected", "cancelled", "failed", "completed"].includes(session.status)) throw new SendFailure(409, "closed", "Передача закрыта");
    if (!session.saveDir || !["accepted", "transferring", "verifying"].includes(session.status)) {
      throw new SendFailure(409, "not_accepted", "Получатель ещё не принял передачу");
    }
    return session;
  }

  private async removePartial(session: SessionRecord): Promise<void> {
    if (!session.saveDir) return;
    await fs.promises.rm(path.join(session.saveDir, ".orion-partial", session.transferId), { recursive: true, force: true });
  }
}

async function defaultFreeBytes(directory: string): Promise<number | null> {
  try {
    const stat = await fs.promises.statfs(directory);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

function inside(root: string, relative: string): string | null {
  const safe = safeRelativePath(relative);
  if (!safe) return null;
  fs.mkdirSync(root, { recursive: true });
  const base = fs.realpathSync(root);
  const target = path.resolve(base, ...safe.split("/"));
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

async function mkdirNoFollow(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await mkdirNoFollow(parent);
  try {
    const stat = await fs.promises.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new SendFailure(400, "path_rejected", "Путь содержит ссылку");
  } catch (error) {
    if (error instanceof SendFailure) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await fs.promises.mkdir(directory);
    } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
    }
  }
}

async function assertNoSymlink(file: string): Promise<void> {
  try {
    const stat = await fs.promises.lstat(file);
    if (stat.isSymbolicLink()) throw new SendFailure(400, "path_rejected", "Файл является ссылкой");
  } catch (error) {
    if (error instanceof SendFailure) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function uniqueDestination(root: string, relative: string): string {
  const safe = safeRelativePath(relative);
  if (!safe) throw new SendFailure(400, "path_rejected", "Имя файла отклонено");
  const parsed = path.posix.parse(safe);
  let name = parsed.base;
  for (let n = 2; ; n += 1) {
    const candidate = inside(root, parsed.dir ? `${parsed.dir}/${name}` : name);
    if (!candidate) throw new SendFailure(400, "path_rejected", "Имя файла отклонено");
    if (!fs.existsSync(candidate)) return candidate;
    name = `${parsed.name} (${n})${parsed.ext}`;
  }
}
