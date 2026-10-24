import type { useLan } from "./use-lan";
export function SyncStatus({ connection, remoteActive, finance, localCount, open }: { connection: ReturnType<typeof useLan>; remoteActive: boolean; finance: boolean; localCount: number; open: () => void }) {
  if (!connection.state?.paired) return null;
  const status = connection.client?.engine.status();
  let text = !connection.state.user ? "Сопряжение сохранено. Для обмена войдите в аккаунт ПК."
    : !connection.client ? "Сопряжение сохранено. Для обмена выберите пространство ПК."
    : finance ? "Финансы пока хранятся только на телефоне и не синхронизируются."
    : !remoteActive ? "Раздел «На телефоне» хранится отдельно. Для обмена откройте пространство ПК."
    : status?.phase === "syncing" ? "Обмен с ПК…"
    : status?.phase === "revoked" ? "Обмен остановлен: доступ к пространству недоступен."
    : status?.phase !== "idle" ? "Нет подтверждённого обмена с ПК. Правки остаются в локальной копии."
    : status.conflicts ? `Требуют решения конфликтов: ${status.conflicts}.`
    : status.pending ? `Ожидают отправки на ПК: ${status.pending}.`
    : status.asOf ? `Пространство ПК · последний обмен ${new Date(status.asOf).toLocaleTimeString("ru-RU")}. Очередь пуста.`
    : "Копия ещё не подтверждена компьютером.";
  if (connection.syncError && remoteActive) text = connection.syncError;
  return <div className="replica-banner" role="status"><div><p>{text}</p>{connection.client && localCount > 0 && !finance && <p className="helper">Отдельно на телефоне: {localCount} задач и заметок. Для переноса откройте «Скопировать записи телефона» в разделе связи.</p>}</div><button onClick={open}>Связь и обмен</button></div>;
}
