"use client";

import { useAccounts, useDeleteExchangeRate, useExchangeRates, useSaveExchangeRate } from "@orion/core-react";
import { formatRate, parseRate } from "@orion/shared-types";
import { Button, Card, EmptyState, IconButton, Input, Select, Skeleton, useToast } from "@orion/ui";
import { Coins, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { FinanceTabSlotProps } from "../../lib/extensions/contracts";
import { describeAuthError, shortDate, useActiveWorkspace } from "../../lib/extensions/host-api";

const COMMON = ["RUB", "USD", "EUR", "KZT", "BYN", "CNY", "TRY", "GBP"];

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Plugin `finance-exchange-rates`: rates you type yourself, one per pair per day, valid from that day. There is no
 * external source on purpose — every converted figure in «Капитал» can be traced to a rate and a date from this list.
 */
export function RatesView({ workspaceId }: FinanceTabSlotProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const id = workspaceId ?? workspace?.id;
  const { data: rates, isLoading } = useExchangeRates(id);
  const { data: accounts } = useAccounts(id);
  const save = useSaveExchangeRate(id);
  const remove = useDeleteExchangeRate(id);
  const { toast } = useToast();

  // Offer the currencies the accounts actually use first: those are the ones that need a rate.
  const accountCurrencies = useMemo(() => [...new Set((accounts ?? []).map((account) => account.currency))], [accounts]);
  const options = useMemo(() => [...new Set([...accountCurrencies, ...COMMON])], [accountCurrencies]);
  const foreign = accountCurrencies.find((code) => code !== "RUB") ?? "USD";
  const [base, setBase] = useState(foreign);
  const [quote, setQuote] = useState(accountCurrencies.includes("RUB") || accountCurrencies.length === 0 ? "RUB" : (accountCurrencies[0] ?? "RUB"));
  const [value, setValue] = useState("");
  const [day, setDay] = useState(today());
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const rateMicro = parseRate(value);
    if (!rateMicro) return setError("Курс — положительное число, например 92,5");
    if (base === quote) return setError("Выберите две разные валюты");
    try {
      await save.mutateAsync({ base, quote, rateMicro, day });
      setValue("");
      setError(null);
      toast({ title: `Курс записан: 1 ${base} = ${formatRate(rateMicro)} ${quote}`, tone: "success" });
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  if (isLoading) return <Skeleton className="h-32" />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Курсы вводите сами: ORION не берёт их из интернета, поэтому каждую пересчитанную сумму можно проверить по этому списку. Курс действует с указанной даты и до следующего.
      </p>

      <Card>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            1 единица
            <Select value={base} onChange={(e) => setBase(e.target.value)} aria-label="Валюта, которую оцениваем">
              {options.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            стоит
            <Input inputMode="decimal" className="w-28" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} placeholder="92,5" aria-label="Курс" />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            в валюте
            <Select value={quote} onChange={(e) => setQuote(e.target.value)} aria-label="Валюта, в которой выражен курс">
              {options.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            с даты
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-36" />
          </label>
          <Button type="submit" size="sm" disabled={save.isPending}>Записать курс</Button>
        </form>
        {error ? <p className="mt-2 text-2xs text-destructive">{error}</p> : null}
      </Card>

      {(rates ?? []).length === 0 ? (
        <EmptyState icon={Coins} title="Курсов пока нет" description="Если у вас счета в разных валютах, введите курс — и «Капитал» покажет общий итог в одной валюте." />
      ) : (
        <ul className="space-y-1">
          {(rates ?? []).map((rate) => (
            <li key={rate.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 text-foreground">
                1 {rate.base} = <span className="font-mono tabular-nums">{formatRate(rate.rateMicro)}</span> {rate.quote}
              </span>
              <span className="text-subtle-foreground">с {shortDate(`${rate.day}T12:00:00.000Z`)}</span>
              <IconButton label={`Удалить курс ${rate.base}/${rate.quote} от ${rate.day}`} size="sm" tone="danger" onClick={() => remove.mutate(rate.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
