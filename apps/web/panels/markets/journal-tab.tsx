"use client";

import { Badge, Button, EmptyState, IconButton, Input, Select, Skeleton, Textarea, useToast } from "@orion/ui";
import { BookOpen, Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/compass/api";
import { fmtDateTime, fmtNum, fmtPrice, pnlClass } from "../../lib/compass/format";
import type { JournalEntry, JournalMode, MarketId } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useSyncCompassJournal } from "@orion/core-react";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

const MODE_LABEL: Record<JournalMode, string> = { real: "Реальная", paper: "Учебная", historical: "Историческая" };

/** Журнал Compass: сделки, позиции по средней цене, удалённые (восстановление), резервная копия. Данные — в движке этого пространства. */
export function JournalTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const syncToOrion = useSyncCompassJournal(workspaceId);
  const [mode, setMode] = useState<JournalMode>("real");
  const [showDeleted, setShowDeleted] = useState(false);
  const entries = useCompassQuery(workspaceId, ["journal", mode], () => api.journal({ mode }));
  const positions = useCompassQuery(workspaceId, ["positions", mode], () => api.positions(mode));
  const deleted = useCompassQuery(workspaceId, ["journal-deleted"], () => api.deletedJournal(), { enabled: showDeleted });
  const restoreInput = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await action();
      await invalidate();
      // Журнал Compass и «Сделки» ORION не расходятся: после каждого изменения записи переносятся (идемпотентно по uid).
      syncToOrion.mutate();
      toast({ title: done, tone: "success" });
    } catch (error) {
      toast({ title: "Не получилось", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function downloadBackup(): Promise<void> {
    try {
      const backup = await api.journalBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "compass-journal-backup.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "Не удалось скачать копию", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Режим журнала" value={mode} onChange={(event) => setMode(event.target.value as JournalMode)} className="w-auto">
          {(Object.keys(MODE_LABEL) as JournalMode[]).map((key) => (
            <option key={key} value={key}>
              {MODE_LABEL[key]}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" onClick={() => setShowDeleted((value) => !value)}>
          {showDeleted ? "Скрыть удалённые" : "Удалённые"}
        </Button>
        <input
          ref={restoreInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            await run(async () => {
              const result = await api.restoreJournalBackup(JSON.parse(await file.text()));
              toast({ title: `Из копии добавлено: ${result.added}`, description: `Пропущено: ${result.skipped}`, tone: "success" });
            }, "Журнал восстановлен из копии");
          }}
        />
        <Button size="sm" variant="outline" onClick={() => void downloadBackup()}>
          <Download className="h-4 w-4" /> Скачать копию
        </Button>
        <Button size="sm" variant="outline" onClick={() => restoreInput.current?.click()}>
          <Upload className="h-4 w-4" /> Восстановить из копии
        </Button>
      </div>

      <AddEntryForm onAdd={(entry) => run(() => api.addJournal({ ...entry, mode }), "Сделка записана")} mode={mode} />

      <section aria-label="Позиции">
        <h3 className="mb-2 text-sm font-medium">Позиции ({MODE_LABEL[mode].toLowerCase()})</h3>
        {positions.isLoading ? <Skeleton className="h-16" /> : null}
        {positions.data && positions.data.length === 0 ? <p className="text-label text-subtle-foreground">Открытых позиций нет.</p> : null}
        {positions.data && positions.data.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-label text-subtle-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">Инструмент</th>
                  <th className="px-3 py-2 text-right font-normal">Кол-во</th>
                  <th className="px-3 py-2 text-right font-normal">Средняя</th>
                  <th className="px-3 py-2 text-right font-normal">Результат</th>
                  <th className="px-3 py-2 text-right font-normal">Комиссии</th>
                  <th className="px-3 py-2 text-right font-normal">Сделок</th>
                </tr>
              </thead>
              <tbody>
                {positions.data.map((position) => (
                  <tr key={`${position.market}:${position.symbol}`} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      {position.symbol} <span className="text-label text-subtle-foreground">{position.market}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(position.qty, 8)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPrice(position.avg_price)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${pnlClass(position.realized_pnl)}`}>{fmtNum(position.realized_pnl)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(position.fees)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{position.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-label="Сделки">
        <h3 className="mb-2 text-sm font-medium">Сделки</h3>
        {entries.isLoading ? <Skeleton className="h-24" /> : null}
        {entries.error ? <EmptyState tone="danger" title="Журнал не загрузился" description={describeAuthError(entries.error)} /> : null}
        {entries.data && entries.data.length === 0 ? (
          <EmptyState icon={BookOpen} title="Записей пока нет" description="Запишите сделку формой выше или восстановите журнал из резервной копии." />
        ) : null}
        <ul className="space-y-1.5">
          {(entries.data ?? []).map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              action={
                <IconButton label={`Удалить запись ${entry.symbol}`} size="sm" onClick={() => void run(() => api.removeJournal(entry.id), "Запись удалена (её можно вернуть)")}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              }
            />
          ))}
        </ul>
      </section>

      {showDeleted ? (
        <section aria-label="Удалённые записи">
          <h3 className="mb-2 text-sm font-medium">Удалённые</h3>
          {deleted.data && deleted.data.length === 0 ? <p className="text-label text-subtle-foreground">Удалённых записей нет.</p> : null}
          <ul className="space-y-1.5">
            {(deleted.data ?? []).map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                action={
                  <IconButton label={`Вернуть запись ${entry.symbol}`} size="sm" onClick={() => void run(() => api.restoreJournalEntry(entry.id), "Запись возвращена")}>
                    <RotateCcw className="h-4 w-4" />
                  </IconButton>
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function EntryRow({ entry, action }: { entry: JournalEntry; action: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm">
      <Badge tone={entry.side === "buy" ? "success" : "danger"}>{entry.side === "buy" ? "Покупка" : "Продажа"}</Badge>
      <span className="font-medium">{entry.symbol}</span>
      <span className="text-label text-subtle-foreground">{entry.market}</span>
      <span className="tabular-nums">
        {fmtNum(entry.qty, 8)} × {fmtPrice(entry.price)}
      </span>
      {entry.fee > 0 ? <span className="text-label text-subtle-foreground">комиссия {fmtNum(entry.fee, 4)}</span> : null}
      {entry.planned_stop ? <span className="text-label text-subtle-foreground">стоп {fmtPrice(entry.planned_stop)}</span> : null}
      <span className="ml-auto text-label text-subtle-foreground">{fmtDateTime(entry.ts)}</span>
      {entry.note || entry.reason ? <p className="basis-full text-label text-muted-foreground">{[entry.reason, entry.note].filter(Boolean).join(" · ")}</p> : null}
      {action}
    </li>
  );
}

function AddEntryForm({
  onAdd,
  mode
}: {
  onAdd: (entry: { market: MarketId; symbol: string; side: "buy" | "sell"; qty: number; price: number; fee: number; ts: number; note: string; reason: string; planned_stop: number | null }) => Promise<void>;
  mode: JournalMode;
}): React.ReactElement {
  const [market, setMarket] = useState<MarketId>("moex");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [stop, setStop] = useState("");
  const [note, setNote] = useState("");

  const valid = symbol.trim() !== "" && Number(qty) > 0 && Number(price) > 0 && !(fee !== "" && Number(fee) < 0);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
    await onAdd({
      market,
      symbol: symbol.trim().toUpperCase(),
      side,
      qty: Number(qty),
      price: Number(price),
      fee: fee === "" ? 0 : Number(fee),
      ts: Date.now(),
      note,
      reason: "",
      planned_stop: stop === "" ? null : Number(stop)
    });
    setSymbol("");
    setQty("");
    setPrice("");
    setFee("");
    setStop("");
    setNote("");
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-2 rounded-xl border border-border p-3" aria-label="Записать сделку">
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Рынок
        <Select value={market} onChange={(event) => setMarket(event.target.value as MarketId)} className="w-28">
          <option value="moex">МосБиржа</option>
          <option value="crypto">Крипта</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Инструмент
        <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder={market === "moex" ? "SBER" : "BTC/USDT"} className="w-32" />
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Сторона
        <Select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")} className="w-28">
          <option value="buy">Покупка</option>
          <option value="sell">Продажа</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Количество
        <Input inputMode="decimal" type="number" step="any" min="0" value={qty} onChange={(event) => setQty(event.target.value)} className="w-28" />
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Цена
        <Input inputMode="decimal" type="number" step="any" min="0" value={price} onChange={(event) => setPrice(event.target.value)} className="w-28" />
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Комиссия
        <Input inputMode="decimal" type="number" step="any" min="0" value={fee} onChange={(event) => setFee(event.target.value)} className="w-24" />
      </label>
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Плановый стоп
        <Input inputMode="decimal" type="number" step="any" min="0" value={stop} onChange={(event) => setStop(event.target.value)} className="w-28" />
      </label>
      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-label text-subtle-foreground">
        Заметка
        <Textarea rows={1} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <Button type="submit" size="sm" disabled={!valid} title={`Режим: ${MODE_LABEL[mode].toLowerCase()}`}>
        Записать
      </Button>
    </form>
  );
}
