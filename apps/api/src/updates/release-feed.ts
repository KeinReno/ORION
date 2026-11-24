/**
 * Чистая логика выбора релиза: разбор меток, сравнение, поиск установщика и контрольной суммы в описании.
 * Метка классического релиза — `v<мажор>.<минор>.<патч>-windows-beta.<n>` (например `v0.1.0-windows-beta.3`)
 * или `v<мажор>.<минор>.<патч>`. Метка ORION Rust — `v<мажор>.<минор>.<патч>-orion-rust-beta.<n>`
 * или просто `v<мажор>.<минор>.<патч>` (с 0.2.x Rust-релизы идут с чистыми метками; «чистая» метка
 * новее любой беты той же версии).
 */
export interface ParsedTag {
  core: [number, number, number];
  /** Номер беты; у «чистого» релиза без беты — Infinity (он новее любой беты той же версии). */
  beta: number;
}

export function parseTag(tag: string): ParsedTag | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-windows-beta\.(\d+))?$/.exec(tag.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], beta: match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4]) };
}

/** Rust builds share the private GitHub repository, so they use a disjoint tag namespace. */
export function parseRustTag(tag: string): ParsedTag | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-orion-rust-beta\.(\d+))?$/.exec(tag.trim());
  if (!match) return null;
  // Без суффикса-беты — «чистый» релиз: новее любой беты той же версии.
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], beta: match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4]) };
}

/** >0, если `a` новее `b`; метки, которые не разобрать, считаются старше любой разобранной. */
export function compareTags(a: string, b: string): number {
  const left = parseTag(a);
  const right = parseTag(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
  if (left.beta === right.beta) return 0;
  return left.beta > right.beta ? 1 : -1;
}

export function compareRustTags(a: string, b: string): number {
  const left = parseRustTag(a);
  const right = parseRustTag(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
  if (left.beta === right.beta) return 0;
  return left.beta > right.beta ? 1 : -1;
}

export interface GithubAsset {
  id: number;
  name: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GithubAsset[];
}

export function pickInstallerAsset(release: Pick<GithubRelease, "assets">): GithubAsset | null {
  return release.assets.find((asset) => /-setup\.exe$/i.test(asset.name)) ?? null;
}

export function pickRustInstallerAsset(release: Pick<GithubRelease, "assets">): GithubAsset | null {
  // Tauri называет файл по productName («ORION Rust_…»), при публикации ассет
  // переименовывали в «ORION-Rust_…» или «ORION.Rust_…» — принимаем все варианты.
  return release.assets.find((asset) => /^ORION[.-]Rust_.+-setup\.exe$/i.test(asset.name)) ?? null;
}

export function pickPayloadAsset(release: Pick<GithubRelease, "assets">, baseTag?: string): GithubAsset | null {
  if (!baseTag || !parseTag(baseTag)) return null;
  return release.assets.find(asset => asset.name === `ORION_app_${baseTag}.orion.gz`) ?? null;
}

/** Самый новый опубликованный релиз с разбираемой меткой и установщиком; черновики пропускаются. */
export function pickLatestRelease(releases: readonly GithubRelease[], allowPrerelease = true, baseTag?: string): GithubRelease | null {
  const usable = releases.filter((r) => !r.draft && (allowPrerelease || !r.prerelease) && parseTag(r.tag_name) && (pickInstallerAsset(r) || pickPayloadAsset(r, baseTag)));
  usable.sort((a, b) => compareTags(b.tag_name, a.tag_name));
  return usable[0] ?? null;
}

export function pickLatestRustRelease(releases: readonly GithubRelease[]): GithubRelease | null {
  const usable = releases.filter((release) =>
    !release.draft &&
    parseRustTag(release.tag_name) !== null &&
    pickRustInstallerAsset(release) !== null &&
    release.body?.includes("com.orion.rust.desktop") === true &&
    extractSha256(release.body) !== null
  );
  usable.sort((a, b) => compareRustTags(b.tag_name, a.tag_name));
  return usable[0] ?? null;
}

/** SHA-256 установщика из описания релиза: строка вида «SHA-256 установщика: `<64 hex>`». */
export function extractSha256(body: string | null | undefined): string | null {
  const match = /sha-?256[^\n`0-9a-f]*[`\s:]*([0-9a-f]{64})(?![0-9a-f])/i.exec(body ?? "");
  return match ? match[1]!.toLowerCase() : null;
}
