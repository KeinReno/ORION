"use client";

import {
  useAccounts,
  useAddWatchItem,
  useDeleteInvestmentTrade,
  useDeleteWatchItem,
  useFinanceCategories,
  useImportInvestmentTrades,
  useInvestmentTrades,
  useRecordTradeFee,
  useWatchItems
} from "@orion/core-react";
import {
  TRADE_MODE_LABEL,
  TRADE_MODES,
  compassBackupToEntries,
  computePositions,
  type InvestmentTrade,
  type TradeImportEntry,
  type TradeImportResult,
  type TradeMode
} from "@orion/shared-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  useToast
} from "@orion/ui";
import { CandlestickChart, ExternalLink, FileUp, MoreHorizontal, Plus, Star } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { compassInstrumentLink, DEFAULT_COMPASS_URL, normalizeCompassUrl, readCompassUrl, saveCompassUrl, useCompassStatus } from "../lib/compass-link";
import { CompassTab } from "./markets/compass-tab";
import { describeAuthError } from "../lib/error-message";
import { formatMoney, shortDateTime, toKopecks } from "../lib/format";
import { useActiveWorkspace } from "../lib/use-active-workspace";

type Tab = "compass" | "watch" | "trades" | "import";

const MARKET_HINTS = ["moex", "crypto"];

/** Quantities and prices come from a journal as plain numbers; show them without float tails. */
function num(value: number, digits = 8): string {
  return Number(value.toFixed(digits)).toLocaleString("ru-RU", { maximumFractionDigits: digits });
}

/**
 * «Рынки»: what you watch and the trades you loaded from Compass. Charts, quotes, strategies and back-tests stay in Compass —
 * this panel only keeps references and a journal, shows positions from REAL trades, and lets you (explicitly) record a trade's
 * fee as an expense. A trade is never an expense by itself.
 */
export function MarketsPanel(): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const [tab, setTab] = useState<Tab>("compass");
  const [compassUrl, setCompassUrl] = useState(() => readCompassUrl());
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const { state, recheck } = useCompassStatus(compassUrl);

  function saveUrl(): void {
    const normalized = normalizeCompassUrl(urlDraft);
    if (!normalized) return;
    setCompassUrl(normalized);
    saveCompassUrl(normalized);
    setEditingUrl(false);
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={CandlestickChart}
        title="Рынки"
        subtitle="Compass целиком: графики, сигналы, бэктесты, журнал. Рядом — наблюдение и сделки в ORION."
        actions={
          tab === "compass" ? undefined : (
          <div className="flex items-center gap-2">
            <Badge tone={state === "running" ? "success" : state === "offline" ? "neutral" : "neutral"}>
              {state === "running" ? "Compass запущен" : state === "checking" ? "Проверяю Compass…" : "Compass не запущен"}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => window.open(compassUrl, "_blank", "noopener")}>
              <ExternalLink className="h-4 w-4" /> Открыть Compass
            </Button>
            <IconButton label="Адрес Compass" size="sm" onClick={() => { setUrlDraft(compassUrl); setEditingUrl(true); }}>
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          </div>
          )
        }
      >
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "compass", label: "Compass" },
            { value: "watch", label: "Наблюдение" },
            { value: "trades", label: "Сделки" },
            { value: "import", label: "Импорт из Compass" }
          ]}
        />
      </PanelHeader>
      {tab === "compass" ? (
        <div className="min-h-0 flex-1">
          <CompassTab workspaceId={workspaceId} />
        </div>
      ) : (
      <PanelBody className="[container-type:inline-size]">
        {tab === "watch" ? <WatchTab workspaceId={workspaceId} compassUrl={compassUrl} compassRunning={state === "running"} /> : null}
        {tab === "trades" ? <TradesTab workspaceId={workspaceId} /> : null}
        {tab === "import" ? <ImportTab workspaceId={workspaceId} onDone={() => setTab("trades")} /> : null}
      </PanelBody>
      )}

      <Modal open={editingUrl} onClose={() => setEditingUrl(false)} title="Адрес Compass" size="sm">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Только адрес на этом компьютере (по умолчанию {DEFAULT_COMPASS_URL}). ORION не обращается к API Compass: он лишь проверяет, отвечает ли
            что-то по этому адресу, и открывает его.
          </p>
          <Input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} aria-label="Адрес Compass" />
          {urlDraft && !normalizeCompassUrl(urlDraft) ? <p className="text-label text-destructive">Нужен адрес вида http://127.0.0.1:8765</p> : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="subtle" onClick={() => setEditingUrl(false)}>
              Отмена
            </Button>
            <Button size="sm" disabled={!normalizeCompassUrl(urlDraft)} onClick={() => { saveUrl(); recheck(); }}>
              Сохранить
            </Button>
          </div>
        </div>
      </Modal>
    </PanelShell>
  );
}

