import { ChevronRight } from "lucide-react";
import type { useLan } from "./use-lan";
export function SyncStatus({ connection, remoteActive, finance, localCount, open }: { connection: ReturnType<typeof useLan>; remoteActive: boolean; finance: boolean; localCount: number; open: () => void }) {
  if (!connection.state?.paired || finance) return null; // Finance already states its local scope above the form.
  const status = connection.client?.engine.status();
  let text = !connection.state.user ? "Связь с ПК: войдите в аккаунт"
    : !connection.client ? "Связь с ПК: выберите пространство"
    : !remoteActive ? "На телефоне · отдельно от пространства ПК"
    : status?.phase === "syncing" ? "Обмен с ПК…"
    : status?.phase === "revoked" ? "Обмен остановлен: доступ к пространству недоступен."
    : status?.phase !== "idle" ? "Нет подтверждённого обмена с ПК. Правки остаются в локальной копии."
    : status.conflicts ? `Требуют решения конфликтов: ${status.conflicts}.`
    : status.pending ? `Ожидают отправки на ПК: ${status.pending}.`
    : status.asOf ? `Пространство ПК · последний обмен ${new Date(status.asOf).toLocaleTimeString("ru-RU")}. Очередь пуста.`
    : "Копия ещё не подтверждена компьютером.";
  if (connection.syncError && remoteActive) text = connection.syncError;
  return <div className="replica-banner" role="status"><div><p>{text}</p>{connection.client && localCount > 0 && !finance && <p className="helper">Отдельно на телефоне: {localCount} записей</p>}</div><button className="icon-button" aria-label="Связь и обмен" title="Связь и обмен" onClick={open}><ChevronRight size={20} /></button></div>;
}
