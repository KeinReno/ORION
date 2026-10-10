import { z } from "zod";

/**
 * «Рынки и инвестиции». ORION хранит ссылки на инструменты (список наблюдения) и ЖУРНАЛ сделок, который пользователь
 * сам загрузил из резервной копии Compass. Котировки, графики, стратегии и бэктесты остаются в Compass: ORION их не
 * считает и не подменяет. Режим сделки (`real` / `paper` / `historical`) сохраняется и никогда не стирается:
 * бумажные и исторические сделки не входят в позиции и никогда не попадают в финансы.
 */

export const TRADE_MODES = ["real", "paper", "historical"] as const;
export const tradeModeSchema = z.enum(TRADE_MODES);
export type TradeMode = z.infer<typeof tradeModeSchema>;

export const TRADE_MODE_LABEL: Record<TradeMode, string> = {
  real: "Реальные",
  paper: "Бумажные",
  historical: "Исторические"
};

export const watchItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** Рынок в терминах Compass (moex, crypto, …) или любой свой короткий ярлык. */
  market: z.string(),
  symbol: z.string(),
  name: z.string(),
  note: z.string(),
  createdAt: z.string()
});
export type WatchItem = z.infer<typeof watchItemSchema>;

export const createWatchItemInputSchema = z.object({
  market: z.string().trim().min(1, "Укажите рынок").max(40),
  symbol: z.string().trim().min(1, "Укажите инструмент").max(40),
  name: z.string().trim().max(120).default(""),
  note: z.string().max(2000).default("")
});
export type CreateWatchItemInput = z.infer<typeof createWatchItemInputSchema>;

export const updateWatchItemInputSchema = z.object({
  name: z.string().trim().max(120).optional(),
  note: z.string().max(2000).optional()
});
export type UpdateWatchItemInput = z.infer<typeof updateWatchItemInputSchema>;

export const investmentTradeSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** Идентификатор записи в источнике (для Compass — её uid): по нему повторный импорт ничего не дублирует. */
  externalUid: z.string(),
  source: z.string(),
  mode: tradeModeSchema,
  market: z.string(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  qty: z.number(),
  price: z.number(),
  fee: z.number(),
  tradedAt: z.string(),
  note: z.string(),
  /** Операция в «Финансах», в которую записана комиссия этой сделки; null — не записывалась. */
  feeTransactionId: z.string().nullable(),
  importedAt: z.string()
});
export type InvestmentTrade = z.infer<typeof investmentTradeSchema>;

export const TRADE_IMPORT_MAX = 2000;

export const tradeImportEntrySchema = z.object({
  uid: z.string().min(1).max(120),
  mode: tradeModeSchema,
  market: z.string().trim().min(1).max(40),
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive().finite(),
  price: z.number().positive().finite(),
  fee: z.number().min(0).finite().default(0),
  /** Время сделки, мс UTC (как в Compass). */
  ts: z.number().int().positive(),
  note: z.string().max(2000).default("")
});
export type TradeImportEntry = z.infer<typeof tradeImportEntrySchema>;

export const tradeImportInputSchema = z.object({
  source: z.literal("compass"),
  dryRun: z.boolean().default(true),
  entries: z.array(tradeImportEntrySchema).min(1, "В файле нет сделок").max(TRADE_IMPORT_MAX, `Не больше ${TRADE_IMPORT_MAX} сделок за раз`)
});
export type TradeImportInput = z.infer<typeof tradeImportInputSchema>;

export const tradeImportResultSchema = z.object({
  dryRun: z.boolean(),
  imported: z.number().int(),
  duplicates: z.number().int(),
  byMode: z.object({ real: z.number().int(), paper: z.number().int(), historical: z.number().int() })
});
export type TradeImportResult = z.infer<typeof tradeImportResultSchema>;

/**
 * Комиссия реальной сделки → расход в «Финансах». Только по явному действию: счёт и сумму (в валюте этого счёта)
 * подтверждает пользователь, потому что комиссия в Compass — в валюте рынка, а курс ORION не выдумывает.
 * Покупка и продажа актива расходом/доходом НЕ записываются — это инвестиционное событие, а не трата.
 */
