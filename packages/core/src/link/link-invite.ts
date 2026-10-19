import { linkPairingSchema, type LinkPairing } from "@orion/shared-types";
import { z } from "zod";

/** Префикс кода приглашения устройства Orion Link. */
export const LINK_INVITE_PREFIX = "ORIONLINK1.";

const inviteSchema = z.object({
  pairing: linkPairingSchema,
  /** Адрес облака без пароля: пароль WebDAV вводится на устройстве отдельно и в код не попадает. */
  webdav: z.object({ url: z.string().url(), baseDir: z.string(), username: z.string() })
});
export type LinkInvite = z.infer<typeof inviteSchema>;

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Код для переноса спаривания на устройство (копированием или QR). ВНУТРИ — ключ пакетов `K_ws`:
 * относитесь к коду как к паролю, показывайте один раз, не пишите в логи и не пересылайте по открытым каналам.
 */
export function encodeLinkInvite(invite: { pairing: LinkPairing; webdav: { url: string; baseDir: string; username: string } }): string {
  return LINK_INVITE_PREFIX + b64urlEncode(JSON.stringify(inviteSchema.parse(invite)));
}

export function decodeLinkInvite(code: string): LinkInvite {
  const trimmed = code.trim();
  if (!trimmed.startsWith(LINK_INVITE_PREFIX)) throw new Error("Это не код приглашения Orion Link");
  try {
    return inviteSchema.parse(JSON.parse(b64urlDecode(trimmed.slice(LINK_INVITE_PREFIX.length))));
  } catch {
    throw new Error("Код приглашения повреждён или неполный");
  }
}
