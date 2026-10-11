import { BadRequestException } from "@nestjs/common";
import * as dns from "node:dns/promises";

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

export function isPrivateOrLoopbackHost(host: string): boolean {
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

/**
 * `fetch()` follows redirects by default, which defeats the hostname check
 * above (a permitted public URL can 302 to an internal address). Callers use
 * `redirect: "manual"` and this helper to turn any redirect into a rejection
 * instead of a silent follow.
 */
export function rejectRedirect(response: Response, label = "Адрес"): void {
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${label}: редиректы не поддерживаются из соображений безопасности`);
  }
}
