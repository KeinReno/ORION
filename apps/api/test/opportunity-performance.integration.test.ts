import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpus, totalmem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HhImportRun, OpportunityPage } from "@orion/shared-types";
import { Hub } from "./opportunity-hub-fixtures";

/** Opt-in measured acceptance on a disposable database. Includes preview, checkpoints and HTTP; no external network. */
describe.skipIf(process.env.ORION_HUB_BENCHMARK !== "1")("Hub measured acceptance (10,000 records / 3 profiles)", () => {
  const hub = new Hub();
  beforeAll(() => hub.start()); afterAll(() => hub.stop());
  it("measures actual import and paged API against the specification targets", async () => {
    const a = await hub.register("benchmark");
    await hub.enable(a, "opportunities-profiles", "opportunities-hh-import");
    for (let i = 0; i < 3; i += 1) expect((await hub.req(hub.profilesPath(a), a.token, "POST", { kind: i === 2 ? "team" : "person", displayName: `Synthetic ${i}`, acknowledgeWorkspaceVisibility: true })).status).toBe(201);
    const files = Array.from({ length: 10 }, (_, batch) => ({ path: `vacancies_benchmark_${batch}.json`, text: JSON.stringify(Array.from({ length: 1000 }, (_, n) => ({ url: `https://hh.ru/vacancy/${8000000 + batch * 1000 + n}`, name: `Analyst ${batch * 1000 + n}` }))) }));
    const importer = `/workspaces/${a.workspaceId}/opportunity-hh-import`;
    const baseline = process.memoryUsage().rss; let peak = baseline;
    const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
    const timer = setInterval(sample, 10); const started = performance.now();
    let created = 0; let checkpoints = 0;
    try {
      for (let batch = 0; batch < files.length; batch += 2) {
        const preview = await hub.req<HhImportRun>(`${importer}/preview`, a.token, "POST", { files: files.slice(batch, batch + 2), acknowledgeWorkspaceVisibility: true });
        expect(preview.status, JSON.stringify(preview.data)).toBe(201); let run = preview.data;
        expect(run.total).toBe(2000);
        while (run.status !== "applied") {
          const applied = await hub.req<HhImportRun>(`${importer}/${run.id}/apply`, a.token, "POST", { expectedRevision: run.revision, manifestHash: run.manifestHash });
          expect(applied.status, JSON.stringify(applied.data)).toBe(201); run = applied.data; checkpoints += 1; sample();
        }
        created += run.report.opportunitiesCreated;
      }
    } finally { clearInterval(timer); sample(); }
    const importMs = performance.now() - started;
    expect(created).toBe(10000);
    const times: number[] = []; let cursor: string | null = null;
    for (let n = 0; n < 105; n += 1) {
      const t = performance.now();
      const page: { status: number; data: OpportunityPage } = await hub.req<OpportunityPage>(`/workspaces/${a.workspaceId}/opportunities?limit=50${cursor ? `&cursor=${cursor}` : ""}`, a.token);
      expect(page.status).toBe(200); expect(page.data.items).toHaveLength(50);
      if (n >= 5) times.push(performance.now() - t);
      cursor = page.data.nextCursor;
    }
    times.sort((x, y) => x - y);
    const metrics = { at: new Date().toISOString(), node: process.version, platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalRamGiB: totalmem() / 2 ** 30, records: 10000, profiles: 3, format: "normalized HH JSON; binary extraction excluded", checkpoints, importMs, peakAdditionalMiB: (peak - baseline) / 2 ** 20, pageSamples: times.length, pageP95Ms: times[Math.ceil(times.length * .95) - 1] };
    mkdirSync(resolve("tmp"), { recursive: true }); writeFileSync(resolve("tmp/opportunity-hub-performance.json"), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics));
    expect(metrics.pageP95Ms).toBeLessThanOrEqual(500);
    expect(metrics.peakAdditionalMiB).toBeLessThanOrEqual(512);
    expect(metrics.importMs).toBeLessThanOrEqual(60000);
  }, 180000);
});
