import { X509Certificate } from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import { derToPem, fingerprintOfDer } from "./self-signed-cert";

export interface ObservedCertificate {
  certPem: string;
  fingerprint: string;
}

/** Рукопожатие без доверия: нужно лишь прочитать сертификат, который предъявляет узел. Данные по нему не передаются. */
export function observeCertificate(host: string, port: number, timeoutMs = 4000): Promise<ObservedCertificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const raw = socket.getPeerCertificate(true)?.raw;
      socket.end();
      if (!raw) return reject(new Error("no certificate"));
      resolve({ certPem: derToPem(raw), fingerprint: fingerprintOfDer(raw) });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Опции https.request, привязанные к одному сертификату: доверенный корень — только он сам, имя хоста не
 * проверяется (адрес в LAN меняется, а личность узла — это сертификат). Любой другой сертификат, в том числе
 * «настоящий» от публичного CA, закрытое соединение: TLS не дойдёт до отправки заголовков.
 */
export function pinnedAgentOptions(certPem: string): https.RequestOptions {
  const pinned = new X509Certificate(certPem);
  return {
    ca: certPem,
    rejectUnauthorized: true,
    checkServerIdentity: (_host, cert) => (cert.fingerprint256 === pinned.fingerprint256 ? undefined : new Error("Сертификат узла не совпал с закреплённым")),
    // Отдельный agent без keep-alive: пиннинг привязан к опциям запроса, общий пул не нужен.
    agent: false
  };
}

export interface JsonResponse<T = unknown> {
  status: number;
  body: T | null;
}

/** Небольшой JSON-запрос к узлу с закреплённым сертификатом (для проб, заявок и опросов). */
export function pinnedJson<T = unknown>(
  target: { address: string; port: number; certPem: string },
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<JsonResponse<T>> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
    const request = https.request(
      {
        ...pinnedAgentOptions(target.certPem),
        host: target.address,
        port: target.port,
        method,
        path,
        timeout: options.timeoutMs ?? 5000,
        headers: { accept: "application/json", ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}), ...options.headers }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          let body: T | null = null;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
          } catch {
            body = null;
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}
