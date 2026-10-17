#!/usr/bin/env node
// Командная строка локального исполнителя (R1.1). Режим --simulate проверяет протокол без браузера и без отправки.
// Настоящий адаптер для hh.ru НЕ реализован и не проверялся: без --simulate команда честно отказывается работать.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CONTRACT_VERSION, runOnce } from "./runner-loop.mjs";
import { createSimulatedAdapter } from "./simulated-adapter.mjs";

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) { const key = a.slice(2); const next = argv[i + 1]; if (next && !next.startsWith("--")) { out[key] = next; i += 1; } else out[key] = true; } else out._.push(a);
  }
  return out;
}

function http(server, token) {
  const call = async (path, body, method = "POST") => {
    const res = await fetch(`${server.replace(/\/$/, "")}/opportunities-executor/v1/${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    const text = await res.text(); const data = text ? JSON.parse(text) : null;
    if (!res.ok) { const error = new Error(data?.message ?? `HTTP ${res.status}`); error.status = res.status; throw error; }
    return data;
  };
  return {
    bind: (body) => call("bind", body),
    claim: () => call("claim"),
    heartbeat: (attemptId, leaseToken) => call("heartbeat", { attemptId, leaseToken }),
    reserve: (body) => call("reserve", body),
    result: (attemptId, leaseToken, body) => call("result", { attemptId, leaseToken, ...body })
  };
}

const [command, ...rest] = process.argv.slice(2);
const opts = args(rest);
const usage = `Использование:
  node scripts/hh-runner/cli.mjs bind --server http://127.0.0.1:4000 --code ohp_... --account <id аккаунта> --token-file <путь> --simulate
  node scripts/hh-runner/cli.mjs run  --server http://127.0.0.1:4000 --token-file <путь> --simulate [--once]`;

if (!opts.simulate) {
  console.error("Адаптер браузера для hh.ru не реализован и не проверялся. Доступен только режим --simulate (протокол без отправки).\n" + usage);
  process.exit(2);
}

if (command === "bind") {
  if (!opts.server || !opts.code || !opts["token-file"]) { console.error(usage); process.exit(2); }
  if (existsSync(opts["token-file"])) { console.error("Файл токена уже существует. Удалите его осознанно или укажите другой путь."); process.exit(2); }
  const reply = await http(opts.server).bind({ pairingCode: opts.code, externalAccountId: opts.account ?? "acc-sim", accountDisplay: "Имитация", runnerId: opts.runner ?? "sim-runner", contractVersion: CONTRACT_VERSION });
  writeFileSync(opts["token-file"], reply.runnerToken, { mode: 0o600 });
  console.log(`Подключение ${reply.connectionId} привязано. Токен сохранён в ${opts["token-file"]}.`);
} else if (command === "run") {
  if (!opts.server || !opts["token-file"]) { console.error(usage); process.exit(2); }
  const api = http(opts.server, readFileSync(opts["token-file"], "utf8").trim());
  const adapter = createSimulatedAdapter({ accountId: opts.account ?? "acc-sim" });
  for (;;) {
    const result = await runOnce({ api: { claim: api.claim, heartbeat: api.heartbeat, reserve: (b) => api.reserve(b), result: api.result }, adapter, log: console.log });
    console.log(JSON.stringify(result));
    if (opts.once) break;
    await new Promise((r) => setTimeout(r, (result.retryAfterSec ?? 30) * 1000));
  }
} else { console.error(usage); process.exit(2); }
