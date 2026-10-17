"use client";

import { ACCOUNT_CONTEXT_LABEL, type Account, type AccountContext, type AccountKind, type AccountVisibility } from "@orion/shared-types";
import { Button, Input, Select } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { parseMoneyInput, fromKopecks } from "../../lib/format";

export const ACCOUNT_KIND_ORDER: AccountKind[] = ["cash", "card", "savings", "other"];
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: "Наличные",
  card: "Карта",
  savings: "Накопительный",
  other: "Другое"
};

/**
 * Which currencies the form offers. ORION deliberately does not convert
 * between them (no rate source, see docs/HISTORY.md): the currency is a label on
 * the account, and every amount is still stored as an integer in minor units.
 */
export const ACCOUNT_CURRENCY_ORDER = ["RUB", "USD", "EUR", "KZT", "BYN"] as const;
const ACCOUNT_CURRENCY_LABEL: Record<string, string> = {
  RUB: "₽ Рубль",
  USD: "$ Доллар",
  EUR: "€ Евро",
  KZT: "₸ Тенге",
  BYN: "Br Белорусский рубль"
};

export interface AccountFormValues {
  name: string;
  kind: AccountKind;
  context: AccountContext;
  visibility: AccountVisibility;
  currency: string;
  startingBalance: number;
}

export function AccountForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: Account;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: AccountFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? "cash");
  const [context, setContext] = useState<AccountContext>(initial?.context ?? "personal");
  const [visibility, setVisibility] = useState<AccountVisibility>(initial?.visibility ?? "workspace");
  const [currency, setCurrency] = useState(initial?.currency ?? "RUB");
  const [startingBalance, setStartingBalance] = useState(fromKopecks(initial?.startingBalance));

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    void onSubmit({ name: name.trim(), kind, context, visibility, currency, startingBalance: parseMoneyInput(startingBalance) ?? 0 });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Название счёта" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Тип
          <Select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {ACCOUNT_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Валюта
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {ACCOUNT_CURRENCY_ORDER.map((code) => (
              <option key={code} value={code}>
                {ACCOUNT_CURRENCY_LABEL[code] ?? code}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Чьи деньги
        <Select value={context} onChange={(e) => setContext(e.target.value as AccountContext)}>
          {(Object.keys(ACCOUNT_CONTEXT_LABEL) as AccountContext[]).map((value) => (
            <option key={value} value={value}>
              {ACCOUNT_CONTEXT_LABEL[value]}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Кто видит счёт
        <Select value={visibility} onChange={(e) => setVisibility(e.target.value as AccountVisibility)}>
          <option value="workspace">Все в пространстве</option>
          <option value="private">Только я</option>
        </Select>
        {visibility === "private" ? (
          <span className="text-subtle-foreground">
            Счёт, его операции, правила и платежи не увидит никто, кроме вас: ни участники, ни владелец пространства. Итоги и отчёты у каждого считаются по тому, что ему видно. Если вы покинете пространство, счёт снова станет виден остальным.
          </span>
        ) : null}
      </label>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Начальный баланс, {currency}
        {initial ? (
          <span className="rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-sm text-subtle-foreground">
            Не меняется после создания — правьте через «Сверить баланс»
          </span>
        ) : (
          <Input inputMode="decimal" placeholder="0" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
        )}
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
