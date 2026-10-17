import http from "node:http";
import https from "node:https";
import type { NextFunction, Request, Response } from "express";
import { LAN_DEVICE_TOKEN_HEADER, LAN_REMOTE_PREFIX } from "@orion/shared-types";
import { isLoopbackAddress } from "./device-trust.middleware";
import type { LanClientBinding } from "./node-config";
import { pinnedAgentOptions } from "./pinned-request";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "origin", "referer", "cookie"]);

export interface RemoteProxyDeps {
  isClientMode: () => boolean;
  binding: () => LanClientBinding | null;
  onResult?: (result: "online" | "offline" | "revoked") => void;
}

function fail(res: Response, status: number, code: string, message: string): void {
  if (res.headersSent) return void res.destroy();
  res.status(status).json({ statusCode: status, code, message });
}

/**
 * Клиентский режим без Rust: окно ORION всегда говорит с локальным API по loopback, а этот прокси на пути
 * `/_remote/*` переадресует запрос на выбранный узел по TLS с закреплённым сертификатом и добавляет device-токен.
 * Так пиннинг делает Node (WebView2 самоподписанный сертификат не примет), а CSP десктопа менять не нужно.
 *
 * Тело стримится как есть (загрузка файлов, Range-скачивание), поэтому прокси стоит ДО body-parser'ов.
 * Тихой записи в локальную БД не бывает по построению: путь `/_remote` не доходит до контроллеров.
 */
export function createRemoteProxy(deps: RemoteProxyDeps) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const url = req.originalUrl;
    if (url !== LAN_REMOTE_PREFIX && !url.startsWith(`${LAN_REMOTE_PREFIX}/`) && !url.startsWith(`${LAN_REMOTE_PREFIX}?`)) return next();
    if (req.method === "OPTIONS") return next();
    if (!isLoopbackAddress(req.socket.remoteAddress)) return fail(res, 403, "remote_loopback_only", "Прокси узла доступен только с этого компьютера");
    const binding = deps.binding();
    if (!deps.isClientMode() || !binding) return fail(res, 409, "not_client_mode", "Это устройство не подключено к узлу LAN");

    const headers: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== LAN_DEVICE_TOKEN_HEADER) headers[key] = value;
    }
    headers[LAN_DEVICE_TOKEN_HEADER] = binding.deviceToken;
    headers.host = `${binding.address}:${binding.port}`;

    const upstream = https.request(
      {
        ...pinnedAgentOptions(binding.certPem),
        host: binding.address,
        port: binding.port,
        method: req.method,
        path: url.slice(LAN_REMOTE_PREFIX.length) || "/",
        headers,
        timeout: 30_000
      },
      (response) => {
        deps.onResult?.(response.headers["x-orion-lan"] === "device_revoked" ? "revoked" : "online");
        const forwarded: http.OutgoingHttpHeaders = {};
        for (const [key, value] of Object.entries(response.headers)) {
          // CORS отдаёт локальный API; заголовки узла (у него свой список origin'ов) не пробрасываем.
          if (!HOP_BY_HOP.has(key.toLowerCase()) && !key.toLowerCase().startsWith("access-control-")) forwarded[key] = value;
        }
        res.writeHead(response.statusCode ?? 502, forwarded);
        response.pipe(res);
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      const pinMismatch = /закреплённым|fingerprint|certificate|self.signed|SELF_SIGNED|DEPTH_ZERO/i.test(`${error.message} ${error.code ?? ""}`);
      deps.onResult?.("offline");
      if (pinMismatch) return fail(res, 502, "node_cert_changed", "Сертификат узла изменился. Подключитесь к узлу заново и сверьте код.");
      fail(res, 503, "node_offline", `Узел «${binding.name}» не в сети`);
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  };
}
