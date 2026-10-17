import { createHmac, timingSafeEqual } from "node:crypto";
import { lanPairingCodeInput } from "@orion/shared-types";

/**
 * Код сопоставления. Хост считает его из отпечатка СВОЕГО сертификата, клиент — из сертификата, который
 * реально увидел в TLS-соединении. Если между ними посредник с другим сертификатом, коды расходятся, и
 * владелец, вводя на хосте код с экрана клиента, получит отказ. Код не секретен (он на экране), поэтому
 * подтверждение лимитировано по числу попыток (pairing.service.ts).
 */
export function computePairingCode(clientNonce: string, serverNonce: string, fingerprint: string): string {
  const digest = createHmac("sha256", "orion-lan-pairing").update(lanPairingCodeInput(clientNonce, serverNonce, fingerprint)).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function codesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
