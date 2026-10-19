import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_IDS,
  type ContractId,
  DOMAIN_EVENT_TYPES,
  MODULE_CATALOG,
  PERMISSION_IDS,
  PLATFORM_CONTRACT_VERSIONS,
  SURFACE_IDS,
  themeDocumentSchema
} from "@orion/shared-types";

/**
 * G2: снимок публичной поверхности контрактов платформы. Меняется слот, экспорт `host-api.ts`, тип события,
 * разрешение, токен темы, поверхность или id модуля — тест падает, пока не обновлён снимок, а снимок нельзя
 * обновить, не подняв версию контракта в `platform-contracts.ts`.
 * Обновление: `ORION_UPDATE_CONTRACT_SNAPSHOT=1 pnpm vitest run apps/web/lib/extensions/contract-snapshot.test.ts`.
 */
const SNAPSHOT_PATH = resolve(__dirname, "../../../../docs/platform-api/contracts.snapshot.json");

interface ContractSnapshot {
  version: string;
  /** Отсортированный перечень публичной поверхности; пусто — у контракта нет проверяемого перечня. */
  surface: string[];
}
type Snapshot = Record<ContractId, ContractSnapshot>;

const read = (file: string): string => readFileSync(resolve(__dirname, file), "utf8");

function slotNames(): string[] {
  const source = read("contracts.ts");
  const body = /export interface SlotContracts \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]!);
}

function hostApiExports(): string[] {
  const names: string[] = [];
  for (const block of read("host-api.ts").matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of block[1]!.split(",")) {
      const cleaned = item.trim().replace(/^type\s+/, "");
      if (cleaned) names.push((cleaned.split(/\s+as\s+/).pop() ?? cleaned).trim());
    }
  }
  return names;
}

function currentSurfaces(): Record<ContractId, string[]> {
  const sorted = (items: readonly string[]) => [...new Set(items)].sort();
  return {
    module: sorted(MODULE_CATALOG.map((m) => m.id)),
    plugin: sorted([...slotNames().map((s) => `slot:${s}`), ...hostApiExports().map((e) => `host:${e}`)]),
    event: sorted(DOMAIN_EVENT_TYPES),
    storage: [],
    workspace: [],
    theme: sorted(Object.keys(themeDocumentSchema.shape.colors.shape)),
    surface: sorted(SURFACE_IDS),
    permission: sorted(PERMISSION_IDS),
    integration: [],
    agentGateway: []
  };
}

function currentSnapshot(): Snapshot {
  const surfaces = currentSurfaces();
  return Object.fromEntries(
    CONTRACT_IDS.map((id) => [id, { version: PLATFORM_CONTRACT_VERSIONS[id], surface: surfaces[id] }])
  ) as Snapshot;
}

const format = (snapshot: Snapshot): string => `${JSON.stringify(snapshot, null, 2)}\n`;

describe("platform contract snapshot (G2)", () => {
  it("tracks a non-empty surface where one is enumerable", () => {
    const surfaces = currentSurfaces();
    expect(surfaces.plugin.some((s) => s.startsWith("slot:"))).toBe(true);
    expect(surfaces.plugin.some((s) => s.startsWith("host:"))).toBe(true);
    for (const id of ["module", "event", "theme", "surface", "permission"] as const) {
      expect(surfaces[id].length, id).toBeGreaterThan(0);
    }
  });

  if (process.env.ORION_UPDATE_CONTRACT_SNAPSHOT === "1") {
    it("writes the snapshot, refusing a changed surface without a version bump", () => {
      const next = currentSnapshot();
      if (existsSync(SNAPSHOT_PATH)) {
        const previous = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
        for (const id of CONTRACT_IDS) {
          const changed = JSON.stringify(previous[id]?.surface) !== JSON.stringify(next[id].surface);
          if (changed && previous[id]?.version === next[id].version) {
            throw new Error(`Контракт «${id}»: поверхность изменилась, версия осталась ${next[id].version}. Поднимите её в platform-contracts.ts.`);
          }
        }
      }
      writeFileSync(SNAPSHOT_PATH, format(next));
    });
    return;
  }

  it("matches docs/platform-api/contracts.snapshot.json (change a surface → bump the version and update the snapshot)", () => {
    expect(existsSync(SNAPSHOT_PATH), "нет снимка — создайте его с ORION_UPDATE_CONTRACT_SNAPSHOT=1").toBe(true);
    const recorded = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
    const current = currentSnapshot();
    for (const id of CONTRACT_IDS) {
      expect(recorded[id]?.version, `${id}: версия в снимке и в platform-contracts.ts`).toBe(current[id].version);
      expect(recorded[id]?.surface, `${id}: публичная поверхность изменилась — поднимите версию и обновите снимок`).toEqual(
        current[id].surface
      );
    }
  });
});
