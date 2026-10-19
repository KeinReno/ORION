/**
 * Чистая логика выбора релиза: разбор меток, сравнение, поиск установщика и контрольной суммы в описании.
 * Метка релиза — `v<мажор>.<минор>.<патч>-windows-beta.<n>` (например `v0.1.0-windows-beta.3`) или `v<мажор>.<минор>.<патч>`.
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

/** Самый новый опубликованный релиз с разбираемой меткой и установщиком; черновики пропускаются. */
export function pickLatestRelease(releases: readonly GithubRelease[], allowPrerelease = true): GithubRelease | null {
  const usable = releases.filter((r) => !r.draft && (allowPrerelease || !r.prerelease) && parseTag(r.tag_name) && pickInstallerAsset(r));
  usable.sort((a, b) => compareTags(b.tag_name, a.tag_name));
  return usable[0] ?? null;
}

/** SHA-256 установщика из описания релиза: строка вида «SHA-256 установщика: `<64 hex>`». */
export function extractSha256(body: string | null | undefined): string | null {
  const match = /sha-?256[^\n`0-9a-f]*[`\s:]*([0-9a-f]{64})(?![0-9a-f])/i.exec(body ?? "");
  return match ? match[1]!.toLowerCase() : null;
}
