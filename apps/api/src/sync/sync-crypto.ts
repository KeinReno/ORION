import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from "node:crypto";

/**
 * Симметричная крипта модуля синхронизации. Два применения:
 *
 *  1. `sealSecret` / `openSecret` — завернуть пароль WebDAV перед записью в
 *     `SyncRemote.passwordEnc` (аналог того, как Remotely Save обфусцирует
 *     `data.json`, только это честный AES-GCM, а не reverse-base64).
 *  2. `encryptSnapshot` / `decryptSnapshot` — тело снапшота бэкапа перед
 *     `PUT` в облако.
 *
 * Ключ берётся из `SYNC_SECRET` (32 байта в base64) в `.env`. Если его нет —
 * модуль обязан отказаться сохранять удалёнку, а НЕ писать пароль
 * открытым текстом (см. `docs/SYNC.md` §12).
 *
 * Формат контейнера (и для secret, и для snapshot):
 *   magic("ORNC1") | salt(16) | iv(12) | tag(16) | ciphertext
 * всё вместе — один Buffer; для БД он кодируется в base64.
 */

const MAGIC = Buffer.from("ORNC1");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";

export class SyncSecretMissingError extends Error {
  constructor() {
    super(
      "SYNC_SECRET не задан в .env — модуль синхронизации не может " +
        "зашифровать пароль удалёнки. Сгенерируйте 32 байта: " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`"
    );
    this.name = "SyncSecretMissingError";
  }
}

function rootKey(): Buffer {
  const raw = process.env.SYNC_SECRET?.trim();
  if (!raw) throw new SyncSecretMissingError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SYNC_SECRET должен декодироваться из base64 ровно в 32 байта");
  }
  return key;
}

/** scrypt(rootKey ‖ passphrase, salt) → 32 байта. passphrase пуст для secret-режима. */
function deriveKey(salt: Buffer, passphrase = ""): Buffer {
  const material = Buffer.concat([rootKey(), Buffer.from(passphrase, "utf8")]);
  return scryptSync(material, salt, 32);
}

function encrypt(plain: Buffer, passphrase = ""): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(salt, passphrase);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, body]);
}

function decrypt(container: Buffer, passphrase = ""): Buffer {
  const magic = container.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error("Не похоже на контейнер ORION (неверная сигнатура) — файл повреждён или чужой");
  }
  let off = MAGIC.length;
  const salt = container.subarray(off, (off += SALT_LEN));
  const iv = container.subarray(off, (off += IV_LEN));
  const tag = container.subarray(off, (off += TAG_LEN));
  const body = container.subarray(off);
  const key = deriveKey(salt, passphrase);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** Пароль/секрет → строка для БД (base64 контейнера). */
export function sealSecret(plaintext: string): string {
  return encrypt(Buffer.from(plaintext, "utf8")).toString("base64");
}

/** Обратно: строка из БД → пароль/секрет. */
export function openSecret(sealed: string): string {
  return decrypt(Buffer.from(sealed, "base64")).toString("utf8");
}

/** True, если `SYNC_SECRET` присутствует и валиден — для дружелюбной 400 вместо 500. */
export function syncSecretAvailable(): boolean {
  try {
    rootKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Тело снапшота → зашифрованный Buffer для `PUT` в облако.
 * `passphrase` пуст в Стадии 1 (одна нода, тот же `SYNC_SECRET` и
 * восстанавливает). В Стадии 3 сюда придёт ключ шары.
 */
export function encryptSnapshot(plain: Buffer, passphrase = ""): Buffer {
  return encrypt(plain, passphrase);
}

export function decryptSnapshot(container: Buffer, passphrase = ""): Buffer {
  return decrypt(container, passphrase);
}
