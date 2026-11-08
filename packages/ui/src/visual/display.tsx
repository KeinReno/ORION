"use client";

import clsx from "clsx";
import { ChevronRight, Copy, Folder, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { encodeQr } from "./qr";

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }): React.ReactElement {
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  return src ? (
    <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="inline-flex items-center justify-center rounded-full bg-ui-hover text-label font-medium text-ui-primary" style={{ width: size, height: size }}>{letter}</span>
  );
}

export function Breadcrumb({
  items
}: {
  items: {
    label: string;
    onClick?: () => void;
    onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
    onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  }[];
}): React.ReactElement {
  return (
    <nav aria-label="Путь" className="flex flex-wrap items-center gap-1 text-label text-ui-subtle">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1">
          {index > 0 ? <ChevronRight className="h-3 w-3" aria-hidden /> : null}
          {item.onClick || item.onDrop ? (
            <button type="button" className="max-w-[12rem] truncate text-ui-secondary hover:text-ui-primary" onClick={item.onClick} onDragOver={item.onDragOver} onDrop={item.onDrop}>{item.label}</button>
          ) : (
            <span className="text-ui-primary">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function DataList({ rows }: { rows: { label: string; value: ReactNode }[] }): React.ReactElement {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-body">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-ui-subtle">{row.label}</dt>
          <dd className="text-ui-primary">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TreeNode { id: string; label: string; children?: TreeNode[] }

export function TreeView({ nodes, label = "Дерево" }: { nodes: TreeNode[]; label?: string }): React.ReactElement {
  return (
    <ul role="tree" aria-label={label} className="text-body text-ui-primary">
      {nodes.map((node) => <TreeBranch key={node.id} node={node} />)}
    </ul>
  );
}

function TreeBranch({ node }: { node: TreeNode }): React.ReactElement {
  const [open, setOpen] = useState(true);
  const has = Boolean(node.children?.length);
  return (
    <li role="treeitem" aria-expanded={has ? open : undefined}>
      <button type="button" className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ui-hover" onClick={() => has && setOpen((value) => !value)}>
        {has ? <ChevronRight className={clsx("h-3.5 w-3.5 transition", open && "rotate-90")} /> : <span className="inline-block w-3.5" />}
        {node.label}
      </button>
      {has && open ? <ul className="ml-4 border-l border-ui-border pl-2" role="group">{node.children!.map((child) => <TreeBranch key={child.id} node={child} />)}</ul> : null}
    </li>
  );
}

export function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }): React.ReactElement {
  return (
    <div className="overflow-auto rounded-lg border border-ui-border">
      <table className="w-full border-collapse text-left text-body">
        <thead className="bg-ui-hover/60 text-label text-ui-subtle">
          <tr>{columns.map((column) => <th key={column} className="px-3 py-2 font-medium">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-ui-border">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 text-ui-primary">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ items }: { items: { title: string; detail?: string; time: string }[] }): React.ReactElement {
  return (
    <ol className="relative ml-2 border-l border-ui-border pl-4">
      {items.map((item) => (
        <li key={`${item.time}-${item.title}`} className="mb-3">
          <span className="absolute -left-1 mt-1.5 h-2 w-2 rounded-full bg-ui-button" />
          <p className="text-micro text-ui-subtle">{item.time}</p>
          <p className="text-body text-ui-primary">{item.title}</p>
          {item.detail ? <p className="text-label text-ui-secondary">{item.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function Progress({ label, value }: { label: string; value: number }): React.ReactElement {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="mb-1 flex justify-between text-label text-ui-secondary"><span>{label}</span><span className="tabular-nums">{Math.round(clamped)}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ui-hover" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-ui-button" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function CircularProgress({ label, value }: { label: string; value: number }): React.ReactElement {
  const clamped = Math.min(100, Math.max(0, value));
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="inline-flex items-center gap-2" role="progressbar" aria-label={label} aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" className="stroke-ui-hover" strokeWidth="3" />
        <circle cx="20" cy="20" r={r} fill="none" className="stroke-ui-button" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(clamped / 100) * c} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
      <span className="text-label tabular-nums text-ui-primary">{Math.round(clamped)}%</span>
    </div>
  );
}

export function Timer({ label = "Таймер" }: { label?: string }): React.ReactElement {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-lg tabular-nums text-ui-primary" role="timer" aria-label={label}>{text}</span>
      <button type="button" className="rounded-md border border-ui-border px-2 py-1 text-label text-ui-secondary" onClick={() => setRunning((value) => !value)}>{running ? "Пауза" : "Старт"}</button>
      <button type="button" className="rounded-md px-2 py-1 text-label text-ui-subtle" onClick={() => { setRunning(false); setSeconds(0); }}>Сброс</button>
    </div>
  );
}

export function Chart({ points, kind = "bar" }: { points: { label: string; value: number }[]; kind?: "bar" | "line" }): React.ReactElement {
  const max = Math.max(1, ...points.map((point) => point.value));
  const width = 280;
  const height = 96;
  if (kind === "line") {
    const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${(index / Math.max(1, points.length - 1)) * width} ${height - (point.value / max) * (height - 8)}`).join(" ");
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label="График">
        <path d={d} fill="none" className="stroke-ui-button" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <div className="flex h-24 items-end gap-1" role="img" aria-label="График">
      {points.map((point) => (
        <div key={point.label} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-sm bg-ui-button" style={{ height: `${(point.value / max) * 100}%` }} />
          <span className="text-micro text-ui-subtle">{point.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Steps({ items, current }: { items: string[]; current: number }): React.ReactElement {
  return (
    <ol className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <li key={item} className={clsx("rounded-full px-2 py-1 text-label", index === current ? "bg-ui-button text-ui-button-foreground" : index < current ? "text-ui-primary" : "text-ui-subtle")}>
          {index + 1}. {item}
        </li>
      ))}
    </ol>
  );
}

export function Stepper({ items, current, onChange }: { items: string[]; current: number; onChange: (index: number) => void }): React.ReactElement {
  return (
    <div>
      <Steps items={items} current={current} />
      <div className="mt-2 flex gap-2">
        <button type="button" className="text-label text-ui-secondary" disabled={current === 0} onClick={() => onChange(current - 1)}>Назад</button>
        <button type="button" className="text-label text-ui-primary" disabled={current >= items.length - 1} onClick={() => onChange(current + 1)}>Дальше</button>
      </div>
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "danger"; title: string; children?: ReactNode }): React.ReactElement {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("rounded-lg border px-3 py-2", tone === "danger" ? "border-ui-danger/40 bg-ui-danger/10" : "border-ui-border bg-ui-hover/40")}>
      <p className="text-body text-ui-primary">{title}</p>
      {children ? <p className="text-label text-ui-secondary">{children}</p> : null}
    </div>
  );
}

export function Announcement({ children, onClose }: { children: ReactNode; onClose?: () => void }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ui-border bg-ui-hover/50 px-3 py-2 text-label text-ui-primary">
      <span>{children}</span>
      {onClose ? <button type="button" aria-label="Закрыть объявление" onClick={onClose}><X className="h-3.5 w-3.5" /></button> : null}
    </div>
  );
}

export function ActionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-full border border-ui-border bg-card px-3 py-1.5 shadow-lg">
      <span className="text-label text-ui-primary">Выбрано: {count}</span>
      {children}
      <button type="button" className="text-label text-ui-subtle" onClick={onClear}>Снять</button>
    </div>
  );
}

export function HoverCard({ trigger, children }: { trigger: ReactNode; children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {trigger}
      {open ? <span className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-ui-border bg-card p-2 text-label text-ui-secondary shadow-lg">{children}</span> : null}
    </span>
  );
}

export function ClipboardButton({ text, label = "Копировать" }: { text: string; label?: string }): React.ReactElement {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md border border-ui-border px-2 py-1 text-label text-ui-secondary"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1200); }); }}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden /> {done ? "Скопировано" : label}
    </button>
  );
}

export function Accordion({ items }: { items: { title: string; body: ReactNode }[] }): React.ReactElement {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-ui-border rounded-lg border border-ui-border">
      {items.map((item, index) => (
        <div key={item.title}>
          <button type="button" aria-expanded={open === index} className="flex w-full items-center justify-between px-3 py-2 text-left text-body text-ui-primary" onClick={() => setOpen(open === index ? null : index)}>
            {item.title} <ChevronRight className={clsx("h-4 w-4 transition", open === index && "rotate-90")} />
          </button>
          {open === index ? <div className="px-3 pb-3 text-label text-ui-secondary">{item.body}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Collapsible({ title, children }: { title: string; children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} className="text-body text-ui-primary" onClick={() => setOpen((value) => !value)}>{title}</button>
      {open ? <div className="mt-1 text-label text-ui-secondary">{children}</div> : null}
    </div>
  );
}

export function ScrollArea({ children, label }: { children: ReactNode; label: string }): React.ReactElement {
  return <div tabIndex={0} aria-label={label} className="orion-scroll max-h-40 overflow-auto rounded-lg border border-ui-border p-2">{children}</div>;
}

export function CalendarPicker({ value, onChange, disabled = false }: { value: string; onChange: (iso: string) => void; disabled?: boolean }): React.ReactElement {
  const initial = value ? new Date(`${value}T00:00:00`) : new Date();
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = (first.getDay() + 6) % 7;
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return { start, count };
  }, [cursor]);
  const title = cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return (
    <div className="w-64 rounded-lg border border-ui-border p-2">
      <div className="mb-2 flex items-center justify-between text-label text-ui-primary">
        <button type="button" aria-label="Предыдущий месяц" disabled={disabled} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button>
        <span className="capitalize">{title}</span>
        <button type="button" aria-label="Следующий месяц" disabled={disabled} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-micro text-ui-subtle">
        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((day) => <span key={day}>{day}</span>)}
        {Array.from({ length: days.start }, (_, index) => <span key={`e${index}`} />)}
        {Array.from({ length: days.count }, (_, index) => {
          const day = index + 1;
          const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return (
            <button key={iso} type="button" disabled={disabled} className={clsx("rounded py-1 text-label", iso === value ? "bg-ui-button text-ui-button-foreground" : "text-ui-primary hover:bg-ui-hover")} onClick={() => onChange(iso)}>{day}</button>
          );
        })}
      </div>
    </div>
  );
}

export function Tour({ steps, onClose }: { steps: { title: string; body: string }[]; onClose: () => void }): React.ReactElement | null {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (!step) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-ui-border bg-card p-3 shadow-xl" role="dialog" aria-label="Обзор">
      <p className="text-body text-ui-primary">{step.title}</p>
      <p className="mt-1 text-label text-ui-secondary">{step.body}</p>
      <div className="mt-3 flex justify-between text-label">
        <button type="button" onClick={onClose}>Закрыть</button>
        <button type="button" className="text-ui-primary" onClick={() => index + 1 >= steps.length ? onClose() : setIndex(index + 1)}>{index + 1 >= steps.length ? "Готово" : "Дальше"}</button>
      </div>
    </div>
  );
}

export function QrCode({ text, label = "QR-код" }: { text: string; label?: string }): React.ReactElement {
  let modules: boolean[][] = [];
  let error = "";
  try { modules = encodeQr(text); } catch { error = "Слишком длинная строка для этого кода"; }
  const n = modules.length;
  return (
    <div>
      {error ? <p className="text-label text-ui-danger">{error}</p> : (
        <svg viewBox={`0 0 ${n + 2} ${n + 2}`} className="h-36 w-36 bg-white" role="img" aria-label={label}>
          {modules.flatMap((row, y) => row.map((cell, x) => cell ? <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill="#111" /> : null))}
        </svg>
      )}
    </div>
  );
}

export function AspectRatio({ ratio = 16 / 9, children }: { ratio?: number; children: ReactNode }): React.ReactElement {
  return <div className="relative w-full" style={{ paddingTop: `${100 / ratio}%` }}><div className="absolute inset-0">{children}</div></div>;
}

export function ImageCropper({ onCrop }: { onCrop: (dataUrl: string) => void }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [box, setBox] = useState({ x: 20, y: 20, w: 80, h: 80 });
  return (
    <div className="space-y-2">
      <input aria-label="Картинка для обрезки" type="file" accept="image/*" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setUrl(URL.createObjectURL(file));
      }} />
      {url ? (
        <div className="relative inline-block">
          <img ref={imgRef} src={url} alt="" className="max-h-48 max-w-full" />
          <div className="pointer-events-none absolute border-2 border-white" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
        </div>
      ) : null}
      <div className="flex gap-2 text-label">
        <label>X <input type="number" className="w-16 bg-transparent" value={box.x} onChange={(event) => setBox({ ...box, x: Number(event.target.value) })} /></label>
        <label>Y <input type="number" className="w-16 bg-transparent" value={box.y} onChange={(event) => setBox({ ...box, y: Number(event.target.value) })} /></label>
        <button type="button" className="rounded border border-ui-border px-2" onClick={() => {
          const image = imgRef.current;
          if (!image) return;
          const canvas = document.createElement("canvas");
          canvas.width = box.w;
          canvas.height = box.h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const scaleX = image.naturalWidth / image.clientWidth;
          const scaleY = image.naturalHeight / image.clientHeight;
          ctx.drawImage(image, box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY, 0, 0, box.w, box.h);
          onCrop(canvas.toDataURL("image/png"));
        }}>Обрезать</button>
      </div>
    </div>
  );
}

export function SkipNav({ targetId = "orion-workbench" }: { targetId?: string }): React.ReactElement {
  return (
    <a href={`#${targetId}`} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-ui-primary">
      К рабочей области
    </a>
  );
}

export function JsonTree({ value }: { value: unknown }): React.ReactElement {
  return <pre className="overflow-auto rounded-lg border border-ui-border p-2 text-micro text-ui-secondary">{JSON.stringify(value, null, 2)}</pre>;
}

export function Prose({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="max-w-prose space-y-2 text-body leading-relaxed text-ui-primary [&_code]:rounded [&_code]:bg-ui-hover [&_code]:px-1">{children}</div>;
}

export function KeyboardKeys({ keys }: { keys: string[] }): React.ReactElement {
  return (
    <span className="inline-flex gap-1">
      {keys.map((key) => <kbd key={key} className="rounded border border-ui-border-strong bg-ui-hover px-1.5 py-0.5 font-mono text-micro text-ui-primary">{key}</kbd>)}
    </span>
  );
}

export function CardStack({ cards }: { cards: { title: string; body: string }[] }): React.ReactElement {
  const [index, setIndex] = useState(0);
  const card = cards[index % cards.length];
  return (
    <button type="button" className="w-full rounded-xl border border-ui-border bg-card p-4 text-left" onClick={() => setIndex((value) => value + 1)}>
      <p className="text-body text-ui-primary">{card?.title}</p>
      <p className="text-label text-ui-secondary">{card?.body}</p>
      <p className="mt-2 text-micro text-ui-subtle">Ещё {Math.max(0, cards.length - 1)}</p>
    </button>
  );
}

export function ExpandableCard({ title, summary, children }: { title: string; summary: string; children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" aria-expanded={open} className="w-full rounded-xl border border-ui-border p-3 text-left" onClick={() => setOpen((value) => !value)}>
      <p className="text-body text-ui-primary">{title}</p>
      <p className="text-label text-ui-secondary">{summary}</p>
      {open ? <div className="mt-2 text-label text-ui-primary">{children}</div> : null}
    </button>
  );
}

export function TabsBar({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (tab: string) => void }): React.ReactElement {
  return (
    <div role="tablist" className="relative flex gap-1 border-b border-ui-border">
      {tabs.map((tab) => (
        <button key={tab} type="button" role="tab" aria-selected={tab === value} className={clsx("px-3 py-1.5 text-label", tab === value ? "text-ui-primary" : "text-ui-subtle")} onClick={() => onChange(tab)}>
          {tab}
          {tab === value ? <span className="mt-1 block h-0.5 rounded bg-ui-button" /> : null}
        </button>
      ))}
    </div>
  );
}

export function PillNav({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (tab: string) => void }): React.ReactElement {
  return (
    <div role="tablist" className="inline-flex rounded-full border border-ui-border p-0.5">
      {tabs.map((tab) => (
        <button key={tab} type="button" role="tab" aria-selected={tab === value} className={clsx("rounded-full px-3 py-1 text-label", tab === value ? "bg-ui-button text-ui-button-foreground" : "text-ui-secondary")} onClick={() => onChange(tab)}>{tab}</button>
      ))}
    </div>
  );
}

export function TracingBeam({ progress, children }: { progress: number; children: ReactNode }): React.ReactElement {
  return (
    <div className="relative pl-4">
      <span aria-hidden className="absolute bottom-0 left-0 top-0 w-px bg-ui-border">
        <span className="absolute left-0 top-0 w-px bg-ui-button" style={{ height: `${Math.min(100, Math.max(0, progress))}%` }} />
      </span>
      {children}
    </div>
  );
}

export function Compare({ before, after }: { before: string; after: string }): React.ReactElement {
  const [split, setSplit] = useState(50);
  return (
    <div className="relative h-32 overflow-hidden rounded-lg border border-ui-border">
      <div className="absolute inset-0" style={{ background: before }} />
      <div className="absolute inset-y-0 left-0" style={{ width: `${split}%`, background: after }} />
      <input aria-label="Сравнение" type="range" min={0} max={100} value={split} onChange={(event) => setSplit(Number(event.target.value))} className="absolute inset-x-3 bottom-2" />
    </div>
  );
}

const SAMPLE = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#c9a86a"/><stop offset="1" stop-color="#2a2c31"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="90" cy="80" r="28" fill="#f4f0ea"/></svg>`);

export function ImageSlider({ images = [SAMPLE, SAMPLE] }: { images?: string[] }): React.ReactElement {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <AspectRatio><img src={images[index % images.length]} alt="" className="h-full w-full object-cover" /></AspectRatio>
      <div className="mt-2 flex gap-2">
        <button type="button" className="text-label text-ui-secondary" onClick={() => setIndex((value) => (value + images.length - 1) % images.length)}>Назад</button>
        <button type="button" className="text-label text-ui-secondary" onClick={() => setIndex((value) => (value + 1) % images.length)}>Дальше</button>
      </div>
    </div>
  );
}

export function Lens({ src = SAMPLE }: { src?: string }): React.ReactElement {
  const [at, setAt] = useState({ x: 50, y: 50 });
  return (
    <div
      className="h-32 overflow-hidden rounded-lg border border-ui-border bg-cover"
      style={{ backgroundImage: `url("${src}")`, backgroundPosition: `${at.x}% ${at.y}%`, backgroundSize: "180%" }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setAt({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
      }}
    />
  );
}

export function CodeBlock({ code }: { code: string }): React.ReactElement {
  return <pre className="overflow-auto rounded-lg border border-ui-border bg-ui-hover/40 p-3 font-mono text-micro leading-relaxed text-ui-primary">{code}</pre>;
}

export function TerminalView({ lines }: { lines: { kind: "in" | "out"; text: string }[] }): React.ReactElement {
  return (
    <div className="rounded-lg border border-ui-border bg-black/40 p-3 font-mono text-micro">
      {lines.map((line, index) => <p key={index} className={line.kind === "in" ? "text-ui-primary" : "text-ui-secondary"}>{line.kind === "in" ? "› " : ""}{line.text}</p>)}
    </div>
  );
}

export function LinkPreview({ href, title, description }: { href: string; title: string; description: string }): React.ReactElement {
  return (
    <HoverCard trigger={<a href={href} className="text-ui-primary underline decoration-ui-border underline-offset-2">{title}</a>}>
      <span className="block text-ui-primary">{title}</span>
      <span className="block truncate text-ui-subtle">{href}</span>
      <span className="mt-1 block">{description}</span>
    </HoverCard>
  );
}

export function FileDrop({ onFiles }: { onFiles: (files: File[]) => void }): React.ReactElement {
  const [over, setOver] = useState(false);
  const inputId = useId();
  return (
    <label htmlFor={inputId} onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); onFiles(Array.from(event.dataTransfer.files)); }} className={clsx("flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-label", over ? "border-ui-button bg-ui-hover" : "border-ui-border text-ui-secondary")}>
      Перетащите файлы или нажмите
      <input id={inputId} type="file" multiple className="sr-only" onChange={(event) => onFiles(Array.from(event.target.files ?? []))} />
    </label>
  );
}

export function Bento({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="grid grid-cols-2 gap-2 [&>*:first-child]:col-span-2">{children}</div>;
}

export function LayoutGrid({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

export function StatsRow({ items }: { items: { label: string; value: string }[] }): React.ReactElement {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-ui-border px-2 py-1.5">
          <dt className="text-micro uppercase text-ui-subtle">{item.label}</dt>
          <dd className="font-mono text-body tabular-nums text-ui-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FocusCards({ cards }: { cards: string[] }): React.ReactElement {
  const [hot, setHot] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-3 gap-2">
      {cards.map((card, index) => (
        <button key={card} type="button" onMouseEnter={() => setHot(index)} onMouseLeave={() => setHot(null)} className={clsx("rounded-lg border border-ui-border p-3 text-left text-label text-ui-primary transition", hot !== null && hot !== index && "opacity-40")}>{card}</button>
      ))}
    </div>
  );
}

export function ProfileCard({ name, role }: { name: string; role: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ui-border p-3">
      <Avatar name={name} size={40} />
      <div>
        <p className="text-body text-ui-primary">{name}</p>
        <p className="text-label text-ui-subtle">{role}</p>
      </div>
    </div>
  );
}

export function Carousel({ slides }: { slides: string[] }): React.ReactElement {
  const [index, setIndex] = useState(0);
  return (
    <div className="rounded-xl border border-ui-border p-4">
      <p className="min-h-12 text-body text-ui-primary">{slides[index]}</p>
      <div className="mt-2 flex gap-1">
        {slides.map((slide, dot) => <button key={slide} type="button" aria-label={slide} className={clsx("h-1.5 w-6 rounded-full", dot === index ? "bg-ui-button" : "bg-ui-hover")} onClick={() => setIndex(dot)} />)}
      </div>
    </div>
  );
}

export function Masonry({ items }: { items: { title: string; tall?: boolean }[] }): React.ReactElement {
  return (
    <div className="columns-2 gap-2">
      {items.map((item) => <div key={item.title} className={clsx("mb-2 break-inside-avoid rounded-lg border border-ui-border p-3 text-label text-ui-primary", item.tall ? "h-28" : "h-16")}>{item.title}</div>)}
    </div>
  );
}

export function Dock({ items, onPick }: { items: { id: string; label: string }[]; onPick: (id: string) => void }): React.ReactElement {
  const [near, setNear] = useState<number | null>(null);
  return (
    <div className="flex items-end gap-1 rounded-2xl border border-ui-border bg-card/80 px-2 py-1" onMouseLeave={() => setNear(null)}>
      {items.map((item, index) => (
        <button key={item.id} type="button" aria-label={item.label} title={item.label} onMouseEnter={() => setNear(index)} onClick={() => onPick(item.id)} className="flex items-center justify-center rounded-xl bg-ui-hover text-micro text-ui-primary transition" style={{ width: near === index ? 48 : 36, height: near === index ? 48 : 36 }}>{item.label.slice(0, 1)}</button>
      ))}
    </div>
  );
}

export function Stack({ cards }: { cards: string[] }): React.ReactElement {
  const [order, setOrder] = useState(cards);
  return (
    <button type="button" className="relative h-24 w-full" onClick={() => setOrder((items) => items.length ? [...items.slice(1), items[0]] : items)}>
      {order.slice(0, 3).map((card, index) => (
        <span key={card} className="absolute inset-x-4 rounded-xl border border-ui-border bg-card px-3 py-4 text-body text-ui-primary" style={{ top: index * 8 }}>{index === 0 ? card : ""}</span>
      ))}
    </button>
  );
}

export function FolderCard({ title, notes }: { title: string; notes: string[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className="w-full rounded-xl border border-ui-border p-3 text-left" onClick={() => setOpen((value) => !value)}>
      <span className="flex items-center gap-2 text-body text-ui-primary"><Folder className="h-4 w-4" /> {title}</span>
      {open ? <ul className="mt-2 space-y-1 text-label text-ui-secondary">{notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
    </button>
  );
}

export function BranchedMenu({ sections }: { sections: { title: string; items: string[] }[] }): React.ReactElement {
  const [open, setOpen] = useState(sections[0]?.title ?? "");
  return (
    <ul className="border-l border-ui-border pl-3">
      {sections.map((section) => (
        <li key={section.title} className="mb-2">
          <button type="button" className="text-body text-ui-primary" onClick={() => setOpen(section.title)}>{section.title}</button>
          {open === section.title ? <ul className="ml-3 mt-1 border-l border-ui-button/50 pl-2 text-label text-ui-secondary">{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </li>
      ))}
    </ul>
  );
}

export function LineSidebar({ items }: { items: string[] }): React.ReactElement {
  const [near, setNear] = useState<number | null>(null);
  return (
    <ul>
      {items.map((item, index) => {
        const distance = near === null ? 2 : Math.abs(near - index);
        return (
          <li key={item}>
            <button type="button" className="w-full rounded px-2 py-1 text-left text-body" style={{ paddingLeft: 8 + Math.max(0, 12 - distance * 6), color: distance === 0 ? "inherit" : undefined }} onMouseEnter={() => setNear(index)}>{item}</button>
          </li>
        );
      })}
    </ul>
  );
}

export function FlipCard({ front, back }: { front: string; back: string }): React.ReactElement {
  const [flipped, setFlipped] = useState(false);
  return (
    <button type="button" className="h-24 w-full [perspective:800px]" onClick={() => setFlipped((value) => !value)}>
      <span className="relative block h-full w-full transition-transform duration-500 [transform-style:preserve-3d]" style={{ transform: flipped ? "rotateY(180deg)" : undefined }}>
        <span className="absolute inset-0 flex items-center justify-center rounded-xl border border-ui-border bg-card text-body text-ui-primary [backface-visibility:hidden]">{front}</span>
        <span className="absolute inset-0 flex items-center justify-center rounded-xl border border-ui-border bg-ui-hover text-body text-ui-primary [backface-visibility:hidden] [transform:rotateY(180deg)]">{back}</span>
      </span>
    </button>
  );
}

export function DraggableCard({ title }: { title: string }): React.ReactElement {
  const [delta, setDelta] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="cursor-grab rounded-xl border border-ui-border bg-card px-3 py-4 text-body text-ui-primary"
      style={{ transform: `translate(${delta.x}px, ${delta.y}px)` }}
      onPointerDown={(event) => { origin.current = { x: event.clientX - delta.x, y: event.clientY - delta.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (!origin.current) return; setDelta({ x: event.clientX - origin.current.x, y: event.clientY - origin.current.y }); }}
      onPointerUp={() => { origin.current = null; }}
    >
      {title}
    </div>
  );
}

export function EmptyScene({ title, description, action }: { title: string; description: string; action?: ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-ui-border px-4 py-6">
      <p className="text-body text-ui-primary">{title}</p>
      <p className="max-w-sm text-label text-ui-secondary">{description}</p>
      {action}
    </div>
  );
}

export function Highlight({ text, query }: { text: string; query: string }): React.ReactElement {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const at = lower.indexOf(needle);
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="rounded bg-ui-button/30 text-ui-primary">{text.slice(at, at + needle.length)}</mark>{text.slice(at + needle.length)}</>;
}

export function Hitbox({ label, children }: { label: string; children: ReactNode }): React.ReactElement {
  return <button type="button" aria-label={label} className="relative inline-flex before:absolute before:-inset-2">{children}</button>;
}
