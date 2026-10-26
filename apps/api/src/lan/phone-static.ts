import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

/**
 * Телефон открывает страницу с самого узла (`https://адрес:порт/phone`), чтобы говорить с API
 * напрямую. Каталог — статический экспорт веб-клиента, если он собран рядом.
 */
export function phoneDistDir(): string | null {
  const candidates = [
    process.env.ORION_WEB_DIST,
    path.resolve(process.cwd(), "apps/web/out"),
    path.resolve(process.cwd(), "../web/out"),
    path.resolve(process.cwd(), "apps/web/.next-desktop"),
    path.resolve(process.cwd(), "../web/.next-desktop")
  ].filter((item): item is string => Boolean(item));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "phone.html")) || fs.existsSync(path.join(dir, "phone", "index.html"))) return dir;
  }
  return null;
}

function fileFor(root: string, urlPath: string): string | null {
  const rel = urlPath === "/phone" ? "phone.html" : urlPath.replace(/^\/+/, "");
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep) && full !== path.resolve(root)) return null;
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  if (urlPath === "/phone") {
    const nested = path.join(root, "phone", "index.html");
    if (fs.existsSync(nested)) return nested;
  }
  return null;
}

export function createPhoneStatic(root: string | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!root || (req.method !== "GET" && req.method !== "HEAD")) return next();
    const urlPath = req.path;
    const served = urlPath === "/phone" || urlPath === "/phone.html" || urlPath.startsWith("/_next/") || urlPath === "/favicon.ico" || /^\/kaiden-\d+\.png$/.test(urlPath);
    if (!served) return next();
    const file = fileFor(root, urlPath === "/phone.html" ? "/phone" : urlPath);
    if (!file) return next();
    res.sendFile(file);
  };
}
