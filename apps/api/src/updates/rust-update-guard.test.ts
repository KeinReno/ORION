import { describe, expect, it } from "vitest";
import { rustReleaseRefusal } from "./rust-update-guard";

const rust = {
  edition: "rust",
  repo: "KeinReno/ORION-Rust",
  channel: "KeinReno/ORION-Rust",
  assetName: "ORION-Rust_0.1.0_x64-setup.exe",
  notes: "Сборка com.orion.rust.desktop",
  sha256: "a".repeat(64)
};

describe("rust update guard", () => {
  it("не мешает обычной сборке", () => {
    expect(rustReleaseRefusal({ ...rust, edition: undefined, repo: "KeinReno/ORION" })).toBeNull();
  });

  it("закрывает канал классической беты", () => {
    expect(rustReleaseRefusal({ ...rust, repo: "KeinReno/ORION" })).toMatch(/классической беты/);
    expect(rustReleaseRefusal({ ...rust, repo: "keinreno/orion" })).toMatch(/классической беты/);
  });

  it("не принимает другой репозиторий, пока свой канал не задан", () => {
    expect(rustReleaseRefusal({ ...rust, channel: "", repo: "someone/fork" })).toMatch(/свой канал/);
    expect(rustReleaseRefusal({ ...rust, channel: "KeinReno/ORION-Rust", repo: "someone/fork" })).toMatch(/свой канал/);
  });

  it("требует имя установщика, идентификатор редакции и контрольную сумму", () => {
    expect(rustReleaseRefusal({ ...rust, assetName: "ORION_0.1.0_x64-setup.exe" })).toMatch(/не принадлежит/);
    expect(rustReleaseRefusal({ ...rust, notes: "без идентификатора" })).toMatch(/идентификатора/);
    expect(rustReleaseRefusal({ ...rust, sha256: null })).toMatch(/SHA-256/);
    expect(rustReleaseRefusal(rust)).toBeNull();
  });
});
