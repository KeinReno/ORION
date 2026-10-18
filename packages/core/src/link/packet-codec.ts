import { z } from "zod";

/**
 * ADR-0020 §4–5: пакет Orion Link. Формат файла:
 *   "ORLK1" | headerLen(u32 BE) | header(JSON, открыт) | iv(12) | AES-256-GCM(body, тег в конце)
 * Заголовок — AAD шифрования: подмена workspace/epoch/seq/kind ломает тег. Провайдер видит только заголовок.
 */
export const LINK_VERSION = 1;
const MAGIC = new TextEncoder().encode("ORLK1");
const IV_LEN = 12;

export const packetHeaderSchema = z.object({
  linkVersion: z.number().int(),
  protocolVersion: z.number().int(),
  workspaceId: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  sourceDeviceId: z.string().min(1),
  kind: z.enum(["request", "response"]),
  /** Номер запроса устройства; ответ несёт тот же номер. */
  seq: z.number().int().nonnegative(),
  keyId: z.string().min(1),
  createdAt: z.string()
});
export type PacketHeader = z.infer<typeof packetHeaderSchema>;

export type PacketErrorCode = "malformed" | "corrupt" | "wrong_context" | "unsupported_version" | "unknown_key";

export class PacketError extends Error {
  constructor(
    readonly code: PacketErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PacketError";
  }
}

export interface LinkKey {
  keyId: string;
  /** 32 случайных байта (`K_ws`). Не `SYNC_SECRET` и не пароль провайдера. */
  raw: Uint8Array;
}

export interface PacketContext {
  workspaceId: string;
  epoch: number;
  keys: LinkKey[];
}

// Типы выведены из globalThis.crypto: файл компилируется и с DOM (веб), и без него (apps/api на @types/node).
type Subtle = typeof globalThis.crypto.subtle;
type BufferLike = Parameters<Subtle["digest"]>[1];
type AesKey = Awaited<ReturnType<Subtle["importKey"]>>;

const subtle = (): Subtle => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto недоступен");
  return s;
};

const buf = (u: Uint8Array): BufferLike => u as unknown as BufferLike;

async function importKey(key: LinkKey): Promise<AesKey> {
  if (key.raw.length !== 32) throw new PacketError("unknown_key", "Ключ Link должен быть 32 байта");
  return subtle().importKey("raw", buf(key.raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const headerBytes = (header: PacketHeader): Uint8Array => new TextEncoder().encode(JSON.stringify(header));

export function generateLinkKey(keyId: string): LinkKey {
  return { keyId, raw: globalThis.crypto.getRandomValues(new Uint8Array(32)) };
}

export async function encryptPacket(header: PacketHeader, body: unknown, key: LinkKey): Promise<Uint8Array> {
  const head = headerBytes(header);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const plain = new TextEncoder().encode(JSON.stringify(body));
  const cipher = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: buf(iv), additionalData: buf(head) }, await importKey(key), buf(plain))
  );
  const out = new Uint8Array(MAGIC.length + 4 + head.length + IV_LEN + cipher.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, head.length);
  out.set(head, MAGIC.length + 4);
  out.set(iv, MAGIC.length + 4 + head.length);
  out.set(cipher, MAGIC.length + 4 + head.length + IV_LEN);
  return out;
}

/** Читает открытый заголовок без расшифровки (чтобы выбрать ключ и проверить контекст). */
export function readPacketHeader(bytes: Uint8Array): { header: PacketHeader; head: Uint8Array; rest: Uint8Array } {
  if (bytes.length < MAGIC.length + 4 + IV_LEN || !MAGIC.every((b, i) => bytes[i] === b)) {
    throw new PacketError("malformed", "Не пакет Orion Link или файл усечён");
  }
  const headLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length);
  const start = MAGIC.length + 4;
  if (headLen > 4096 || bytes.length < start + headLen + IV_LEN + 16) {
    throw new PacketError("malformed", "Пакет усечён или повреждён");
  }
  const head = bytes.subarray(start, start + headLen);
  let header: PacketHeader;
  try {
    header = packetHeaderSchema.parse(JSON.parse(new TextDecoder().decode(head)));
  } catch {
    throw new PacketError("malformed", "Заголовок пакета не разобран");
  }
  return { header, head, rest: bytes.subarray(start + headLen) };
}

export async function decryptPacket<T = unknown>(
  bytes: Uint8Array,
  context: PacketContext
): Promise<{ header: PacketHeader; body: T }> {
  const { header, head, rest } = readPacketHeader(bytes);
  if (header.linkVersion !== LINK_VERSION) {
    throw new PacketError("unsupported_version", `Версия Link ${header.linkVersion} не поддерживается`);
  }
  if (header.workspaceId !== context.workspaceId || header.epoch !== context.epoch) {
    throw new PacketError("wrong_context", "Пакет другого пространства или эпохи");
  }
  const key = context.keys.find((k) => k.keyId === header.keyId);
  if (!key) throw new PacketError("unknown_key", "Нет ключа для этого пакета");
  const iv = rest.subarray(0, IV_LEN);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: "AES-GCM", iv: buf(iv), additionalData: buf(head) },
      await importKey(key),
      buf(rest.subarray(IV_LEN))
    );
  } catch {
    throw new PacketError("corrupt", "Пакет не прошёл проверку целостности");
  }
  try {
    return { header, body: JSON.parse(new TextDecoder().decode(plain)) as T };
  } catch {
    throw new PacketError("malformed", "Тело пакета не JSON");
  }
}
