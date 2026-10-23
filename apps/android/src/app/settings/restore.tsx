import { useState } from "react";
import { FileUp } from "lucide-react";
import { inspectPortableBackup, type MobileRepository, type PortableBackupPreview, type RestoreMode } from "@orion/mobile-core";
import { importBackup } from "../../backup";

export interface RestoreSettingsProps {
  repository: MobileRepository | null;
  /** Another write or export is running; restore controls stay disabled. */
  disabled: boolean;
  current: { tasks: number; notes: number; lists: number; transactions: number };
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onBusy: (busy: boolean) => void;
  onRestored: () => void;
}

const errorText = (error: unknown) => error instanceof Error && !("issues" in error)
  ? error.message : "Не удалось восстановить записи. Файл не изменён; проверьте его и повторите.";

function createdLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "дата неизвестна"
    : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function RestoreSettings({ repository, disabled, current, onError, onNotice, onBusy, onRestored }: RestoreSettingsProps) {
  const [picked, setPicked] = useState<{ raw: string; name: string | null; preview: PortableBackupPreview } | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const busy = working || disabled;

  async function pick() {
    if (!repository || busy) return;
    setWorking(true); onError(""); onNotice("");
    try {
      const file = await importBackup();
      if (file.status === "cancelled") { onNotice("Выбор файла отменён. Записи на телефоне не изменены."); return; }
      const checked = inspectPortableBackup(file.value);
      if (!checked.ok) { onError(checked.error); return; }
      setPicked({ raw: file.value, name: file.name, preview: checked.preview }); setMode("merge"); setConfirming(false);
      onNotice("Файл проверен. Ничего не записано — выберите способ восстановления.");
    } catch (error) { onError(errorText(error)); }
    finally { setWorking(false); }
  }

  async function restore() {
    if (!repository || !picked || busy) return;
    setWorking(true); onBusy(true); onError(""); onNotice("");
    try {
      const result = await repository.restoreBackup(picked.raw, mode);
      onRestored();
      const counts = `задачи: ${result.tasks} · заметки: ${result.notes} · списки: ${result.lists} · операции: ${result.financeTransactions}`;
      if (mode === "replace") onNotice(`Записи заменены содержимым файла. ${counts}. Очередь локальных изменений очищена.`);
      else if (!result.tasks && !result.notes && !result.lists && !result.financeTransactions) onNotice("Новых записей нет: всё из файла уже есть на телефоне.");
      else onNotice(`Добавлено из копии. ${counts}. Уже было на телефоне: ${result.skipped}.`);
      setPicked(null); setConfirming(false);
    } catch (error) { onError(errorText(error)); }
    finally { onBusy(false); setWorking(false); }
  }

  return <section className="settings-section" id="restore">
    <h2>Восстановление из копии</h2>
    <p>Выберите файл, сохранённый через «Сохранить резервную копию». Orion проверит его и покажет содержимое до записи.</p>
    {!picked && <button disabled={busy || !repository} onClick={() => void pick()}><FileUp size={18} />{working ? "Читаем файл…" : "Выбрать файл копии"}</button>}
    {picked && <div className="restore-preview">
      <p><strong>Файл проверен</strong>{picked.name ? <> · <span className="restore-file">{picked.name}</span></> : null}</p>
      <p className="helper">Создан {createdLabel(picked.preview.createdAt)}</p>
      <dl className="settings-facts">
        <div><dt>Задачи</dt><dd>{picked.preview.tasks}</dd></div>
        <div><dt>Заметки</dt><dd>{picked.preview.notes}</dd></div>
        <div><dt>Списки</dt><dd>{picked.preview.lists}</dd></div>
        <div><dt>Пункты списков</dt><dd>{picked.preview.listItems}</dd></div>
        <div><dt>Финансовые операции</dt><dd>{picked.preview.financeTransactions}</dd></div>
      </dl>
      {picked.preview.hasRemote && <p className="helper">Содержимое копии пространства ПК из файла не восстанавливается: связь с компьютером и данные на нём не изменятся.</p>}
      <fieldset disabled={busy}>
        <legend>Способ восстановления</legend>
        <div className="segments restore-modes">
          <label><input type="radio" name="restore-mode" checked={mode === "merge"} onChange={() => { setMode("merge"); setConfirming(false); }} /><span>Добавить недостающие</span></label>
          <label><input type="radio" name="restore-mode" checked={mode === "replace"} onChange={() => { setMode("replace"); setConfirming(false); }} /><span>Заменить записи</span></label>
        </div>
      </fieldset>
      <p className="helper">{mode === "merge"
        ? "Записи, которые уже есть на телефоне, останутся без изменений. Добавятся только отсутствующие. Ничего не удаляется."
        : "Записи на телефоне станут такими, как в файле. Настройки, сопряжение и черновики сохранятся."}</p>
      {mode === "merge"
        ? <button className="primary" disabled={busy} onClick={() => void restore()}>Добавить недостающие</button>
        : confirming ? <div className="restore-confirm" role="group" aria-label="Подтверждение замены">
          <p><strong>Заменить текущие записи содержимым файла?</strong></p>
          <p>Сейчас на телефоне: задачи {current.tasks} · заметки {current.notes} · списки {current.lists} · операции {current.transactions}. Они будут заменены.</p>
          <p className="helper">Очередь локальных изменений и порядок задач будут очищены. Настройки, сопряжение и копия пространства ПК не изменятся. Если текущие записи нужны, сначала сохраните резервную копию: отменить замену на телефоне нельзя.</p>
          <div className="update-actions">
            <button className="danger-action" disabled={busy} onClick={() => void restore()}>Заменить записи</button>
            <button disabled={busy} onClick={() => setConfirming(false)}>Отмена</button>
          </div>
        </div> : <button className="primary" disabled={busy} onClick={() => setConfirming(true)}>Заменить записи…</button>}
      {!confirming && <button className="text-button" disabled={busy} onClick={() => { setPicked(null); onNotice("Восстановление отменено. Записи на телефоне не изменены."); }}>Закрыть</button>}
    </div>}
  </section>;
}
