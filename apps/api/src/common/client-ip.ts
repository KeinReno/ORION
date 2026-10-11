import type { Request } from "express";

/** Express applies its configured trust-proxy policy before computing req.ip. */
export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
