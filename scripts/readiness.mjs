/**
 * Pure, framework-free readiness polling for the desktop launcher
 * (scripts/launch-desktop.mjs). No Tauri/child_process here on purpose —
 * this file has no side effects and is unit-tested directly (see
 * readiness.test.mjs) with an injected fetch/clock, without spawning real
 * processes or a real Tauri runtime.
 *
 * S18: "Readiness вместо fixed sleeps" — a fixed `setTimeout` before
 * showing the window can't tell "занят порт" (something else answered),
 * "БД не поднялась" (API up but /system/health 5xx or times out because
 * `SELECT 1` never returns) and "API умер" (the child process itself
 * exited) apart from a slow-but-fine start. Polling the real health
 * endpoint and inspecting the child's exit code can.
 */

/**
 * @param {object} opts
 * @param {string} opts.url - health endpoint to poll, e.g. http://127.0.0.1:4000/system/health
 * @param {(url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>} opts.fetchImpl
 * @param {() => number} opts.now - clock, ms
 * @param {(ms: number) => Promise<void>} opts.sleep
 * @param {number} opts.deadlineMs - absolute deadline per `now()`
 * @param {number} [opts.pollIntervalMs]
 * @param {() => boolean} [opts.isCrashed] - true once the awaited child process has exited non-zero
 * @returns {Promise<
 *   | { state: "ready"; body: unknown }
 *   | { state: "wrong-service"; status: number }
 *   | { state: "crashed" }
 *   | { state: "timeout" }
 * >}
 */
export async function pollReadiness({
  url,
  fetchImpl,
  now,
  sleep,
  deadlineMs,
  pollIntervalMs = 400,
  isCrashed
}) {
  while (now() < deadlineMs) {
    if (isCrashed?.()) {
      return { state: "crashed" };
    }
    try {
      const res = await fetchImpl(url);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && typeof body === "object" && body.status === "ok") {
          return { state: "ready", body };
        }
        // Something answered 2xx on this URL, but not our /system/health
        // shape — most likely a different service already holding the port.
        return { state: "wrong-service", status: res.status };
      }
      return { state: "wrong-service", status: res.status };
    } catch {
      // Connection refused / DNS error / not listening yet — expected while
      // the service is still starting, keep polling.
    }
    await sleep(pollIntervalMs);
  }
  if (isCrashed?.()) {
    return { state: "crashed" };
  }
  return { state: "timeout" };
}

/**
 * Turns a `pollReadiness` result into a Russian, user-facing diagnostic
 * line — the "понятный экран" done-criterion. `logTail` is the tail of the
 * child's log file (stdout+stderr), when available.
 */
export function describeReadinessFailure(result, { name, port, logTail }) {
  const tail = logTail ? `\n${logTail}` : "";
  switch (result.state) {
    case "crashed":
      return `${name} завершился сразу после запуска (упал). Смотри лог ниже — частая причина: БД недоступна или порт ${port} занят другим процессом.${tail}`;
    case "wrong-service":
      return `Порт ${port} занят, но это не похоже на ORION API (${name}): ответ на /system/health не тот, что мы ожидаем. Останови чужой процесс на этом порту или смени PORT в apps/api/.env.`;
    case "timeout":
      return `${name} не ответил на /system/health за отведённое время. Проверь, что Postgres поднята (pnpm db:status) и apps/api/.env корректен.${tail}`;
    default:
      return "";
  }
}
