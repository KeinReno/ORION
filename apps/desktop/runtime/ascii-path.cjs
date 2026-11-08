/* eslint-disable @typescript-eslint/no-require-imports */
// Пути только из ASCII для встроенного PostgreSQL (initdb/postgres).
//
// На Windows с кириллическим именем пользователя (`C:\Users\Варвара\…`) `initdb` падает: путь передаётся в кодировке
// ANSI (cp1251), а кластер создаётся в UTF-8, и начальная загрузка завершается `invalid byte sequence for encoding "UTF8"`.
// Падает и каталог данных, и каталог самих бинарников PostgreSQL (проверено воспроизведением: достаточно любого из двух).
// Поэтому оба должны лежать по ASCII-пути; если обычный путь не ASCII, берём запасной в `%ProgramData%\ORION-Rust`.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const isAsciiPath = value => /^[\x20-\x7E]*$/.test(String(value));

function programDataRoot(env = process.env) {
  return path.join(env.ProgramData || 'C:/ProgramData', 'ORION-Rust');
}

/** Короткий ASCII-идентификатор пользователя (хеш имени), чтобы у каждого пользователя Windows был свой каталог. */
function userTag(env = process.env, os = require('node:os')) {
  const who = `${env.USERDOMAIN || ''}/${env.USERNAME || os.userInfo().username}`;
  return createHash('sha256').update(who.toLowerCase()).digest('hex').slice(0, 10);
}

/** Каталог данных: запрошенный, если он ASCII, иначе запасной на пользователя. */
function effectiveDataDir(requested, env = process.env) {
  if (isAsciiPath(requested)) return requested;
  return path.join(programDataRoot(env), `data-${userTag(env)}`);
}

/** Каталог бинарников PostgreSQL: исходный, если он ASCII, иначе копия в запасном месте (нужна версия, чтобы обновить копию). */
function effectivePgDir(pgDir, version, env = process.env) {
  if (isAsciiPath(pgDir)) return { dir: pgDir, copy: false };
  return { dir: path.join(programDataRoot(env), `pg-${String(version).replace(/[^0-9A-Za-z._-]/g, '_')}`), copy: true };
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform !== 'win32') return;
  try {
    // Каталог создаёт текущий пользователь: оставляем доступ только ему (по SID — в имени может быть кириллица).
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim().split(',')[1]?.replace(/"/g, '');
    if (sid) execFileSync('icacls', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'ignore' });
  } catch { /* без ACL остаётся наследуемый доступ ProgramData: не фатально */ }
}

/** Копирует каталог бинарников один раз на версию; готовность отмечает файлом-маркером. */
function mirrorPgDir(source, target, version) {
  const marker = path.join(target, '.orion-pg-copy');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === String(version)) return target;
  fs.rmSync(target, { recursive: true, force: true });
  ensurePrivateDir(path.dirname(target));
  fs.cpSync(source, target, { recursive: true });
  fs.writeFileSync(marker, String(version));
  return target;
}

module.exports = { isAsciiPath, programDataRoot, userTag, effectiveDataDir, effectivePgDir, ensurePrivateDir, mirrorPgDir };
