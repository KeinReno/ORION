import { Capacitor, registerPlugin } from "@capacitor/core";
const native = registerPlugin<{ exportBackup(options: { value: string }): Promise<{ saved: boolean }> }>("OrionBackup");
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
