import { describe, expect, it } from "vitest";
import { assertServerConfig, checkServerConfig, describeDbRoleProblems } from "./server-config";

const good = {
  JWT_SECRET: "x".repeat(48),
  APP_DATABASE_URL: "postgresql://orion_app:pw@db:5432/orion",
  DATABASE_URL: "postgresql://orion:pw@db:5432/orion",
  WEB_ORIGIN: "https://orion.example.com",
  PUBLIC_API_URL: "https://api.orion.example.com",
  ORION_TRUSTED_PROXIES: "10.0.0.0/8",
  SYNC_SECRET: Buffer.alloc(32, 7).toString("base64"),
  STORAGE_DIR: "/data/documents"
};

describe("checkServerConfig", () => {
  it("accepts a complete HTTPS configuration without warnings", () => {
    expect(checkServerConfig(good)).toEqual({ errors: [], warnings: [] });
  });

  it("blocks the silent superuser fallback and a shared URL", () => {
    expect(checkServerConfig({ ...good, APP_DATABASE_URL: undefined }).errors.join()).toMatch(/APP_DATABASE_URL не задан/);
    expect(checkServerConfig({ ...good, APP_DATABASE_URL: good.DATABASE_URL }).errors.join()).toMatch(/совпадает/);
  });

  it("rejects the database passwords published in the repository", () => {
    const published = "postgresql://orion_app:OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI@db:5432/orion";
    expect(checkServerConfig({ ...good, APP_DATABASE_URL: published }).errors.join()).toMatch(/пароль из репозитория/);
    expect(checkServerConfig({ ...good, DATABASE_URL: "postgresql://orion:orion_local_dev@db:5432/orion" }).errors.join()).toMatch(/пароль из репозитория/);
  });

  it("rejects short, missing and known-weak JWT secrets", () => {
    for (const JWT_SECRET of [undefined, "short", "dev-only-insecure-secret"]) {
      expect(checkServerConfig({ ...good, JWT_SECRET }).errors.join()).toMatch(/JWT_SECRET/);
    }
  });

  it("requires explicit HTTPS origins and a public API URL", () => {
    expect(checkServerConfig({ ...good, WEB_ORIGIN: undefined }).errors.join()).toMatch(/WEB_ORIGIN/);
    expect(checkServerConfig({ ...good, WEB_ORIGIN: "http://orion.example.com" }).errors.join()).toMatch(/HTTPS/);
    expect(checkServerConfig({ ...good, WEB_ORIGIN: "https://orion.example.com/app" }).errors.join()).toMatch(/без пути/);
    expect(checkServerConfig({ ...good, PUBLIC_API_URL: undefined }).errors.join()).toMatch(/PUBLIC_API_URL/);
    expect(checkServerConfig({ ...good, PUBLIC_API_URL: "http://localhost:4000" }).errors.join()).toMatch(/loopback/);
  });

  it("accepts several origins and flags a loopback one only as a warning", () => {
    const report = checkServerConfig({ ...good, WEB_ORIGINS: "https://a.example.com, http://localhost:3010" });
    expect(report.errors).toEqual([]);
    expect(report.warnings.join()).toMatch(/loopback/);
  });

  it("validates proxies and the sync key", () => {
    expect(checkServerConfig({ ...good, ORION_TRUSTED_PROXIES: "not-an-ip" }).errors.join()).toMatch(/ORION_TRUSTED_PROXIES/);
    expect(checkServerConfig({ ...good, SYNC_SECRET: "c2hvcnQ=" }).errors.join()).toMatch(/SYNC_SECRET/);
    expect(checkServerConfig({ ...good, ORION_TRUSTED_PROXIES: undefined }).warnings.join()).toMatch(/ORION_TRUSTED_PROXIES/);
    expect(checkServerConfig({ ...good, SYNC_SECRET: undefined }).warnings.join()).toMatch(/SYNC_SECRET/);
  });
});

describe("assertServerConfig", () => {
  it("lists every blocking problem at once and logs warnings", () => {
    const logged: string[] = [];
    expect(() => assertServerConfig({}, (message) => logged.push(message))).toThrow(
      /JWT_SECRET[\s\S]*APP_DATABASE_URL[\s\S]*WEB_ORIGIN[\s\S]*PUBLIC_API_URL/
    );
    expect(logged.length).toBeGreaterThan(0);
  });

  it("passes silently when the configuration is sound", () => {
    expect(() => assertServerConfig(good, () => undefined)).not.toThrow();
  });
});

describe("describeDbRoleProblems", () => {
  it("flags superuser and BYPASSRLS roles", () => {
    expect(describeDbRoleProblems({ rolname: "orion", rolsuper: true, rolbypassrls: true })).toHaveLength(2);
    expect(describeDbRoleProblems({ rolname: "orion_app", rolsuper: false, rolbypassrls: false })).toEqual([]);
    expect(describeDbRoleProblems(undefined)).toHaveLength(1);
  });
});
