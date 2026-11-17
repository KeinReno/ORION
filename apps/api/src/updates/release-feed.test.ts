import { describe, expect, it } from "vitest";
import { compareRustTags, compareTags, extractSha256, parseRustTag, parseTag, pickInstallerAsset, pickLatestRelease, pickLatestRustRelease, pickRustInstallerAsset, type GithubRelease } from "./release-feed";

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

const rustRelease = (tag: string, over: Partial<GithubRelease> = {}): GithubRelease => ({
  ...release(tag, {
    body: `Product: com.orion.rust.desktop\nSHA-256 установщика: \`${"a".repeat(64)}\``,
    assets: [{ id: 2, name: "ORION-Rust_0.1.45-beta.2-x64-setup.exe", size: 100 }]
  }),
  ...over
});

describe("метки релизов", () => {
  it("разбирает беты и чистые версии, отвергает мусор", () => {
    expect(parseTag("v0.1.0-windows-beta.3")).toEqual({ core: [0, 1, 0], beta: 3 });
    expect(parseTag("v1.2.3")?.beta).toBe(Number.POSITIVE_INFINITY);
    expect(parseTag("beta.3")).toBeNull();
    expect(parseTag("v0.1.0-rc.1")).toBeNull();
  });

  it("распознаёт только отдельный namespace меток ORION Rust", () => {
    expect(parseRustTag("v0.1.0-orion-rust-beta.2")).toEqual({ core: [0, 1, 0], beta: 2 });
    expect(parseRustTag("v0.1.0-windows-beta.3")).toBeNull();
    expect(parseRustTag("v0.1.0-orion-rust-beta.2-extra")).toBeNull();
    expect(compareRustTags("v0.1.0-orion-rust-beta.10", "v0.1.0-orion-rust-beta.2")).toBeGreaterThan(0);
  });

  it("принимает чистые Rust-метки 0.2.x и считает их новее бет той же версии", () => {
    expect(parseRustTag("v0.2.1")).toEqual({ core: [0, 2, 1], beta: Number.POSITIVE_INFINITY });
    expect(parseRustTag("v0.2.1-rc.1")).toBeNull();
    expect(compareRustTags("v0.2.1", "v0.2.1-orion-rust-beta.5")).toBeGreaterThan(0);
    expect(compareRustTags("v0.2.1", "v0.2.1")).toBe(0);
    expect(compareRustTags("v0.2.1-orion-rust-beta.1", "v0.2.1")).toBeLessThan(0);
    expect(compareRustTags("v0.2.2-orion-rust-beta.1", "v0.2.1")).toBeGreaterThan(0);
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

  it("выбирает только новый Rust релиз с Rust установщиком, product ID и SHA-256", () => {
    const chosen = pickLatestRustRelease([
      release("v0.2.0-windows-beta.1"),
      rustRelease("v0.1.0-orion-rust-beta.9", { body: "нет product id" }),
      rustRelease("v0.1.0-orion-rust-beta.8", { assets: [{ id: 3, name: "ORION_0.1.0_x64-setup.exe", size: 100 }] }),
      rustRelease("v0.1.0-orion-rust-beta.7", { body: "com.orion.rust.desktop, сумма отсутствует" }),
      rustRelease("v0.1.0-orion-rust-beta.2"),
      rustRelease("v0.1.0-orion-rust-beta.10"),
      rustRelease("v0.1.0-orion-rust-beta.11", { draft: true })
    ]);
    expect(chosen?.tag_name).toBe("v0.1.0-orion-rust-beta.10");
  });

  it("принимает реальную форму релиза 0.2.x: чистая метка, ассет с точкой и описание с checksum", () => {
    const chosen = pickLatestRustRelease([
      rustRelease("v0.2.1", {
        assets: [{ id: 5, name: "ORION.Rust_0.2.1_x64-setup.exe", size: 100240659 }]
      }),
      rustRelease("v0.2.0", {
        assets: [{ id: 6, name: "ORION-Rust_0.2.0_x64-setup.exe", size: 100 }]
      })
    ]);
    expect(chosen?.tag_name).toBe("v0.2.1");
    expect(chosen && pickRustInstallerAsset(chosen)?.name).toBe("ORION.Rust_0.2.1_x64-setup.exe");
  });

  it("чистая метка без описания (product id / SHA-256) не выбирается — fail-closed", () => {
    expect(
      pickLatestRustRelease([
        rustRelease("v0.2.1", { body: null }),
        rustRelease("v0.2.1", { body: "" })
      ])
    ).toBeNull();
  });

  it("без разрешения на беты — только обычные релизы", () => {
    expect(pickLatestRelease([release("v0.1.0-windows-beta.5")], false)).toBeNull();
    expect(pickLatestRelease([release("v0.2.0", { prerelease: false })], false)?.tag_name).toBe("v0.2.0");
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
