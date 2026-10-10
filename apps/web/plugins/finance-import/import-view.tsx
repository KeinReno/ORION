"use client";

import { useAccounts, useCreateFinanceCategory, useFinanceCategories, useImportTransactions } from "@orion/core-react";
import type { FinanceCategory, FinanceImportResult } from "@orion/shared-types";
import { Button, Card, EmptyState, Select, Textarea, useToast } from "@orion/ui";
import { FileUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { describeAuthError } from "../../lib/error-message";
import { buildImportRows, fileFingerprint, importRef, parseCsv, type ImportOptions } from "../../lib/finance-csv";
import { formatMoney } from "../../lib/format";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import type { FinanceTabSlotProps } from "../../lib/extensions/contracts";

const CREATE = "__create__";
const NONE = "";

/**
 * Plugin `finance-import`: the «Импорт» tab — a CSV of a bank statement or of FinControl into ONE account you pick.
 * Nothing is written until you have seen the dry run: the server computes exactly what a real run would do
 * (rows to add, duplicates of an earlier import, refused rows, totals), then the same request is repeated with
 * `dryRun: false`. Rows that cannot be read are listed, never guessed; the same file twice writes nothing the second time.
 */
export function ImportView({ workspaceId }: FinanceTabSlotProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const id = workspaceId ?? workspace?.id;
  const { data: accounts } = useAccounts(id);
  const { data: categories } = useFinanceCategories(id);
  const createCategory = useCreateFinanceCategory(id);
  const importer = useImportTransactions(id);
  const { toast } = useToast();

  const [accountId, setAccountId] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [direction, setDirection] = useState<ImportOptions["direction"]>("sign");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<FinanceImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? buildImportRows(parseCsv(text), { direction }) : null), [text, direction]);
  const byName = useMemo(() => {
    const map = new Map<string, FinanceCategory[]>();
    for (const category of categories ?? []) {
      const key = category.name.trim().toLowerCase();
      map.set(key, [...(map.get(key) ?? []), category]);
    }
    return map;
  }, [categories]);

  function reset(): void {
    setReport(null);
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
    setMapping({});
    reset();
  }

  /** What the file's category name means here: chosen by the user, else the same-named category if there is one. */
  function chosen(name: string, kind: "income" | "expense"): string {
    const pick = mapping[name];
    if (pick === NONE) return NONE;
    if (pick && pick !== CREATE) return pick;
    if (pick === CREATE) return CREATE;
    return byName.get(name.trim().toLowerCase())?.find((category) => category.kind === kind)?.id ?? NONE;
  }

  async function buildInput(dryRun: boolean): Promise<Parameters<typeof importer.mutateAsync>[0] | null> {
    if (!parsed || !accountId) return null;
    const fingerprint = await fileFingerprint(text);
    const created = new Map<string, string>();
    const rows = [];
    for (const row of parsed.rows) {
      let categoryId: string | null = null;
      if (row.categoryName) {
        const pick = chosen(row.categoryName, row.type);
        if (pick === CREATE) {
          const key = `${row.type}:${row.categoryName}`;
          if (!created.has(key)) {
            // A category is created only for a real run; a dry run leaves it out of the row and says so.
            if (dryRun) created.set(key, "");
            else created.set(key, (await createCategory.mutateAsync({ name: row.categoryName, kind: row.type })).id);
          }
          categoryId = created.get(key) || null;
        } else categoryId = pick || null;
      }
      rows.push({ ref: importRef(fingerprint, accountId, row.line), occurredAt: row.occurredAt, type: row.type, amount: row.amount, note: row.note, categoryId, tags: [] });
    }
    return { accountId, dryRun, rows };
  }

  async function run(dryRun: boolean): Promise<void> {
    setBusy(true);
    try {
      const input = await buildInput(dryRun);
      if (!input) return;
      const result = await importer.mutateAsync(input);
      setReport(result);
      if (!dryRun) {
        toast({ title: `Импортировано операций: ${result.imported}`, description: result.duplicates ? `Уже были в учёте: ${result.duplicates}` : undefined, tone: "success" });
        setText("");
        setFileName(null);
        setMapping({});
      }
    } catch (error) {
      toast({ title: dryRun ? "Не удалось проверить файл" : "Импорт не выполнен — ничего не записано", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const account = accounts?.find((item) => item.id === accountId);
  const currency = account?.currency ?? "RUB";
  const needsAccount = !accountId;
  const clientErrors = parsed?.errors ?? [];

  if (accounts && accounts.length === 0) {
    return <EmptyState icon={FileUp} title="Сначала заведите счёт" description="Импорт записывает операции в один выбранный счёт." />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Файл CSV из банка или выгрузка FinControl (<code>occurredAt, amount, type, note, categoryName</code>). Операции попадут в
          выбранный счёт; перед записью вы увидите проверку. Тот же файл второй раз ничего не добавит.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Счёт назначения
            <Select value={accountId} onChange={(event) => { setAccountId(event.target.value); reset(); }}>
              <option value="">Выберите счёт…</option>
              {(accounts ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.currency}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Знак суммы, если в файле нет колонки «тип»
            <Select value={direction} onChange={(event) => { setDirection(event.target.value as ImportOptions["direction"]); reset(); }}>
              <option value="sign">«−» расход, «+» доход</option>
              <option value="expense">Все суммы — расходы</option>
              <option value="income">Все суммы — доходы</option>
            </Select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(event) => void onFile(event.target.files?.[0])} />
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
            <FileUp className="h-4 w-4" /> Выбрать файл
          </Button>
          {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : <span className="text-xs text-subtle-foreground">или вставьте текст ниже</span>}
        </div>
        <Textarea
          aria-label="Содержимое CSV"
          rows={5}
          value={text}
          onChange={(event) => { setText(event.target.value); setFileName(null); setMapping({}); reset(); }}
          placeholder={"occurredAt,amount,type,note,categoryName\n2026-03-05,500.00,EXPENSE,Хлеб,Продукты"}
        />
      </Card>

      {parsed ? (
        <Card className="space-y-3">
          <p className="text-sm text-foreground">
            Прочитано строк: <strong>{parsed.rows.length}</strong>
            {clientErrors.length > 0 ? <span className="text-destructive"> · не прочитано: {clientErrors.length}</span> : null}
          </p>
          {clientErrors.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-destructive">
              {clientErrors.slice(0, 8).map((error) => (
                <li key={error.line}>
                  Строка {error.line}: {error.reason}
                </li>
              ))}
              {clientErrors.length > 8 ? <li>… и ещё {clientErrors.length - 8}</li> : null}
            </ul>
          ) : null}

          {parsed.categoryNames.length > 0 ? (
            <div className="space-y-2">
              <p className="text-label text-muted-foreground">Категории из файла</p>
              {parsed.categoryNames.map((name) => {
                const kinds = [...new Set(parsed.rows.filter((row) => row.categoryName === name).map((row) => row.type))];
                const pick = mapping[name] ?? chosen(name, kinds[0] ?? "expense");
                return (
                  <label key={name} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-40 truncate text-foreground">{name}</span>
                    <Select value={pick} onChange={(event) => { setMapping({ ...mapping, [name]: event.target.value }); reset(); }} className="max-w-xs">
                      <option value={NONE}>Без категории</option>
                      <option value={CREATE}>Создать «{name}»</option>
                      {(categories ?? []).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name} ({category.kind === "income" ? "доход" : "расход"})
                        </option>
                      ))}
                    </Select>
                  </label>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy || needsAccount || parsed.rows.length === 0} onClick={() => void run(true)}>
              Проверить
            </Button>
            <Button size="sm" disabled={busy || needsAccount || !report || report.dryRun === false || report.imported === 0} onClick={() => void run(false)}>
              Импортировать{report && report.dryRun ? ` (${report.imported})` : ""}
            </Button>
            {needsAccount ? <span className="text-xs text-subtle-foreground">Выберите счёт назначения</span> : null}
          </div>
        </Card>
      ) : null}

      {report ? (
        <Card className="space-y-1.5" aria-live="polite">
          <p className="text-sm font-medium text-foreground">{report.dryRun ? "Проверка: что будет записано" : "Результат импорта"}</p>
          <p className="text-xs text-muted-foreground">
            Операций: <strong className="text-foreground">{report.imported}</strong> · уже были в учёте (пропущены):{" "}
            <strong className="text-foreground">{report.duplicates}</strong> · отклонено сервером:{" "}
            <strong className={report.errors.length ? "text-destructive" : "text-foreground"}>{report.errors.length}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Доходы {formatMoney(report.incomeTotal, currency)} · расходы {formatMoney(report.expenseTotal, currency)} · счёт «{account?.name}»
          </p>
          {report.errors.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-destructive">
              {report.errors.slice(0, 8).map((error) => (
                <li key={error.line}>
                  Операция {error.line}: {error.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
