"use client";

import { useAccounts, useCreateEntityLink, useDeleteEntityLink, useEntityLinks, useGlobalSearch, useGoals as useSavingsGoals } from "@orion/core-react";
import { isRelationPairAllowed, type EntityLink, type GlobalSearchResult, type Goal, type SearchableEntityType } from "@orion/shared-types";
import { Badge, Button, Input, useToast } from "@orion/ui";
import { ArrowUpRight, BookOpenText, Gauge, GitBranch, Link2, Pin, Search, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ENTITY_TYPE_LABEL } from "../../lib/entity-type-meta";
import { describeError } from "../../lib/error-message";
import { formatMoney } from "../../lib/format";
import { openEntity } from "../../lib/panel-bus";

type GoalRole = "goal_step" | "goal_measure" | "goal_material" | "goal_risk" | "goal_prerequisite";

const ROLES = [
  { id: "goal_step", label: "Шаг", hint: "Что сделать", icon: ArrowUpRight },
  { id: "goal_measure", label: "Показатель", hint: "Что отслеживать", icon: Gauge },
  { id: "goal_material", label: "Материал", hint: "Что помогает", icon: BookOpenText },
  { id: "goal_risk", label: "Риск", hint: "Что может помешать", icon: TriangleAlert },
  { id: "goal_prerequisite", label: "Зависит от", hint: "Что завершить раньше", icon: GitBranch }
] as const;

function otherEnd(link: EntityLink, goalId: string): { type: SearchableEntityType; id: string } {
  return link.targetType === "goal" && link.targetId === goalId
    ? { type: link.sourceType, id: link.sourceId }
    : { type: link.targetType, id: link.targetId };
}

function SavingsMeasure({ workspaceId, id }: { workspaceId: string | undefined; id: string }): React.ReactElement | null {
  const savings = useSavingsGoals(workspaceId, true);
  const accounts = useAccounts(workspaceId, true);
  const goal = savings.data?.find((item) => item.id === id);
  if (!goal) return savings.isError ? <p className="text-2xs text-destructive">Не удалось загрузить показатель.</p> : null;
  const account = accounts.data?.find((item) => item.id === goal.accountId);
  const percent = Math.round((goal.currentAmount / goal.targetAmount) * 100);
  return <div className="space-y-1 rounded-lg border border-accent/25 bg-accent/[0.05] p-2.5">
    <div className="flex items-center justify-between gap-2 text-label"><span className="truncate font-medium">{goal.name}</span><span className="font-mono tabular-nums text-accent">{percent}%</span></div>
    <div role="meter" aria-label={`Накоплено для «${goal.name}»`} aria-valuenow={Math.min(100, Math.max(0, percent))} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
    <p className="text-2xs text-subtle-foreground">{account ? `${formatMoney(goal.currentAmount, account.currency)} из ${formatMoney(goal.targetAmount, account.currency)} · баланс счёта обновляется по операциям` : accounts.isError || accounts.data ? "Сумма недоступна: нет доступа к счёту." : "Загружаю сумму и валюту счёта…"}</p>
  </div>;
}

