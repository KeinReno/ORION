import { DepthCard } from "./depth-card";
import { SwipeRow } from "./swipe-row";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { isTaskClosed, type Task } from "@orion/shared-types";

export function TaskList({ tasks, disabled, reorder, children, actions, gestureEnabled = false, swipeRight, swipeLeft }: {
  tasks: Task[]; disabled: boolean; reorder: (ids: string[]) => Promise<boolean>; children: (task: Task) => ReactNode; actions?: (task: Task) => ReactNode;
  gestureEnabled?: boolean; swipeRight?: (task: Task) => void; swipeLeft?: (task: Task) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<{ id: string; pointer: number; moved: boolean; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [dropAfter, setDropAfter] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [controls, setControls] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const suppress = useRef(false);
  function cancel() { drag.current = null; setMoving(null); setTarget(null); }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { drag.current = null; setMoving(null); setTarget(null); setControls(null); } };
    const blur = () => { drag.current = null; setMoving(null); setTarget(null); };
    window.addEventListener("keydown", escape); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", escape); window.removeEventListener("blur", blur); };
  }, []);
  function rowAt(x: number, y: number) {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("li[data-task-id]");
    return row && list.current?.contains(row) ? tasks.find((task) => task.id === row.dataset.taskId) : undefined;
  }
  async function move(id: string, before: string, after = false) {
    if (id === before || saving || disabled) return;
    const source = tasks.find((task) => task.id === id); const destination = tasks.find((task) => task.id === before);
    if (!source || !destination || isTaskClosed(source.status) !== isTaskClosed(destination.status)) return;
    const ids = tasks.map((task) => task.id).filter((value) => value !== id);
    ids.splice(ids.indexOf(before) + Number(after), 0, id);
    setSaving(true);
    try { if (await reorder(ids)) setMessage("Порядок задач сохранён на телефоне."); }
    finally { setSaving(false); }
  }
  return <>
    <ul ref={list} className="entries task-list">{tasks.map((task, index) => <li key={task.id} data-task-id={task.id}
      className={[isTaskClosed(task.status) ? "completed" : "", moving === task.id ? "task-moving" : "", target === task.id && moving !== task.id ? (dropAfter ? "task-drop-after" : "task-drop-target") : ""].join(" ")}>
      <SwipeRow enabled={gestureEnabled && !saving} rightLabel="Выполнить" onRight={() => swipeRight?.(task)} onLeft={() => swipeLeft?.(task)} onHold={() => setControls(task.id)}><DepthCard><div className="task-row">{children(task)}
        <button className="task-grip icon-button" disabled={disabled || saving} aria-label={"Переместить задачу: " + task.title} aria-expanded={controls === task.id}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || disabled || saving) return;
            suppress.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: task.id, pointer: event.pointerId, moved: false, x: event.clientX, y: event.clientY };
            setControls(null); setMessage("");
          }}
          onPointerMove={(event) => {
            const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
            if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8 && !current.moved) return;
            current.moved = true; setMoving(current.id); event.preventDefault();
            const over = rowAt(event.clientX, event.clientY);
            const rect = over ? list.current?.querySelector<HTMLElement>(`li[data-task-id="${over.id}"]`)?.getBoundingClientRect() : null;
            setDropAfter(Boolean(rect && event.clientY > rect.top + rect.height / 2));
            setTarget(over && isTaskClosed(over.status) === isTaskClosed(task.status) ? over.id : null);
            if (event.clientY < 90) window.scrollBy(0, -16);
            else if (event.clientY > innerHeight - 150) window.scrollBy(0, 16);
          }}
          onPointerUp={(event) => {
            const current = drag.current;
            if (!current || current.pointer !== event.pointerId) return;
            const over = rowAt(event.clientX, event.clientY); const moved = current.moved; cancel();
            if (moved) { suppress.current = true; if (over) { const rect = list.current?.querySelector<HTMLElement>(`li[data-task-id="${over.id}"]`)?.getBoundingClientRect(); void move(current.id, over.id, Boolean(rect && event.clientY > rect.top + rect.height / 2)); } else setMessage("Перемещение отменено."); }
          }}
          onLostPointerCapture={cancel}
          onPointerCancel={cancel}
          onClick={() => { if (suppress.current) { suppress.current = false; return; } setControls(controls === task.id ? null : task.id); }}><GripVertical size={20} /></button>
      </div>
      {controls === task.id && <div className="task-move-controls">
        <button disabled={disabled || saving || !tasks[index - 1] || isTaskClosed(tasks[index - 1]!.status) !== isTaskClosed(task.status)}
          onClick={() => void move(task.id, tasks[index - 1]!.id)}><ArrowUp size={18} />Выше</button>
        <button disabled={disabled || saving || !tasks[index + 1] || isTaskClosed(tasks[index + 1]!.status) !== isTaskClosed(task.status)}
          onClick={() => void move(task.id, tasks[index + 1]!.id, true)}><ArrowDown size={18} />Ниже</button>
      </div>}
    {actions?.(task)}</DepthCard></SwipeRow></li>)}</ul>{tasks.length > 1 && <p className="helper order-help">Перестановка: потяните ⋮⋮ или нажмите для выбора порядка.</p>}<p className="helper" role="status">{moving ? "Отпустите в отмеченном месте списка." : message}</p></>;
}

