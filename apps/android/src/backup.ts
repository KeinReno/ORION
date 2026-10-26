import { Capacitor, registerPlugin } from "@capacitor/core";
import { MAX_BACKUP_BYTES } from "@orion/mobile-core";
const native = registerPlugin<{
  exportBackup(options: { value: string }): Promise<{ saved: boolean }>;
  importBackup(): Promise<{ value?: string; name?: string | null; cancelled: boolean }>;
}>("OrionBackup");

export type BackupPick =
  | { status: "picked"; value: string; name: string | null }
  | { status: "cancelled" };

export async function exportBackup(value: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return (await native.exportBackup({ value })).saved;
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "KAIDEN-Orion-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  // A browser download is dispatched, but cannot acknowledge a filesystem commit.
  return false;
}

/** Opens the system file picker; the caller validates and previews the content before writing. */
export async function importBackup(): Promise<BackupPick> {
  if (Capacitor.isNativePlatform()) {
    const result = await native.importBackup();
    if (result.cancelled || typeof result.value !== "string") return { status: "cancelled" };
    if (new TextEncoder().encode(result.value).byteLength > MAX_BACKUP_BYTES) throw new Error("Файл больше 24 МБ и не может быть резервной копией Orion.");
    return { status: "picked", value: result.value, name: result.name?.trim() || null };
  }
  return new Promise<BackupPick>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json"; input.style.display = "none";
    let settled = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: BackupPick, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      window.removeEventListener("focus", regain);
      input.remove();
      if (error) reject(error); else resolve(result!);
    };
    const regain = () => { timer = setTimeout(() => { if (!input.files?.length) finish({ status: "cancelled" }); }, 600); };
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) { finish({ status: "cancelled" }); return; }
      if (file.size > MAX_BACKUP_BYTES) { finish(undefined, new Error("Файл больше 24 МБ и не может быть резервной копией Orion.")); return; }
      try { finish({ status: "picked", value: await file.text(), name: file.name || null }); }
      catch { finish(undefined, new Error("Не удалось прочитать файл. Выберите его ещё раз.")); }
    });
    input.addEventListener("cancel", () => finish({ status: "cancelled" }));
    window.addEventListener("focus", regain);
    document.body.appendChild(input);
    input.click();
  });
}