/** Live references to other ORION records. A link never changes the source record or goal progress. */
export function GoalLinks({ workspaceId, goalId, goals, visibleLinkIds, onToggleVisible }: { workspaceId: string | undefined; goalId: string; goals: ReadonlyArray<Goal>; visibleLinkIds?: ReadonlySet<string>; onToggleVisible?: (id: string) => void }): React.ReactElement {
  const { toast } = useToast();
  const linksQuery = useEntityLinks(workspaceId, "goal", goalId);
  const create = useCreateEntityLink(workspaceId);
  const remove = useDeleteEntityLink(workspaceId);
  const [role, setRole] = useState<GoalRole>("goal_step");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const search = useGlobalSearch(workspaceId, debounced);
  const links = linksQuery.data?.items ?? [];
  const candidates = (search.data ?? []).filter((hit) =>
    isRelationPairAllowed(role, hit.type, "goal") &&
    hit.id !== goalId && !links.some((link) => link.kind === role && otherEnd(link, goalId).type === hit.type && otherEnd(link, goalId).id === hit.id)
  );

  async function add(hit: GlobalSearchResult): Promise<void> {
    try {
      await create.mutateAsync({ sourceType: hit.type, sourceId: hit.id, targetType: "goal", targetId: goalId, kind: role });
      setQuery("");
      setPicking(false);
      toast({ title: `Добавлено как «${ROLES.find((item) => item.id === role)?.label}»`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось связать запись", description: describeError(error), tone: "danger" });
    }
  }

  async function unlink(linkId: string): Promise<void> {
    try {
      await remove.mutateAsync(linkId);
      toast({ title: "Связь убрана", description: "Исходная запись сохранена." });
    } catch (error) {
      toast({ title: "Не удалось убрать связь", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <section className="space-y-3 border-t border-border/70 pt-4" aria-label="Связанные записи цели">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-label font-medium"><Link2 className="h-3.5 w-3.5 text-accent" aria-hidden /> Связанные записи</h3>
          <p className="text-2xs text-subtle-foreground">Живые ссылки на данные из других разделов</p>
        </div>
        <Button type="button" size="sm" variant="outline" aria-expanded={picking} onClick={() => setPicking((value) => !value)}>
          {picking ? "Закрыть" : "Добавить"}
        </Button>
      </div>

      {linksQuery.isError ? <p className="text-label text-destructive">Не удалось загрузить связи.</p> : null}
      {links.length > 0 ? (
        <div className="space-y-2">
          {ROLES.map(({ id, label, icon: Icon }) => {
            const group = links.filter((link) => link.kind === id);
            if (group.length === 0) return null;
            return (
              <div key={id} className="space-y-1">
                <p className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-subtle-foreground"><Icon className="h-3 w-3" aria-hidden /> {id === "goal_prerequisite" ? "Порядок целей" : label} · {group.length}</p>
                {group.map((link) => {
                  const end = otherEnd(link, goalId);
                  const dependency = link.kind === "goal_prerequisite" && link.targetId === goalId ? goals.find((item) => item.id === end.id) : undefined;
                  return (
                    <div key={link.id} className="space-y-1.5 rounded-lg border border-border/70 bg-background/40 px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openEntity(end.type, end.id, link.title)} className="min-w-0 flex-1 truncate text-left text-label hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        {link.kind === "goal_prerequisite" ? (link.targetId === goalId ? "После: " : "Нужна для: ") : ""}{link.title} <span className="text-2xs text-subtle-foreground">· {ENTITY_TYPE_LABEL[end.type]}</span>
                      </button>
                      {dependency ? <Badge tone={dependency.status === "achieved" ? "success" : "warning"}>{dependency.status === "achieved" ? "готово" : "ожидает"}</Badge> : null}
                      {onToggleVisible && link.kind !== "goal_prerequisite" ? <button type="button" aria-label={`${visibleLinkIds?.has(link.id) ? "Убрать с карты" : "Показать на карте"}: ${link.title}`} aria-pressed={visibleLinkIds?.has(link.id) ?? false} title={visibleLinkIds?.has(link.id) ? "Убрать с карты" : "Показать на карте"} onClick={() => onToggleVisible(link.id)} className={`rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${visibleLinkIds?.has(link.id) ? "text-accent" : "text-subtle-foreground hover:text-foreground"}`}><Pin className="h-3.5 w-3.5" /></button> : null}
                      <button type="button" aria-label={`Убрать связь с «${link.title}»`} title="Убрать связь" disabled={remove.isPending} onClick={() => void unlink(link.id)} className="rounded p-1 text-subtle-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    {link.kind === "goal_measure" && end.type === "savings_goal" ? <SavingsMeasure workspaceId={workspaceId} id={end.id} /> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {links.filter((link) => !ROLES.some((item) => item.id === link.kind)).map((link) => {
            const end = otherEnd(link, goalId);
            return <button key={link.id} type="button" onClick={() => openEntity(end.type, end.id, link.title)} className="block w-full truncate text-left text-label text-subtle-foreground hover:text-foreground">{link.title} · {ENTITY_TYPE_LABEL[end.type]}</button>;
          })}
          {linksQuery.data?.nextCursor ? <p className="text-2xs text-subtle-foreground">Показаны последние {links.length} связей.</p> : null}
        </div>
      ) : !picking && !linksQuery.isLoading ? (
        <p className="text-label text-subtle-foreground">Добавьте задачу, заметку, счёт или другую запись — контекст будет рядом с целью.</p>
      ) : null}

      {picking ? (
        <div className="space-y-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-3">
          <div className="grid grid-cols-2 gap-1.5">
            {ROLES.map(({ id, label, hint, icon: Icon }) => (
              <button key={id} type="button" aria-pressed={role === id} onClick={() => setRole(id)} className={`rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${role === id ? "border-accent/70 bg-accent/10 text-foreground" : "border-border/70 text-subtle-foreground hover:border-accent/40"}`}>
                <span className="flex items-center gap-1.5 text-label font-medium"><Icon className="h-3.5 w-3.5" aria-hidden /> {label}</span>
                <span className="text-2xs">{hint}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-subtle-foreground" aria-hidden />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Найти запись для цели" placeholder="Найти запись в пространстве…" className="pl-8" />
          </div>
          {debounced.length < 2 ? <p className="text-2xs text-subtle-foreground">Введите хотя бы два символа.</p> : search.isLoading ? <p className="text-2xs text-subtle-foreground">Ищу…</p> : search.isError ? <p className="text-2xs text-destructive">Поиск недоступен.</p> : candidates.length === 0 ? <p className="text-2xs text-subtle-foreground">Подходящих записей не найдено. Выберите другую роль или запрос.</p> : (
            <ul className="max-h-52 space-y-1 overflow-y-auto" aria-label="Найденные записи">
              {candidates.map((hit) => (
                <li key={`${hit.type}:${hit.id}`}>
                  <button type="button" disabled={create.isPending} onClick={() => void add(hit)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left hover:border-accent/50 hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span className="min-w-0 truncate text-label">{hit.title}</span><span className="shrink-0 text-2xs text-subtle-foreground">{ENTITY_TYPE_LABEL[hit.type]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-2xs text-subtle-foreground">Цель накопления показывает живой баланс выбранного счёта. Остальные связи не меняют процент выполнения; видимые на карте записи выбираются кнопкой с булавкой.</p>
        </div>
      ) : null}
    </section>
  );
}
