import https from "node:https";
import type { Readable } from "node:stream";
import { pinnedAgentOptions } from "../lan/pinned-request";

export interface PinnedTarget {
  address: string;
  port: number;
  certPem: string;
}

export function pinnedCall(
  target: PinnedTarget,
  method: "GET" | "POST" | "PUT",
  requestPath: string,
  options: { json?: unknown; stream?: Readable; contentLength?: number; headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<{ status: number; json: unknown }> {
  const payload = options.json === undefined ? null : Buffer.from(JSON.stringify(options.json));
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { accept: "application/json", ...options.headers };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = payload.length;
    }
    if (options.contentLength !== undefined) headers["content-length"] = options.contentLength;
    const request = https.request(
      {
        ...pinnedAgentOptions(target.certPem),
        host: target.address,
        port: target.port,
        method,
        path: requestPath,
        timeout: options.timeoutMs ?? 20_000,
        headers
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    if (options.stream) {
      options.stream.on("error", reject);
      options.stream.pipe(request);
      return;
    }
    request.end(payload ?? undefined);
  });
}
