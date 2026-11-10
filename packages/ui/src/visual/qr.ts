/**
 * Byte-mode QR, error correction L, versions 1–5 (до 106 байт UTF-8).
 * Маска и служебные модули по ISO/IEC 18004; уровень L выбран, чтобы
 * короткий адрес локальной сети помещался без нескольких блоков Рида-Соломона.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generator(nsym: number): Uint8Array {
  let poly = Uint8Array.of(1);
  for (let i = 0; i < nsym; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const root = EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

/** Остаток от деления. У правильного кодового слова он нулевой. */
export function rsRemainder(message: Uint8Array, nsym: number): Uint8Array {
  const gen = generator(nsym);
  const res = new Uint8Array(message.length + gen.length - 1);
  res.set(message);
  for (let i = 0; i < message.length; i += 1) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j += 1) res[i + j] ^= mul(gen[j], coef);
  }
  return res.subarray(message.length);
}

interface Version {
  version: number;
  size: number;
  data: number;
  ecc: number;
  align: number[];
}

const VERSIONS: Version[] = [
  { version: 1, size: 21, data: 19, ecc: 7, align: [] },
  { version: 2, size: 25, data: 34, ecc: 10, align: [6, 18] },
  { version: 3, size: 29, data: 55, ecc: 15, align: [6, 22] },
  { version: 4, size: 33, data: 80, ecc: 20, align: [6, 26] },
  { version: 5, size: 37, data: 108, ecc: 26, align: [6, 30] }
];

function payloadCapacity(dataCodewords: number): number {
  return Math.floor((dataCodewords * 8 - 12) / 8);
}

export function buildQrData(payload: Uint8Array, capacity: number): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(payload.length, 8);
  for (const byte of payload) push(byte, 8);
  const capBits = capacity * 8;
  if (bits.length > capBits) throw new Error("qr_too_long");
  const term = Math.min(4, capBits - bits.length);
  for (let i = 0; i < term; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out = new Uint8Array(capacity);
  const full = bits.length / 8;
  for (let i = 0; i < full; i += 1) {
    let value = 0;
    for (let b = 0; b < 8; b += 1) value = (value << 1) | bits[i * 8 + b];
    out[i] = value;
  }
  for (let i = full; i < capacity; i += 1) out[i] = (i - full) % 2 === 0 ? 0xec : 0x11;
  return out;
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function maskHit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function penalty(modules: boolean[][]): number {
  const n = modules.length;
  let score = 0;
  const run = (dark: boolean, length: number): void => {
    if (length >= 5) score += length - 2;
    void dark;
  };
  for (let y = 0; y < n; y += 1) {
    let length = 1;
    for (let x = 1; x < n; x += 1) {
      if (modules[y][x] === modules[y][x - 1]) length += 1;
      else { run(modules[y][x - 1], length); length = 1; }
    }
    run(modules[y][n - 1], length);
  }
  for (let x = 0; x < n; x += 1) {
    let length = 1;
    for (let y = 1; y < n; y += 1) {
      if (modules[y][x] === modules[y - 1][x]) length += 1;
      else { run(modules[y - 1][x], length); length = 1; }
    }
    run(modules[n - 1][x], length);
  }
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  score += Math.floor(Math.abs(dark / (n * n) - 0.5) * 20) * 10;
  return score;
}

function blank(size: number): { modules: boolean[][]; fn: boolean[][] } {
  return {
    modules: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    fn: Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  };
}

function setFn(grid: { modules: boolean[][]; fn: boolean[][] }, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || y >= grid.modules.length || x >= grid.modules.length) return;
  grid.modules[y][x] = dark;
  grid.fn[y][x] = true;
}

function drawFinder(grid: { modules: boolean[][]; fn: boolean[][] }, ox: number, oy: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      setFn(grid, ox + dx, oy + dy, inside && (edge || core));
    }
  }
}

function drawAlignment(grid: { modules: boolean[][]; fn: boolean[][] }, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFn(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function reserveFormat(grid: { modules: boolean[][]; fn: boolean[][] }): void {
  const n = grid.modules.length;
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) { setFn(grid, 8, i, false); setFn(grid, i, 8, false); }
  }
  for (let i = 0; i < 8; i += 1) {
    setFn(grid, n - 1 - i, 8, false);
    setFn(grid, 8, n - 1 - i, false);
  }
}

function drawFormat(grid: { modules: boolean[][]; fn: boolean[][] }, mask: number): void {
  const n = grid.modules.length;
  const bits = formatBits(mask);
  const bit = (i: number): boolean => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) setFn(grid, 8, i, bit(i));
  setFn(grid, 8, 7, bit(6));
  setFn(grid, 8, 8, bit(7));
  setFn(grid, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFn(grid, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFn(grid, n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFn(grid, 8, n - 15 + i, bit(i));
  setFn(grid, 8, n - 8, true);
}

function placeData(grid: { modules: boolean[][]; fn: boolean[][] }, bytes: Uint8Array): void {
  const bits: boolean[] = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i -= 1) bits.push(((byte >> i) & 1) === 1);
  const n = grid.modules.length;
  let index = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (grid.fn[y][x]) continue;
        grid.modules[y][x] = index < bits.length ? bits[index] : false;
        index += 1;
      }
    }
  }
}

function applyMask(grid: { modules: boolean[][]; fn: boolean[][] }, mask: number): boolean[][] {
  return grid.modules.map((row, y) => row.map((cell, x) => (grid.fn[y][x] ? cell : cell !== maskHit(mask, x, y))));
}

/** Тёмные модули, без тихой зоны. Пустая строка — версия 1. Длиннее 106 байт — ошибка. */
export function encodeQr(text: string): boolean[][] {
  const payload = new TextEncoder().encode(text);
  const version = VERSIONS.find((item) => payload.length <= payloadCapacity(item.data));
  if (!version) throw new Error("qr_too_long");
  const data = buildQrData(payload, version.data);
  const ecc = rsRemainder(data, version.ecc);
  const codewords = new Uint8Array(data.length + ecc.length);
  codewords.set(data);
  codewords.set(ecc, data.length);

  const grid = blank(version.size);
  const n = version.size;
  drawFinder(grid, 0, 0);
  drawFinder(grid, n - 7, 0);
  drawFinder(grid, 0, n - 7);
  for (const cy of version.align) {
    for (const cx of version.align) {
      if (grid.fn[cy][cx]) continue;
      drawAlignment(grid, cx, cy);
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (!grid.fn[6][i]) setFn(grid, i, 6, i % 2 === 0);
    if (!grid.fn[i][6]) setFn(grid, 6, i, i % 2 === 0);
  }
  setFn(grid, 8, version.version * 4 + 9, true);
  reserveFormat(grid);
  placeData(grid, codewords);

  let best = applyMask(grid, 0);
  let bestScore = penalty(best);
  let bestMask = 0;
  for (let mask = 1; mask < 8; mask += 1) {
    const candidate = applyMask(grid, mask);
    const score = penalty(candidate);
    if (score < bestScore) { best = candidate; bestScore = score; bestMask = mask; }
  }
  grid.modules = best;
  drawFormat(grid, bestMask);
  return grid.modules;
}
