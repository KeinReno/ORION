import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ListChecks, Plus, Target } from "lucide-react";
import { isTaskClosed, type Task } from "@orion/shared-types";
import { LivingFocusCard } from "../../living-cosmos";

export interface CalendarScreenProps {
  tasks: Task[];
  edit: (task: Task) => void;
  done: (task: Task) => void;
  create: () => void;
}
const two = (value: number) => String(value).padStart(2, "0");
const dayKey = (date: Date) => [date.getFullYear(), two(date.getMonth() + 1), two(date.getDate())].join("-");
const parseDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date : null;
};
const fromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
const plusDays = (date: Date, count: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
};
const weekStart = (date: Date) => plusDays(date, -((date.getDay() + 6) % 7));
const sameDay = (date: string | null | undefined, key: string) => {
  if (!date) return false;
  const parsed = parseDate(date);
  return parsed !== null && dayKey(parsed) === key;
};
const dateTitle = (date: Date) => new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date);
const shortTitle = (date: Date) => new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
const formatTime = (input: string) => new Date(input).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dateSummary = (task: Task) => task.startAt
  ? "План: " + formatTime(task.startAt) + (task.estimatedMinutes ? " · " + task.estimatedMinutes + " мин" : "")
  : task.dueAt ? "Дедлайн: " + formatTime(task.dueAt) : "Без времени";

