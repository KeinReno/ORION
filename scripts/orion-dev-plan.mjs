import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import planner from "../packages/shared-types/development-plan.cjs";
export const { planOrionDevImport } = planner;

const self = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (self) {
  const here = dirname(fileURLToPath(import.meta.url));
  const catalog = JSON.parse(readFileSync(resolve(process.argv[2] ?? resolve(here, "../development/orion-dev.catalog.json")), "utf8"));
  const snapshot = process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]), "utf8")) : {};
  process.stdout.write(JSON.stringify(planOrionDevImport(catalog, snapshot), null, 2) + "\n");
}
