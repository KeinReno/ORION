import type { NextFunction, Request, Response } from "express";
import { LAN_DEVICE_TOKEN_HEADER } from "@orion/shared-types";
import type { DeviceStore } from "./device-store";

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

/** Пути, доступные без доверия: сама визитка узла, заявка на подключение и проба живости. */
const OPEN_PATHS = [/^\/lan\/info\/?$/, /^\/lan\/pair\/request\/?$/, /^\/lan\/pair\/status\/[^/]+\/?$/, /^\/system\/health\/?$/];

export function isOpenLanPath(urlPath: string): boolean {
  return OPEN_PATHS.some((pattern) => pattern.test(urlPath));
}

/**
 * Единственная точка, где «Хост LAN» отличает чужого от своего. Запросы с самой машины (loopback — окно ORION
 * этого же ПК) проходят как раньше; всё, что пришло по сети, обязано нести действующий device-токен. Адрес берётся
 * из сокета, а не из X-Forwarded-For: заголовок подделывается любым клиентом.
 */
export function createDeviceTrustMiddleware(devices: DeviceStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const remote = req.socket.remoteAddress;
    if (isLoopbackAddress(remote)) return next();
    if (req.method === "OPTIONS") return next();
    const urlPath = req.path;
    if (isOpenLanPath(urlPath)) return next();
    const header = req.headers[LAN_DEVICE_TOKEN_HEADER];
    const check = devices.check(Array.isArray(header) ? header[0] : header, remote ?? null);
    if (check.ok) return next();
    // Тело ответа одинаково бедно для «неизвестен» и «отозван» по смыслу, но код различим для UI клиента.
    if (check.reason === "revoked") res.setHeader("x-orion-lan", "device_revoked");
    res.status(check.reason === "revoked" ? 401 : 403).json({
      statusCode: check.reason === "revoked" ? 401 : 403,
      code: check.reason === "revoked" ? "device_revoked" : "device_untrusted",
      message: check.reason === "revoked" ? "Доступ этого устройства отозван владельцем узла" : "Устройство не подключено к узлу"
    });
  };
}
