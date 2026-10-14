"use client";

import { useImportUtilityMonths } from "@orion/core-react";
import type { ImportUtilityMonthsInput, ImportUtilityMonthsResult } from "@orion/shared-types";
import { Button, Modal, Textarea, useToast } from "@orion/ui";
import { useState } from "react";
import { parseUtilityTable } from "./table-import";

const money = (minor: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(minor / 100);

export function ImportUtilityTable({ workspaceId, homeId, open, onClose, onImported }: { workspaceId: string | undefined; homeId: string; open: boolean; onClose: () => void; onImported: (period: string) => void }): React.ReactElement {
  const { toast } = useToast();
  const importMonths = useImportUtilityMonths(workspaceId, homeId);
  const [text, setText] = useState("");
  const [input, setInput] = useState<ImportUtilityMonthsInput | null>(null);
  const [preview, setPreview] = useState<ImportUtilityMonthsResult | null>(null);
  const [error, setError] = useState("");
  const fresh = preview?.rows.filter((row) => !row.exists).length ?? 0;

  async function check(): Promise<void> {
    setError(""); setInput(null); setPreview(null);
    try {
      const parsed: ImportUtilityMonthsInput = { dryRun: true, rows: parseUtilityTable(text) };
      const result = await importMonths.mutateAsync(parsed);
      setInput(parsed); setPreview(result);
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
  }

  async function save(): Promise<void> {
    if (!input || !preview || fresh === 0) return;
    try {
      const result = await importMonths.mutateAsync({ ...input, dryRun: false });
      toast({ title: `Перенесено месяцев: ${result.imported}`, tone: "success" });
      const first = result.rows.find((row) => !row.exists)?.period;
      onClose();
      if (first) onImported(first);
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
  }

  return <Modal open={open} onClose={onClose} title="Перенести историю коммуналки" size="lg">
    <div className="space-y-4">
      <p className="text-label text-muted-foreground">Скопируйте таблицу с заголовками из Google Таблиц и вставьте сюда. Нужны «Период», «КВп» и колонки компаний. «Итого» и «Итоговая» сверяются с расчётом ORION. Существующие месяцы не заменяются.</p>
      <Textarea aria-label="Таблица коммунальных начислений" value={text} onChange={(event) => { setText(event.target.value); setInput(null); setPreview(null); setError(""); }} rows={7} placeholder={"Период\tТулаводоканал\tТНС энерго\tИтого\tКВп\tИтоговая\nАвгуст 2026\t1316,81\t1067,04\t2383,85\t18000\t20383,85"} />
      <p className="text-2xs text-subtle-foreground">Поддерживаются вставка из Google Таблиц и CSV с разделителем «;». Все перенесённые суммы остаются черновиками до сверки с квитанциями.</p>
      {error ? <p role="alert" className="text-label text-destructive">{error}</p> : null}
      {preview ? <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-2xs"><thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="p-2">Месяц</th><th className="p-2">Коммуналка</th><th className="p-2">Итог</th><th className="p-2">Проверка</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.period} className="border-t border-border/60"><td className="p-2 tabular-nums">{row.period}</td><td className="p-2 tabular-nums">{money(row.utilityMinor)}</td><td className="p-2 tabular-nums">{money(row.grandTotalMinor)}</td><td className="p-2">{row.exists ? "Уже есть · пропуск" : row.utilityDifferenceMinor || row.grandDifferenceMinor ? `Расхождение: ${money(row.utilityDifferenceMinor ?? 0)} / ${money(row.grandDifferenceMinor ?? 0)}` : "Сходится"}</td></tr>)}</tbody></table>
      </div> : null}
      {preview ? <p className="text-label text-muted-foreground">Новых месяцев: {fresh}. Уже есть: {preview.rows.length - fresh}. Расхождения видны в таблице и сохраняются для проверки.</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onClose}>Закрыть</Button><Button variant="outline" onClick={() => void check()} disabled={!text.trim() || importMonths.isPending}>Проверить таблицу</Button>{preview ? <Button onClick={() => void save()} disabled={fresh === 0 || importMonths.isPending}>Перенести {fresh}</Button> : null}</div>
    </div>
  </Modal>;
}
