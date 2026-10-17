import { BadRequestException } from "@nestjs/common";
import * as dnsCallback from "node:dns";
import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import type { LookupAddress, LookupOptions } from "node:dns";

/**
 * S05 — shared SSRF guard for every user-supplied outbound URL (calendar ICS
 * feeds, sync WebDAV remotes). Rejects loopback/private/link-local ranges by
 * default; `ALLOW_PRIVATE_CALENDAR_URLS=true` opts back in for local-network
 * self-hosted setups (e.g. a Nextcloud/Radicale box on the same LAN), which
 * is why the check is a runtime env read, not a compile-time constant.
 *
 * The hostname check alone only rejects the *literal* hostname a user typed
 * — a malicious operator can point a public-looking hostname
 * (`evil.example.com`) at their own DNS server that resolves it to a
 * loopback/private IP (DNS rebinding), defeating a hostname-only check.
 * `assertPublicRemoteUrl` therefore also resolves the hostname via
 * `dns.promises.lookup` and rejects if *any* resolved address is
 * private/loopback — this is the "short TTL double-check" variant (not full
 * IP-pinning of the eventual request): callers that make the request via
 * `fetch()` on `connection.url`/`cfg.url` re-resolve DNS themselves, so a
 * malicious DNS server could in principle answer differently between this
 * check and the request a few milliseconds later. That residual race
 * requires the attacker to control authoritative DNS for the hostname *and*
 * win a very tight timing window, and is judged an acceptable trade-off for
 * this app's threat model (see `docs/HISTORY.md`
 * S05 journal) — callers additionally re-run this check as close to the
 * actual network call as practical (see `sync.service.ts` `remoteFor`) to
 * shrink that window rather than checking only once at config-save time.
 *
 * 2026-09-27: that residual race is now closed for both outbound paths.
 * `publicOnlyLookup` below is handed to the socket itself (ICS feeds via
 * `fetchPublicText`, WebDAV remotes via `publicOnlyAgents`), so the address
 * that gets connected to is the address that gets checked — a DNS server
 * that answers "public" to the pre-check and "127.0.0.1" to the connect
 * no longer wins. The pre-check stays: it gives a clean 400 at save time.
 */
export async function assertPublicRemoteUrl(raw: string, label = "Адрес"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(`${label} указан некорректно`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new BadRequestException("Поддерживаются только HTTP и HTTPS адреса");
  }
  if (process.env.ALLOW_PRIVATE_CALENDAR_URLS === "true") return url;
  const host = url.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(host)) {
    throw new BadRequestException(`${label}: локальные и служебные адреса отключены настройками безопасности`);
  }
  await assertResolvedHostIsPublic(host, label);
  return url;
}

/**
 * DNS-rebinding half of the guard, split out so callers that already have a
 * validated hostname (e.g. re-checking right before an actual WebDAV
 * request) can re-run just the resolve+check step without re-parsing the URL.
 */
export async function assertResolvedHostIsPublic(hostname: string, label = "Адрес"): Promise<void> {
  // A literal IP is already covered by the hostname regex checks above —
  // dns.lookup() on a literal IP just echoes it back, so this is harmless,
  // not redundant work worth special-casing.
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestException(`${label}: не удалось разрешить адрес (DNS)`);
  }
  for (const { address } of records) {
    if (isPrivateOrLoopbackHost(address.toLowerCase())) {
      throw new BadRequestException(
        `${label}: адрес резолвится в локальную или служебную сеть — отклонено (DNS rebinding)`
      );
    }
  }
}

export function isPrivateOrLoopbackHost(rawHost: string): boolean {
  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is the IPv4 address in disguise —
  // a resolver may hand it back for an AAAA query.
  const host = rawHost.replace(/^::ffff:/i, "");
  if (/^0\./.test(host)) return true;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // Link-local (169.254.0.0/16 — includes cloud metadata endpoints like
  // 169.254.169.254) and unique-local/link-local IPv6 (fc00::/7, fe80::/10).
  if (/^169\.254\./.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe80:/i.test(host)) return true;
  return false;
}

/** Max bytes read from an outbound remote-feed response body (ICS/WebDAV probe). */
export const MAX_REMOTE_RESPONSE_BYTES = 5 * 1024 * 1024;

function allowPrivate(): boolean {
  return process.env.ALLOW_PRIVATE_CALENDAR_URLS === "true";
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/**
 * `dns.lookup`-compatible resolver for sockets: resolves, rejects the
 * connection if ANY resolved address is loopback/private/link-local (unless
 * `ALLOW_PRIVATE_CALENDAR_URLS=true`), and only then hands the addresses to
 * `net.connect`. Because it runs inside the connect, there is no gap between
 * "checked" and "connected" for a rebinding DNS server to exploit.
 */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsCallback.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }
    const list = addresses as LookupAddress[];
    if (!allowPrivate() && list.some((entry) => isPrivateOrLoopbackHost(entry.address.toLowerCase()))) {
      const rejected: NodeJS.ErrnoException = new Error(
        "Адрес резолвится в локальную или служебную сеть — соединение отклонено (DNS rebinding)"
      );
      rejected.code = "EPRIVATEADDR";
      callback(rejected, "");
      return;
    }
    if (list.length === 0) {
      const empty: NodeJS.ErrnoException = new Error(`DNS: нет адресов для ${hostname}`);
      empty.code = "ENOTFOUND";
      callback(empty, "");
      return;
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

/** HTTP(S) agents whose sockets resolve through `publicOnlyLookup` — for clients that take an agent (WebDAV). */
export function publicOnlyAgents(): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  return {
    httpAgent: new http.Agent({ keepAlive: true, lookup: publicOnlyLookup }),
    httpsAgent: new https.Agent({ keepAlive: true, lookup: publicOnlyLookup })
  };
}

/**
 * GET a user-supplied URL as text with every outbound guard in one place:
 * connect-time DNS pinning (`publicOnlyLookup`), no redirects (3xx is an
 * error, not a follow), a timeout, and a hard byte cap enforced while
 * streaming — not after buffering the whole body. Replaces `fetch()` for ICS
 * feeds: `fetch` resolves DNS on its own and can't take a lookup hook
 * without the `undici` package as a direct dependency.
 */
export function fetchPublicText(
  raw: string,
  options: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; label?: string } = {}
): Promise<string> {
  const label = options.label ?? "Адрес";
  const maxBytes = options.maxBytes ?? MAX_REMOTE_RESPONSE_BYTES;
  const url = new URL(raw);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      { method: "GET", headers: options.headers, lookup: publicOnlyLookup, timeout: options.timeoutMs ?? 20_000 },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new Error(`${label}: редиректы не поддерживаются из соображений безопасности`));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const declared = Number(response.headers["content-length"] ?? "0");
        if (declared > maxBytes) {
          response.destroy();
          reject(new Error(`${label}: ответ превышает допустимый размер`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy();
            reject(new Error(`${label}: ответ превышает допустимый размер`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        response.on("error", reject);
      }
    );
    request.on("timeout", () => request.destroy(new Error(`${label}: превышено время ожидания`)));
    request.on("error", reject);
    request.end();
  });
}
