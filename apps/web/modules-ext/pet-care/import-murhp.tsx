"use client";

import { importMurhpInputSchema, parseMurhpBackup, petPlural, type ImportMurhpResult, type PetCarePet } from "@orion/shared-types";
import { Button, Modal, Switch, useToast } from "@orion/ui";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { describeError } from "../../lib/error-message";
import { useImportMurhp, useReadMurhpDatabase } from "./use-pet-care";

type Preview = { fileName: string; backup: ReturnType<typeof importMurhpInputSchema.parse>["backup"]; days: number; events: number; invalidRows: number };

/** Перенос дневника из приложения MurHP: копия «Настройки → Экспорт копии (.json)» или сама база `murhp.db`. Повторный импорт ничего не дублирует. */
export function PetMurhpImport({ open, onClose, workspaceId, pet }: { open: boolean; onClose: () => void; workspaceId: string; pet: PetCarePet }): React.ReactElement {
  const { toast } = useToast();
  const importer = useImportMurhp(workspaceId, pet.id);
  const reader = useReadMurhpDatabase(workspaceId, pet.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<ImportMurhpResult | null>(null);

  function reset(): void {
    setPreview(null);
    setError("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function pick(file: File | undefined): Promise<void> {
    reset();
    if (!file) return;
    // The desktop MurHP keeps its data in SQLite (murhp.db): the server reads it into the same JSON as «Экспорт копии».
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const isSqlite = new TextDecoder("latin1").decode(head).startsWith("SQLite format 3");
    try {
      const json: unknown = isSqlite ? (await reader.mutateAsync(file)).backup : JSON.parse(await file.text());
      const parsed = importMurhpInputSchema.safeParse({ backup: json });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Это не резервная копия MurHP");
        return;
      }
      const rows = parseMurhpBackup(parsed.data.backup);
      setPreview({ fileName: file.name, backup: parsed.data.backup, days: rows.days.length, events: rows.events.length, invalidRows: rows.invalidRows });
    } catch (failure) {
      setError(
        isSqlite
          ? `Не удалось прочитать базу MurHP: ${describeError(failure)}`
          : "Файл не читается. Нужна копия из MurHP (Настройки → Экспорт копии, .json) или сама база murhp.db."
      );
    }
  }

  async function run(): Promise<void> {
    if (!preview) return;
    try {
      setResult(await importer.mutateAsync({ backup: preview.backup, overwrite }));
      toast({ title: "Дневник MurHP перенесён", tone: "success" });
    } catch (failure) {
      toast({ title: "Не удалось импортировать", description: describeError(failure), tone: "danger" });
    }
  }

  function close(): void {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={`Импорт из MurHP → ${pet.name}`} description="Дни, события и пустые поля профиля питомца. Уже записанное в ORION по умолчанию не трогаем.">
      <div className="space-y-3 text-sm">
        <input ref={fileRef} type="file" accept=".json,application/json,.db,.sqlite,.sqlite3" className="sr-only" onChange={(event) => void pick(event.target.files?.[0])} aria-label="Файл копии MurHP" />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp className="h-4 w-4" /> {reader.isPending ? "Читаю базу…" : "Выбрать файл: копия .json или база murhp.db"}
        </Button>
        <p className="text-2xs text-muted-foreground">
          База десктопной версии MurHP лежит в %APPDATA%\com.murhp.diary\murhp.db — её можно выбрать напрямую, без экспорта.
        </p>
        {error ? <p className="text-destructive">{error}</p> : null}

        {preview && !result ? (
          <div className="space-y-3">
            <p>
              <b>{preview.fileName}</b>: {preview.days} {petPlural(preview.days, "день", "дня", "дней")}, {preview.events} {petPlural(preview.events, "событие", "события", "событий")}
              {preview.invalidRows > 0 ? `, нечитаемых строк: ${preview.invalidRows} (будут пропущены)` : ""}.
            </p>
            <label className="flex items-center gap-2">
              <Switch checked={overwrite} onChange={setOverwrite} label="Заменять дни, которые уже есть в ORION" />
              Заменять дни, которые уже есть в ORION
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>
                Отмена
              </Button>
              <Button onClick={() => void run()} disabled={importer.isPending || (preview.days === 0 && preview.events === 0)}>
                {importer.isPending ? "Переношу…" : "Импортировать"}
              </Button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-2">
            <ul className="list-inside list-disc text-muted-foreground">
              <li>Добавлено дней: {result.daysCreated}{result.daysUpdated > 0 ? `, заменено: ${result.daysUpdated}` : ""}{result.daysSkipped > 0 ? `, пропущено (уже были): ${result.daysSkipped}` : ""}</li>
              <li>Добавлено событий: {result.eventsCreated}{result.eventsSkipped > 0 ? `, повторов: ${result.eventsSkipped}` : ""}</li>
              {result.profileFilled.length > 0 ? <li>Заполнено в профиле: {result.profileFilled.join(", ")}</li> : null}
              {result.invalidRows > 0 ? <li>Нечитаемых строк пропущено: {result.invalidRows}</li> : null}
            </ul>
            <div className="flex justify-end">
              <Button onClick={close}>Готово</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
