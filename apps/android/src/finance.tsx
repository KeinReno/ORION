import { DepthCard } from "./depth-card";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { localDate, parseMoney, resolveFinanceDate, type FinanceDraft, type MobileFinance } from "@orion/mobile-core";
import { useToday } from "./use-today";
import type { Transaction } from "@orion/shared-types";

const money = (amount: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(amount / 100);
function fresh(finance: MobileFinance, type: "expense" | "income" = "expense"): FinanceDraft {
  return { dateMode: "today", id: crypto.randomUUID(), type, amount: "", accountId: finance.lastAccountId ?? finance.accounts[0]!.id,
    categoryId: finance.categories.find((item) => item.kind === type)!.id, note: "", date: localDate() };
}
function FinanceDetails({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  return <details className="finance-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>{children}</details>;
}
export function FinancePage({ finance, busy, saveDraft, save, remove, initialType }: {
  initialType?: "income" | "expense"; finance: MobileFinance; busy: boolean; saveDraft: (draft: FinanceDraft | null) => Promise<void>;
  save: (draft: FinanceDraft) => Promise<boolean>; remove: (id: string) => Promise<boolean>;
}) {
  const today = useToday();
  const historyTitle = useRef<HTMLHeadingElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const [historyError, setHistoryError] = useState("");
  const historyWarning = useRef<HTMLDivElement>(null);
  function showHistoryWarning() { historyWarning.current?.focus(); historyWarning.current?.scrollIntoView({ block: "center" }); }
  useEffect(() => { if (historyError) showHistoryWarning(); }, [historyError]);
  function goToAmount() { amountInput.current?.focus(); amountInput.current?.scrollIntoView({ block: "center" }); }
  const [storedDraft, setDraft] = useState(() => finance.draft ?? fresh(finance, initialType));
  const draft = resolveFinanceDate(storedDraft);
  const [chosenMonth, setMonth] = useState<string | null>(null);
  const month = chosenMonth ?? today.slice(0, 7);
  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const editing = finance.transactions.some((item) => item.id === draft.id);
  function change(next: FinanceDraft) {
    setDraft(next); setError(""); setHistoryError(""); setDraftStatus("Сохраняем черновик…");
    void saveDraft(next).then(() => setDraftStatus("Черновик сохранён на телефоне")).catch(() => {
      setDraftStatus(""); setError("Черновик не записан. Не закрывайте форму; попробуйте сохранить операцию.");
    });
  }
  async function reset() {
    try { await saveDraft(null); setDraft(fresh(finance)); setDraftStatus(""); setError(""); setHistoryError(""); }
    catch { setError("Не удалось отменить черновик. Повторите попытку."); }
  }
  function edit(entry: Transaction) {
    if (draft.amount || draft.note || finance.draft) { setHistoryError("В форме осталась незавершённая операция. Сохраните её или отмените ввод, чтобы открыть другую."); showHistoryWarning(); return; }
    const next: FinanceDraft = { dateMode: "custom", id: entry.id, type: entry.type === "income" ? "income" : "expense", amount: (entry.totalAmount / 100).toFixed(2).replace(".", ","),
      accountId: entry.accountId, categoryId: entry.lines[0]!.categoryId!, note: entry.note, date: localDate(new Date(entry.occurredAt)) };
    change(next); goToAmount();
  }
  const entries = finance.transactions.filter((entry) => localDate(new Date(entry.occurredAt)).startsWith(month))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
  const total = (type: string) => entries.filter((entry) => entry.type === type).reduce((sum, entry) => sum + entry.totalAmount, 0);
  return <section className="finance">
    <DepthCard><div className="finance-context"><strong>На телефоне <span>RUB</span></strong><p>В резервной копии · без синхронизации с ПК</p></div></DepthCard>
    <div className="finance-section-link"><button type="button" className="text-button" onClick={() => { historyTitle.current?.focus(); historyTitle.current?.scrollIntoView({ block: "start" }); }}><ArrowDown size={18} aria-hidden="true" />К истории операций</button></div>
    <DepthCard><form className="finance-form" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      try { parseMoney(draft.amount); } catch (cause) { setError((cause as Error).message); return; }
      if (await save(resolveFinanceDate(draft))) { setDraft(fresh({ ...finance, lastAccountId: draft.accountId }, draft.type)); setDraftStatus(""); setError(""); }
    }}>
      <fieldset disabled={busy}>
        <legend>{editing ? "Изменить операцию" : "Новая операция"}</legend>
        <div className="finance-types">{(["expense", "income"] as const).map((type) => <button type="button" key={type} aria-pressed={draft.type === type}
          onClick={() => change({ ...draft, type, categoryId: finance.categories.find((item) => item.kind === type)!.id })}>
          {type === "expense" ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}{type === "expense" ? "Расход" : "Доход"}</button>)}</div>
        <label htmlFor="finance-amount">Сумма, ₽</label>
        <input ref={amountInput} id="finance-amount" className="finance-amount" inputMode="decimal" autoComplete="off" placeholder="0,00" maxLength={30}
          value={draft.amount} onChange={(event) => change({ ...draft, amount: event.target.value })} aria-describedby="finance-error" aria-invalid={Boolean(error)} />

        <label htmlFor="finance-account">Счёт</label>
        <select id="finance-account" value={draft.accountId} onChange={(event) => change({ ...draft, accountId: event.target.value })}>
          {finance.accounts.filter((item) => !item.archivedAt).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <span id="finance-category-label" className="field-label">Категория</span>
        <div className="finance-categories" role="group" aria-labelledby="finance-category-label">{finance.categories.filter((item) => item.kind === draft.type && !item.archivedAt)
          .map((category) => <button key={category.id} type="button" aria-pressed={draft.categoryId === category.id}
            onClick={() => change({ ...draft, categoryId: category.id })}>{category.name}</button>)}</div>
        <FinanceDetails key={draft.id} initialOpen={Boolean(draft.note) || draft.date !== today || editing}><summary>Дата и комментарий · {draft.date === today ? "сегодня" : draft.date}</summary><label>Дата<input type="date" required value={draft.date} onChange={(event) => change({ ...draft, date: event.target.value, dateMode: "custom" })} /></label><button type="button" className="text-button" onClick={() => change({ ...draft, date: localDate(), dateMode: "today" })}>Сегодня</button>
          <label>Комментарий <span>(необязательно)</span><input value={draft.note} maxLength={2000} placeholder="Например, обед" onChange={(event) => change({ ...draft, note: event.target.value })} /></label></FinanceDetails>
        <p id="finance-error" className="error" role="alert">{error}</p>
        <p className="helper" role="status">{draftStatus}</p>
        <button className="primary finance-save" disabled={!draft.amount.trim()}>{busy ? "Сохраняем…" : editing ? "Сохранить изменения" : draft.type === "expense" ? "Записать расход" : "Записать доход"}</button>
        {(draft.amount || draft.note || finance.draft) && <button type="button" className="text-button" onClick={() => void reset()}>Отменить ввод</button>}
      </fieldset>
    </form></DepthCard>
    <section className="finance-history" aria-labelledby="finance-history-title">
      <DepthCard><div className="finance-history-heading"><div><h2 ref={historyTitle} tabIndex={-1} id="finance-history-title">Операции за месяц</h2><p className="helper">{entries.length} операций</p></div>
      <div className="finance-month-picker"><label className="sr-only" htmlFor="finance-month">Месяц операций</label><input id="finance-month" type="month" required value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} />{month !== today.slice(0, 7) && <button type="button" className="text-button" onClick={() => setMonth(null)}>Текущий месяц</button>}</div></div></DepthCard>
      <div className="finance-section-link"><button type="button" className="text-button" onClick={goToAmount}><ArrowUp size={18} aria-hidden="true" />К вводу операции</button></div>
      {historyError && <div ref={historyWarning} tabIndex={-1} className="finance-history-warning"><p role="alert">{historyError}</p><button type="button" onClick={goToAmount}>Перейти к черновику</button></div>}
      <DepthCard><dl className="finance-totals"><div><dt>Расходы</dt><dd>{money(total("expense"))}</dd></div><div><dt>Доходы</dt><dd>{money(total("income"))}</dd></div><div className="finance-net"><dt>Разница за месяц</dt><dd>{money(total("income") - total("expense"))}</dd></div></dl></DepthCard>
      {!entries.length ? <p className="finance-empty">{month === today.slice(0, 7) ? "За этот месяц записей пока нет. Добавьте первую операцию выше." : "За выбранный месяц записей нет. Выберите другой месяц или вернитесь к текущему."}</p> : <ul className="entries finance-entries">{entries.map((entry) => <li key={entry.id}>
        <DepthCard><div className="finance-entry"><button className="entry-main" aria-label={"Изменить операцию: " + (entry.note || finance.categories.find((item) => item.id === entry.lines[0]?.categoryId)?.name)} disabled={busy} onClick={() => edit(entry)}>
          <strong>{entry.note || finance.categories.find((item) => item.id === entry.lines[0]?.categoryId)?.name}</strong>
          <small>{new Date(entry.occurredAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · {finance.accounts.find((item) => item.id === entry.accountId)?.name} · {finance.categories.find((item) => item.id === entry.lines[0]?.categoryId)?.name}</small>
          <span className={"finance-entry-amount " + (entry.type === "income" ? "is-income" : "is-expense")}>{entry.type === "expense" ? "−" : "+"}{money(entry.totalAmount)} <Pencil size={14} /></span></button>
          <button type="button" className="icon-button" disabled={busy} aria-label={"Удалить операцию: " + (entry.note || finance.categories.find((item) => item.id === entry.lines[0]?.categoryId)?.name)} onClick={() => setDeleting(entry.id)}><Trash2 size={18} /></button></div></DepthCard>
        {deleting === entry.id && <div className="finance-delete"><p>Удалить эту операцию? Она исчезнет из итогов на телефоне.</p><button disabled={busy} onClick={async () => {
          if (await remove(entry.id)) { setDeleting(null); if (draft.id === entry.id) { setDraft(fresh(finance)); setDraftStatus(""); } }
        }}>Удалить операцию</button><button disabled={busy} onClick={() => setDeleting(null)}>Оставить</button></div>}
      </li>)}</ul>}
    </section>
  </section>;
}
