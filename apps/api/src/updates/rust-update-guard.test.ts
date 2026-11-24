import { describe, expect, it } from "vitest";
import { rustReleaseRefusal } from "./rust-update-guard";

const rust = {
  edition: "rust",
  repo: "KeinReno/ORION-Rust",
  channel: "KeinReno/ORION-Rust",
  tag: "v0.1.0-orion-rust-beta.1",
  assetName: "ORION-Rust_0.1.0_x64-setup.exe",
  notes: "Сборка com.orion.rust.desktop",
  sha256: "a".repeat(64)
};

describe("rust update guard", () => {
  it("не мешает обычной сборке", () => {
    expect(rustReleaseRefusal({ ...rust, edition: undefined, repo: "KeinReno/ORION" })).toBeNull();
  });

  it("разрешает Rust namespace в том же приватном репозитории и отклоняет classic tags", () => {
    expect(rustReleaseRefusal({ ...rust, repo: "KeinReno/ORION", channel: "KeinReno/ORION" })).toBeNull();
    expect(rustReleaseRefusal({ ...rust, repo: "KeinReno/ORION", channel: "KeinReno/ORION", tag: "v0.1.0-windows-beta.3" })).toMatch(/метка релиза/i);
    expect(rustReleaseRefusal({ ...rust, repo: "keinreno/orion", channel: "KeinReno/ORION" })).toMatch(/разрешённого канала/);
  });

  it("не принимает другой репозиторий вне разрешённого канала", () => {
    expect(rustReleaseRefusal({ ...rust, channel: "", repo: "someone/fork" })).toMatch(/разрешённого канала/);
    expect(rustReleaseRefusal({ ...rust, channel: "KeinReno/ORION-Rust", repo: "someone/fork" })).toMatch(/разрешённого канала/);
  });

  it("требует имя установщика, идентификатор редакции и контрольную сумму", () => {
    expect(rustReleaseRefusal({ ...rust, assetName: "ORION_0.1.0_x64-setup.exe" })).toMatch(/не принадлежит/);
    expect(rustReleaseRefusal({ ...rust, notes: "без идентификатора" })).toMatch(/идентификатора/);
    expect(rustReleaseRefusal({ ...rust, sha256: null })).toMatch(/SHA-256/);
    expect(rustReleaseRefusal({ ...rust, tag: "v0.1.0-windows-beta.3" })).toMatch(/метка релиза/i);
    expect(rustReleaseRefusal(rust)).toBeNull();
  });

  it("принимает чистые метки 0.2.x и ассеты с точкой в имени", () => {
    expect(rustReleaseRefusal({ ...rust, tag: "v0.2.1", assetName: "ORION.Rust_0.2.1_x64-setup.exe" })).toBeNull();
    expect(rustReleaseRefusal({ ...rust, tag: "v0.2.1" })).toBeNull();
  });
});