function TaskLine({ task, edit }: { task: Task; edit: (task: Task) => void }) {
  return <button type="button" className={"cosmos-calendar__task" + (isTaskClosed(task.status) ? " is-done" : "")} onClick={() => edit(task)}>
    <span className="cosmos-calendar__task-indicator" aria-hidden="true" />
    <span className="cosmos-calendar__task-content"><strong>{task.title}</strong><small>{dateSummary(task)}</small></span>
    <ChevronRight size={17} aria-hidden="true" />
  </button>;
}
export function TodayScreen({ tasks, edit, done, create, calendar }: CalendarScreenProps & { calendar: () => void }) {
  const today = dayKey(new Date());
  const active = tasks.filter((task) => !task.parentId && !isTaskClosed(task.status));
  const todayTasks = active.filter((task) => sameDay(task.startAt, today) || sameDay(task.dueAt, today));
  const dueFirst = [...active].sort((a, b) =>
    (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)
    || Number(b.priority === "high") - Number(a.priority === "high"));
  const focus = todayTasks[0] ?? dueFirst[0];
  return <section className="cosmos-today">
    <div className="cosmos-today__eyebrow">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</div>
    <h2 className="cosmos-today__heading">Ваша орбита<span>.</span></h2>
    <p className="cosmos-today__summary">{todayTasks.length} на сегодня · {active.length} в работе</p>
    {focus ? <LivingFocusCard task={focus} onOpen={() => edit(focus)} onDone={() => done(focus)} /> :
      <div className="cosmos-today__empty"><Target size={25} /><h2>Всё спокойно</h2><p>Незавершённых задач нет. Можно запланировать следующую.</p></div>}
    <div className="cosmos-today__section-heading"><h2>План на сегодня</h2><button type="button" onClick={calendar}>Календарь <CalendarDays size={16} /></button></div>
    {todayTasks.length ? todayTasks.slice(0, 7).map((task) => <TaskLine key={task.id} task={task} edit={edit} />) :
      <p className="cosmos-today__hint">На сегодня задач не назначено. Задачи со сроком и временем появятся здесь.</p>}
    <button type="button" className="cosmos-calendar__add" onClick={create}><Plus size={18} /> Добавить задачу</button>
  </section>;
}
export function CalendarScreen({ tasks, edit, create }: CalendarScreenProps) {
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [view, setView] = useState<"day"|"week"|"month">("week");
  const date = fromKey(selected);
  const days = useMemo(() => {
    const first = weekStart(new Date(date.getFullYear(), date.getMonth(), 1, 12));
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    const count = Math.ceil((Math.round((last.getTime() - first.getTime()) / 86400000) + 1) / 7) * 7;
    return Array.from({ length: count }, (_, i) => plusDays(first, i));
  }, [selected.slice(0, 7)]);
  const week = Array.from({ length: 7 }, (_, i) => plusDays(weekStart(date), i));
  const visible = tasks.filter((task) => !task.parentId);
  const scheduled = visible.filter((task) => sameDay(task.startAt, selected)).sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
  const deadlines = visible.filter((task) => sameDay(task.dueAt, selected) && !sameDay(task.startAt, selected));
  const dayTasks = (key: string) => visible.filter((task) => sameDay(task.startAt, key) || sameDay(task.dueAt, key));
  const navigate = (offset: number) => {
    const next = new Date(date);
    if (view === "month") next.setMonth(next.getMonth() + offset);
    else next.setDate(next.getDate() + offset * (view === "week" ? 7 : 1));
    setSelected(dayKey(next));
  };
  const hourRows = Array.from({ length: 16 }, (_, i) => i + 7);
  return <section className="cosmos-calendar">
    <div className="cosmos-calendar__tabs" role="group" aria-label="Вид календаря">
      {([["day", "День"], ["week", "Неделя"], ["month", "Месяц"]] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
    </div>
    <div className="cosmos-calendar__header">
      <div><span className="cosmos-calendar__eyebrow"><CalendarDays size={15} /> ПЛАНИРОВАНИЕ</span>
        <h2>{dateTitle(date)}</h2></div>
      <div className="cosmos-calendar__navigation">
        <button type="button" aria-label="Предыдущий период" onClick={() => navigate(-1)}><ChevronLeft size={20} /></button>
        <button type="button" onClick={() => setSelected(dayKey(new Date()))}>Сегодня</button>
        <button type="button" aria-label="Следующий период" onClick={() => navigate(1)}><ChevronRight size={20} /></button>
      </div>
    </div>
    {view === "month" && <div className="cosmos-calendar__month" aria-label="Месячный календарь">
      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => <span key={label} className="cosmos-calendar__weekday">{label}</span>)}
      {days.map((day) => {
        const key = dayKey(day), count = dayTasks(key).length, otherMonth = day.getMonth() !== date.getMonth();
        return <button type="button" key={key} aria-label={day.toLocaleDateString("ru-RU") + (count ? ": " + count + " задач" : "")}
          className={"cosmos-calendar__day" + (key === selected ? " is-selected" : "") + (otherMonth ? " is-other-month" : "")}
          onClick={() => { setSelected(key); setView("day"); }}><span>{day.getDate()}</span>{count > 0 && <i aria-hidden="true" />}</button>;
      })}
    </div>}
    {view !== "month" && <div className="cosmos-calendar__weekstrip" role="group" aria-label="Дни недели">
      {week.map((day) => {
        const key = dayKey(day), count = dayTasks(key).length;
        return <button type="button" key={key} aria-pressed={key === selected} onClick={() => setSelected(key)}>
          <span>{shortTitle(day)}</span><strong>{day.getDate()}</strong>{count > 0 && <i aria-hidden="true" />}</button>;
      })}
    </div>}
    {view === "week" && <div className="cosmos-calendar__weeklist">
      <p className="cosmos-calendar__hint">Нажмите на день или задачу. Для точного расписания выберите «День».</p>
      {week.map((day) => {
        const key = dayKey(day), dayEntries = dayTasks(key);
        return <section key={key} className="cosmos-calendar__weekrow"><button type="button" onClick={() => { setSelected(key); setView("day"); }}>
          <span>{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric" }).format(day)}</span>
          <small>{dayEntries.length ? dayEntries.length + " задач" : "Свободно"}</small></button>
          {dayEntries.slice(0, 2).map((task) => <TaskLine task={task} edit={edit} key={task.id} />)}
          {dayEntries.length > 2 && <button type="button" onClick={() => { setSelected(key); setView("day"); }}>Ещё {dayEntries.length - 2} →</button>}
        </section>;
      })}
    </div>}
    {view === "day" && <>
      <h3 className="cosmos-calendar__date-label">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(date)}</h3>
      <div className="cosmos-calendar__timeline">
        {hourRows.map((hour) => <div key={hour} className="cosmos-calendar__hour">
          <time>{two(hour)}:00</time>
          <div>{scheduled.filter((task) => new Date(task.startAt!).getHours() === hour).map((task) =>
            <TaskLine key={task.id} task={task} edit={edit} />)}</div>
        </div>)}
      </div>
      {!!scheduled.filter((task) => { const hour = new Date(task.startAt!).getHours(); return hour < 7 || hour > 22; }).length &&
        <section><h3>Вне временной шкалы</h3>{scheduled.filter((task) => {const hour = new Date(task.startAt!).getHours(); return hour < 7 || hour > 22;}).map((task) => <TaskLine key={task.id} task={task} edit={edit} />)}</section>}
      <section className="cosmos-calendar__deadlines"><h3><Clock3 size={17} /> Дедлайны без запланированного времени</h3>
        {deadlines.length ? deadlines.map((task) => <TaskLine key={task.id} task={task} edit={edit} />) : <p>Дедлайнов на эту дату нет.</p>}
      </section>
    </>}
    {view === "month" && <p className="cosmos-calendar__hint"><ListChecks size={16} /> Точки отмечают дни с задачами или сроками.</p>}
    <button type="button" className="cosmos-calendar__add" onClick={create}><Plus size={18} /> Создать задачу</button>
    <p className="cosmos-calendar__hint">Время начала и дедлайн задаются отдельно в редакторе задачи. Без указания времени задачи не занимают произвольный час.</p>
  </section>;
}