function WatchTab({ workspaceId, compassUrl, compassRunning }: { workspaceId: string | undefined; compassUrl: string; compassRunning: boolean }): React.ReactElement {
  const { data: items, isLoading } = useWatchItems(workspaceId);
  const add = useAddWatchItem(workspaceId);
  const remove = useDeleteWatchItem(workspaceId);
  const { toast } = useToast();
  const [market, setMarket] = useState("moex");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await add.mutateAsync({ market, symbol, name, note: "" });
      setSymbol("");
      setName("");
    } catch (error) {
      toast({ title: "Не удалось добавить", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Рынок
          <Input list="markets-hints" value={market} onChange={(event) => setMarket(event.target.value)} className="w-28" maxLength={40} />
          <datalist id="markets-hints">
            {MARKET_HINTS.map((hint) => (
              <option key={hint} value={hint} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Инструмент
          <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="SBER" className="w-36" maxLength={40} />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-label text-subtle-foreground">
          Название (необязательно)
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>
        <Button type="submit" size="sm" disabled={!symbol.trim() || !market.trim() || add.isPending}>
          <Plus className="h-4 w-4" /> В наблюдение
        </Button>
      </form>

      {isLoading ? <Skeleton className="h-20" /> : null}
      {items && items.length === 0 ? (
        <EmptyState icon={Star} title="Список наблюдения пуст" description="Добавьте инструменты, за которыми следите. Графики и котировки смотрите в Compass." />
      ) : null}
      <ul className="space-y-2">
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <Card className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {item.symbol} <span className="text-xs font-normal text-muted-foreground">· {item.market}</span>
                </p>
                {item.name ? <p className="truncate text-xs text-muted-foreground">{item.name}</p> : null}
              </div>
              <a
                href={compassInstrumentLink(compassUrl, item.market, item.symbol)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-text hover:underline"
                title={compassRunning ? "Открыть Compass" : "Compass не запущен"}
              >
                В Compass
              </a>
              <IconButton label={`Убрать ${item.symbol}`} size="sm" onClick={() => void remove.mutateAsync(item.id)}>
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TradesTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { data: trades, isLoading } = useInvestmentTrades(workspaceId);
  const { data: accounts } = useAccounts(workspaceId);
  const { data: categories } = useFinanceCategories(workspaceId);
  const recordFee = useRecordTradeFee(workspaceId);
  const remove = useDeleteInvestmentTrade(workspaceId);
  const { toast } = useToast();
  const [mode, setMode] = useState<TradeMode | "all">("real");
  const [feeFor, setFeeFor] = useState<{ trade: InvestmentTrade; accountId: string; amount: string; categoryId: string } | null>(null);
  const [deleting, setDeleting] = useState<InvestmentTrade | null>(null);

  const positions = useMemo(() => computePositions(trades ?? []).filter((p) => p.qty > 0 || p.realized !== 0), [trades]);
  const shown = (trades ?? []).filter((trade) => mode === "all" || trade.mode === mode);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: trades?.length ?? 0 };
    for (const m of TRADE_MODES) result[m] = (trades ?? []).filter((t) => t.mode === m).length;
    return result;
  }, [trades]);

  async function confirmFee(): Promise<void> {
    if (!feeFor || !feeFor.accountId) return;
    const amount = toKopecks(feeFor.amount);
    if (amount === null) return;
    try {
      await recordFee.mutateAsync({ tradeId: feeFor.trade.id, input: { accountId: feeFor.accountId, amount, categoryId: feeFor.categoryId || null } });
      toast({ title: "Комиссия записана расходом", tone: "success" });
      setFeeFor(null);
    } catch (error) {
      toast({ title: "Комиссия не записана", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (isLoading) return <Skeleton className="h-32" />;
  if (!trades || trades.length === 0) {
    return <EmptyState icon={CandlestickChart} title="Сделок пока нет" description="Загрузите резервную копию журнала Compass на вкладке «Импорт из Compass»." />;
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {positions.length > 0 ? (
        <Card className="space-y-2">
          <p className="text-sm font-medium text-foreground">Позиции по реальным сделкам</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-subtle-foreground">
                <th className="py-1 font-normal">Инструмент</th>
                <th className="py-1 text-right font-normal">Кол-во</th>
                <th className="py-1 text-right font-normal">Средняя цена</th>
                <th className="py-1 text-right font-normal">Зафиксировано</th>
                <th className="py-1 text-right font-normal">Комиссии</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={`${position.market}:${position.symbol}`} className="border-t border-border">
                  <td className="py-1.5 text-foreground">
                    {position.symbol} <span className="text-muted-foreground">· {position.market}</span>
                    {position.inconsistent ? <Badge tone="warning" className="ml-2">не хватает покупок</Badge> : null}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{num(position.qty)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{position.avgPrice === null ? "—" : num(position.avgPrice, 4)}</td>
                  <td className={`py-1.5 text-right font-mono tabular-nums ${position.realized < 0 ? "text-destructive" : ""}`}>{num(position.realized, 2)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{num(position.fees, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-micro text-subtle-foreground">Суммы — в валюте рынка. Бумажные и исторические сделки сюда не входят.</p>
        </Card>
      ) : null}

      <SegmentedControl<TradeMode | "all">
        value={mode}
        onChange={setMode}
        size="sm"
        options={[
          ...TRADE_MODES.map((m) => ({ value: m, label: `${TRADE_MODE_LABEL[m]} · ${counts[m]}` })),
          { value: "all" as const, label: `Все · ${counts.all}` }
        ]}
      />

      <ul className="space-y-1.5">
        {shown.map((trade) => (
          <li key={trade.id}>
            <Card className="flex flex-wrap items-center gap-3 py-2.5">
              <Badge tone={trade.side === "buy" ? "success" : "warning"}>{trade.side === "buy" ? "покупка" : "продажа"}</Badge>
              <p className="min-w-0 flex-1 text-sm text-foreground">
                {trade.symbol} <span className="text-xs text-muted-foreground">· {trade.market} · {num(trade.qty)} × {num(trade.price, 4)}</span>
              </p>
              {trade.mode !== "real" ? <Badge tone="neutral">{TRADE_MODE_LABEL[trade.mode]}</Badge> : null}
              <span className="text-xs text-muted-foreground">
                {shortDateTime(trade.tradedAt)}
                {trade.fee > 0 ? ` · комиссия ${num(trade.fee, 4)}` : ""}
              </span>
              {trade.feeTransactionId ? <Badge tone="success">комиссия в финансах</Badge> : null}
              <DropdownMenu
                align="end"
                trigger={({ toggle }) => (
                  <IconButton label={`Действия: ${trade.symbol}`} size="sm" onClick={toggle}>
                    <MoreHorizontal className="h-4 w-4" />
                  </IconButton>
                )}
                items={[
                  ...(trade.mode === "real" && trade.fee > 0 && !trade.feeTransactionId
                    ? [{ label: "Записать комиссию в финансы…", onSelect: () => setFeeFor({ trade, accountId: "", amount: String(Math.round(trade.fee * 100) / 100), categoryId: "" }) }]
                    : []),
                  { label: "Удалить из журнала ORION", tone: "danger" as const, onSelect: () => setDeleting(trade) }
                ]}
              />
            </Card>
          </li>
        ))}
      </ul>

      <Modal open={feeFor !== null} onClose={() => setFeeFor(null)} title="Комиссия сделки — расходом" size="sm">
        {feeFor ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Покупка и продажа актива расходом не записываются — только комиссия, и только по вашему подтверждению. Комиссия в журнале ({num(feeFor.trade.fee, 4)}) — в
              валюте рынка; ORION курс не выдумывает, поэтому сумму в валюте выбранного счёта подтверждаете вы.
            </p>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Счёт
              <Select value={feeFor.accountId} onChange={(event) => setFeeFor({ ...feeFor, accountId: event.target.value })}>
                <option value="">Выберите счёт…</option>
                {(accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Сумма в валюте счёта
              <Input inputMode="decimal" value={feeFor.amount} onChange={(event) => setFeeFor({ ...feeFor, amount: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Категория расхода
              <Select value={feeFor.categoryId} onChange={(event) => setFeeFor({ ...feeFor, categoryId: event.target.value })}>
                <option value="">Без категории</option>
                {(categories ?? []).filter((c) => c.kind === "expense").map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </label>
            {feeFor.accountId ? (
              <p className="text-micro text-subtle-foreground">
                Будет записан расход {formatMoney(toKopecks(feeFor.amount) ?? 0, accounts?.find((a) => a.id === feeFor.accountId)?.currency)}.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="subtle" onClick={() => setFeeFor(null)}>
                Отмена
              </Button>
              <Button size="sm" disabled={!feeFor.accountId || toKopecks(feeFor.amount) === null || recordFee.isPending} onClick={() => void confirmFee()}>
                Записать
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Убрать сделку из журнала ORION?"
        description="В Compass она останется; записанная в финансы комиссия — тоже. Повторный импорт вернёт сделку."
        confirmLabel="Убрать"
        onConfirm={() => {
          if (deleting) void remove.mutateAsync(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function ImportTab({ workspaceId, onDone }: { workspaceId: string | undefined; onDone: () => void }): React.ReactElement {
  const importer = useImportInvestmentTrades(workspaceId);
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<TradeImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo<{ entries: TradeImportEntry[]; problems: string[]; skippedDeleted: number } | null>(() => {
    if (!text.trim()) return null;
    try {
      return compassBackupToEntries(JSON.parse(text));
    } catch {
      return { entries: [], problems: ["Файл не похож на JSON"], skippedDeleted: 0 };
    }
  }, [text]);

  async function run(dryRun: boolean): Promise<void> {
    if (!parsed || parsed.entries.length === 0) return;
    try {
      const result = await importer.mutateAsync({ source: "compass", dryRun, entries: parsed.entries });
      setReport(result);
      if (!dryRun) {
        toast({ title: `Загружено сделок: ${result.imported}`, description: result.duplicates ? `Уже были: ${result.duplicates}` : undefined, tone: "success" });
        setText("");
        setFileName(null);
        onDone();
      }
    } catch (error) {
      toast({ title: dryRun ? "Не удалось проверить файл" : "Импорт не выполнен", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="space-y-3">
        <p className="text-xs text-muted-foreground">
          В Compass: журнал → «Резервная копия» (<code>compass-journal-backup.json</code>). Загрузите файл сюда: удалённые записи пропускаются, режим каждой сделки
          (реальная / бумажная / историческая) сохраняется, повторная загрузка того же файла ничего не дублирует. Файл читается в браузере; планы сделок и всё остальное
          в ORION не попадает.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setText(await file.text());
              setReport(null);
            }}
          />
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
            <FileUp className="h-4 w-4" /> Выбрать файл
          </Button>
          <span className="text-xs text-muted-foreground">{fileName ?? "или вставьте JSON ниже"}</span>
        </div>
        <Textarea aria-label="JSON резервной копии Compass" rows={4} value={text} onChange={(event) => { setText(event.target.value); setFileName(null); setReport(null); }} />
      </Card>

      {parsed ? (
        <Card className="space-y-2">
          <p className="text-sm text-foreground">
            Прочитано сделок: <strong>{parsed.entries.length}</strong>
            {parsed.skippedDeleted ? <span className="text-muted-foreground"> · удалённых пропущено: {parsed.skippedDeleted}</span> : null}
            {parsed.problems.length ? <span className="text-destructive"> · не прочитано: {parsed.problems.length}</span> : null}
          </p>
          {parsed.problems.slice(0, 6).map((problem) => (
            <p key={problem} className="text-xs text-destructive">
              {problem}
            </p>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={parsed.entries.length === 0 || importer.isPending} onClick={() => void run(true)}>
              Проверить
            </Button>
            <Button size="sm" disabled={!report || !report.dryRun || report.imported === 0 || importer.isPending} onClick={() => void run(false)}>
              Загрузить{report?.dryRun ? ` (${report.imported})` : ""}
            </Button>
          </div>
        </Card>
      ) : null}

      {report ? (
        <Card className="space-y-1" aria-live="polite">
          <p className="text-sm font-medium text-foreground">{report.dryRun ? "Проверка: что будет загружено" : "Результат"}</p>
          <p className="text-xs text-muted-foreground">
            Новых: <strong className="text-foreground">{report.imported}</strong> · уже были: <strong className="text-foreground">{report.duplicates}</strong> — реальных{" "}
            {report.byMode.real}, бумажных {report.byMode.paper}, исторических {report.byMode.historical}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
