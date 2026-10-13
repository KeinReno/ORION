// Whole-node backup → restore rehearsal (DEPLOYMENT_READINESS.md «Данные и откат»):
// `pnpm ops:restore-rehearsal` after `pnpm --filter @orion/api build`.
//
// Uses two throwaway databases in the local cluster (orion_e2e → orion_restore,
// both dropped and recreated — the dev database is never touched) and temporary
// storage directories. Populates the source node through the real API (account,
// note, list ↔ stock link with a purchase, an uploaded file), takes
// `dist/ops/cli.js backup`, verifies it offline, restores into the empty target
// and then proves on a second API process that the same password logs in, the
// workspace is visible under RLS, the link and balance survived and the file's
// SHA-256 matches. Exit code ≠ 0 on any mismatch.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = process.argv[2] ?? join(root, "tmp", "restore-rehearsal");
const { e2eUrls } = await import(pathToFileURL(join(root, "scripts", "e2e-db.mjs")).href);
const shell = process.platform === "win32";
const api = join(root, "apps", "api");
const log = (...args) => console.log("[rehearsal]", ...args);

function urlsFor(db) {
  const swap = (url) => {
    const parsed = new URL(url);
    parsed.pathname = `/${db}`;
    return parsed.toString();
  };
  const urls = e2eUrls();
  return { migrate: swap(urls.migrate), app: swap(urls.app) };
}
function recreate(db) {
  execFileSync("node", ["scripts/e2e-db.mjs"], { cwd: root, stdio: "inherit", shell, env: { ...process.env, E2E_DATABASE: db } });
}
async function startApi(port, urls, storageDir) {
  const child = spawn("node", ["dist/main.js"], {
    cwd: api,
    env: { ...process.env, PORT: String(port), DATABASE_URL: urls.migrate, APP_DATABASE_URL: urls.app, STORAGE_DRIVER: "local", STORAGE_DIR: storageDir, ORION_MODE: "local" },
    stdio: ["ignore", "ignore", "inherit"]
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/system/health`)).ok) return child;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`API on ${port} did not start`);
}
async function call(port, method, path, token, body) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${buf.toString()}`);
  return { buf, json: () => JSON.parse(buf.toString()) };
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const storeA = join(work, "store-a");
const storeB = join(work, "store-b");
const backupDir = join(work, "backup");

recreate("orion_e2e");
recreate("orion_restore");
const source = urlsFor("orion_e2e");
const target = urlsFor("orion_restore");

// 1. Data on the source node.
const a = await startApi(4200, source, storeA);
const email = `rehearsal-${Date.now()}@example.test`;
const password = "Rehearsal-Strong-Password-42";
const token = (await call(4200, "POST", "/auth/register", null, { name: "Репетиция", email, password })).json().accessToken;
const ws = (await call(4200, "GET", "/workspaces/me", token)).json()[0].id;
await call(4200, "POST", `/workspaces/${ws}/notes`, token, { title: "Заметка до бэкапа", body: "проверка восстановления" });
const list = (await call(4200, "POST", `/workspaces/${ws}/lists`, token, { name: "Покупки" })).json();
const entry = (await call(4200, "POST", `/workspaces/${ws}/lists/${list.id}/items`, token, { label: "Фильтр" })).json();
const stock = (await call(4200, "POST", `/workspaces/${ws}/inventory/items`, token, { name: "Фильтр для воды" })).json();
await call(4200, "PUT", `/workspaces/${ws}/lists-inventory/lists/${list.id}/items/${entry.id}/link`, token, { inventoryItemId: stock.id, quantity: 2 });
await call(4200, "POST", `/workspaces/${ws}/lists-inventory/lists/${list.id}/items/${entry.id}/purchase`, token);
const fileBytes = Buffer.from(`ORION rehearsal ${Date.now()}\n`.repeat(200));
const form = new FormData();
form.append("files", new Blob([fileBytes], { type: "text/plain" }), "rehearsal.txt");
const uploaded = (await call(4200, "POST", `/workspaces/${ws}/documents/upload`, token, form)).json();
const docId = (Array.isArray(uploaded) ? uploaded[0] : uploaded).id;
a.kill();
log("source populated: workspace", ws, "document", docId);

// 2. Backup + offline verify from the source node.
const cli = (cmd, urls, store) =>
  execFileSync("node", ["dist/ops/cli.js", cmd, backupDir], {
    cwd: api,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: urls.migrate, STORAGE_DIR: store, STORAGE_DRIVER: "local" }
  });
cli("backup", source, storeA);
cli("verify", source, storeA);

// 3. Restore into an empty, migrated database and an empty storage directory.
cli("restore", target, storeB);

// 4. The restored node serves the same account, data, links and bytes.
const b = await startApi(4201, target, storeB);
try {
  const token2 = (await call(4201, "POST", "/auth/login", null, { email, password })).json().accessToken;
  const ws2 = (await call(4201, "GET", "/workspaces/me", token2)).json();
  if (!ws2.some((w) => w.id === ws)) throw new Error("restored workspace not visible under RLS");
  const notes = (await call(4201, "GET", `/workspaces/${ws}/notes`, token2)).json();
  if (!notes.some((n) => n.title === "Заметка до бэкапа")) throw new Error("note missing after restore");
  const lists = (await call(4201, "GET", `/workspaces/${ws}/lists`, token2)).json();
  const restoredEntry = lists.flatMap((l) => l.items).find((i) => i.id === entry.id);
  if (!restoredEntry?.stocked || restoredEntry.inventoryItemId !== stock.id) throw new Error("list ↔ inventory link lost after restore");
  const items = (await call(4201, "GET", `/workspaces/${ws}/inventory/items`, token2)).json();
  if (items.find((i) => i.id === stock.id)?.balance !== 2) throw new Error("inventory balance differs after restore");
  const bytes = (await call(4201, "GET", `/workspaces/${ws}/documents/${docId}/content`, token2)).buf;
  const sha = (x) => createHash("sha256").update(x).digest("hex");
  if (sha(bytes) !== sha(fileBytes)) throw new Error("document bytes differ after restore");
  log("OK: login, workspace under RLS, note, list↔inventory link, balance and document sha256 match after restore");
} finally {
  b.kill();
}
