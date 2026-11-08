import { describe, expect, it } from "vitest";
import { compareTags, extractSha256, parseTag, pickInstallerAsset, pickLatestRelease, type GithubRelease } from "./release-feed";

const release = (tag: string, over: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  name: tag,
  body: "",
  draft: false,
  prerelease: true,
  published_at: "2026-10-19T00:00:00Z",
  assets: [{ id: 1, name: "ORION_0.1.0_x64-setup.exe", size: 100 }],
  ...over
});

describe("метки релизов", () => {
  it("разбирает беты и чистые версии, отвергает мусор", () => {
    expect(parseTag("v0.1.0-windows-beta.3")).toEqual({ core: [0, 1, 0], beta: 3 });
    expect(parseTag("v1.2.3")?.beta).toBe(Number.POSITIVE_INFINITY);
    expect(parseTag("beta.3")).toBeNull();
    expect(parseTag("v0.1.0-rc.1")).toBeNull();
  });

  it("сравнивает: бета 10 новее беты 2, чистая версия новее беты, большая версия новее всего", () => {
    expect(compareTags("v0.1.0-windows-beta.10", "v0.1.0-windows-beta.2")).toBeGreaterThan(0);
    expect(compareTags("v0.1.0", "v0.1.0-windows-beta.9")).toBeGreaterThan(0);
    expect(compareTags("v0.2.0-windows-beta.1", "v0.1.9")).toBeGreaterThan(0);
    expect(compareTags("v0.1.0-windows-beta.2", "v0.1.0-windows-beta.2")).toBe(0);
    expect(compareTags("мусор", "v0.0.1")).toBeLessThan(0);
  });
});

describe("выбор релиза", () => {
  it("берёт самый новый, пропускает черновики и релизы без установщика", () => {
    const latest = pickLatestRelease([
      release("v0.1.0-windows-beta.1"),
      release("v0.1.0-windows-beta.3", { draft: true }),
      release("v0.1.0-windows-beta.2"),
      release("v0.1.0-windows-beta.4", { assets: [] })
    ]);
    expect(latest?.tag_name).toBe("v0.1.0-windows-beta.2");
  });

  it("без разрешения на беты — только обычные релизы", () => {
    expect(pickLatestRelease([release("v0.1.0-windows-beta.5")], false)).toBeNull();
    expect(pickLatestRelease([release("v0.2.0", { prerelease: false })], false)?.tag_name).toBe("v0.2.0");
  });

  it("Stable никогда не выбирает beta-tag, даже если он ошибочно опубликован не как prerelease", () => {
    const stable = release("v0.1.0", { prerelease: false });
    const mislabeled = release("v0.2.0-windows-beta.100", { prerelease: false });
    expect(pickLatestRelease([mislabeled, stable], false)?.tag_name).toBe("v0.1.0");
    expect(pickLatestRelease([mislabeled, stable], true)?.tag_name).toBe("v0.2.0-windows-beta.100");
  });

  it("находит установщик по имени", () => {
    expect(pickInstallerAsset(release("v0.1.0"))?.name).toBe("ORION_0.1.0_x64-setup.exe");
    expect(pickInstallerAsset({ assets: [{ id: 2, name: "notes.txt", size: 1 }] })).toBeNull();
  });
});

describe("контрольная сумма из описания", () => {
  const hash = "a".repeat(64);

  it("находит сумму в обычном виде записи", () => {
    expect(extractSha256(`...\nSHA-256 установщика: \`${hash}\`\n`)).toBe(hash);
    expect(extractSha256(`sha256: ${hash.toUpperCase()}`)).toBe(hash);
  });

  it("не принимает короткие, длинные и отсутствующие значения", () => {
    expect(extractSha256("SHA-256: abc")).toBeNull();
    expect(extractSha256(null)).toBeNull();
    expect(extractSha256(`SHA-256: ${"a".repeat(70)}`)).toBeNull();
  });
});
