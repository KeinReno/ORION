/**
 * Редакция этой рабочей копии. Ветка `experiment/orion-rust-foundation`
 * собирает только KAIDEN Precision и говорит с API на порту из
 * `orion-rust/edition.json`, а не с установленной beta на :4000.
 */
export const ORION_EDITION = "rust" as const;
export const PRECISION_ONLY = true;
export const LOCAL_API_PORT = 14000;
export const LOCAL_API_URL = `http://localhost:${LOCAL_API_PORT}`;
export const LOCAL_API_LOOPBACK = `http://127.0.0.1:${LOCAL_API_PORT}`;

export function usesPrecisionShell(theme: string | null | undefined): boolean {
  return PRECISION_ONLY || theme === "kaiden-precision";
}