export const recordTradeFeeInputSchema = z.object({
  accountId: z.string(),
  /** В минорных единицах валюты выбранного счёта. */
  amount: z.number().int().positive().max(2_000_000_000),
  categoryId: z.string().nullable().optional()
});
export type RecordTradeFeeInput = z.infer<typeof recordTradeFeeInputSchema>;

/** Резервная копия журнала Compass (`/api/journal/backup.json`) → записи для импорта. Нечитаемое — в `problems`. */
export function compassBackupToEntries(payload: unknown): { entries: TradeImportEntry[]; problems: string[]; skippedDeleted: number } {
  const problems: string[] = [];
  const entries: TradeImportEntry[] = [];
  let skippedDeleted = 0;
  const data = payload as { format?: unknown; version?: unknown; entries?: unknown } | null;
  if (!data || typeof data !== "object" || data.format !== "compass-journal" || (data.version !== 1 && data.version !== 2)) {
    return { entries, problems: ["Это не резервная копия журнала Compass или её версия не поддерживается"], skippedDeleted };
  }
  if (!Array.isArray(data.entries)) return { entries, problems: ["В резервной копии нет списка сделок"], skippedDeleted };
  data.entries.forEach((raw, index) => {
    const item = raw as Record<string, unknown> | null;
    if (!item || typeof item !== "object") {
      problems.push(`Запись ${index + 1}: повреждена`);
      return;
    }
    if (item.deleted_at !== null && item.deleted_at !== undefined) {
      skippedDeleted += 1;
      return;
    }
    const parsed = tradeImportEntrySchema.safeParse({
      uid: item.uid,
      mode: item.mode ?? "real",
      market: item.market,
      symbol: item.symbol,
      side: item.side,
      qty: item.qty,
      price: item.price,
      fee: item.fee ?? 0,
      ts: item.ts,
      note: typeof item.note === "string" ? item.note : ""
    });
    if (parsed.success) entries.push(parsed.data);
    else problems.push(`Запись ${index + 1} (${String(item.symbol ?? "?")}): ${parsed.error.issues[0]?.message ?? "не читается"}`);
  });
  return { entries, problems, skippedDeleted };
}

export interface InvestmentPosition {
  market: string;
  symbol: string;
  qty: number;
  /** Средняя цена входа по открытому остатку; null, когда позиции нет. */
  avgPrice: number | null;
  /** Реализованный результат закрытых частей без комиссий (в валюте рынка) и сумма комиссий. */
  realized: number;
  fees: number;
  /** Продано больше, чем куплено в журнале — данных не хватает, позиция недостоверна. */
  inconsistent: boolean;
}

/**
 * Позиции по РЕАЛЬНЫМ сделкам методом средней цены (без плеча и шорта — как и журнал Compass). Бумажные и исторические
 * сделки сюда не попадают по построению. Чистая функция, тесты — markets.test.ts.
 */
export function computePositions(trades: readonly Pick<InvestmentTrade, "mode" | "market" | "symbol" | "side" | "qty" | "price" | "fee" | "tradedAt">[]): InvestmentPosition[] {
  const map = new Map<string, InvestmentPosition & { cost: number }>();
  const ordered = trades.filter((trade) => trade.mode === "real").sort((a, b) => a.tradedAt.localeCompare(b.tradedAt));
  for (const trade of ordered) {
    const key = `${trade.market}\u0000${trade.symbol}`;
    const position = map.get(key) ?? { market: trade.market, symbol: trade.symbol, qty: 0, avgPrice: null, realized: 0, fees: 0, inconsistent: false, cost: 0 };
    position.fees += trade.fee;
    if (trade.side === "buy") {
      position.cost += trade.qty * trade.price;
      position.qty += trade.qty;
    } else {
      const sold = Math.min(trade.qty, position.qty);
      const avg = position.qty > 0 ? position.cost / position.qty : 0;
      position.realized += sold * (trade.price - avg);
      position.cost -= sold * avg;
      position.qty -= sold;
      if (trade.qty > sold + 1e-9) position.inconsistent = true;
    }
    if (position.qty < 1e-9) {
      position.qty = 0;
      position.cost = 0;
    }
    position.avgPrice = position.qty > 0 ? position.cost / position.qty : null;
    map.set(key, position);
  }
  return [...map.values()].map(({ cost: _cost, ...position }) => position);
}
