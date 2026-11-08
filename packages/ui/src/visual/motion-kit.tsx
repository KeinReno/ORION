"use client";

import clsx from "clsx";
import { Bell, Check, Mic, Send } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMotionLevel } from "../motion-level";

/** Уровень движения уже записан на `<html>` настройками; системное «уменьшить движение» тоже гасит эффекты. */
function moves(): boolean {
  if (typeof document === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return document.documentElement.dataset.motion !== "off";
}

export function CountUp({ value, digits = 0 }: { value: number; digits?: number }): React.ReactElement {
  const [shown, setShown] = useState(moves() ? 0 : value);
  useEffect(() => {
    if (!moves()) { setShown(value); return undefined; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / 700);
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="tabular-nums">{shown.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
}

export function GradualBlur({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <div className="relative max-h-24 overflow-hidden">
      {children}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

export function SpringCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-body text-ui-primary">
      <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={clsx("flex h-5 w-5 items-center justify-center rounded border", checked ? "border-ui-button bg-ui-button text-ui-button-foreground" : "border-ui-border", moves() && "transition-transform active:scale-90")} onClick={() => onChange(!checked)}>
        {checked ? <Check className="h-3.5 w-3.5" /> : null}
      </button>
      <span className={checked ? "text-ui-subtle line-through" : undefined}>{label}</span>
    </label>
  );
}

export function SquishSwitch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }): React.ReactElement {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={clsx("relative h-6 w-11 rounded-full", checked ? "bg-ui-button" : "bg-ui-hover")} onClick={() => onChange(!checked)}>
      <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white", moves() && "transition-all", checked ? "left-5 scale-x-110" : "left-0.5")} />
    </button>
  );
}

export function RubberSegment<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}): React.ReactElement {
  return (
    <div role="tablist" aria-label={label} className="relative inline-flex rounded-lg bg-ui-hover p-0.5">
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} className={clsx("relative z-10 rounded-md px-3 py-1 text-label", option.value === value ? "bg-card text-ui-primary shadow-sm" : "text-ui-secondary", moves() && "transition")} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export function WarmTooltip({ label, tip }: { label: string; tip: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  return (
    <span className="relative inline-flex" onMouseEnter={() => { timer.current = window.setTimeout(() => setOpen(true), 280); }} onMouseLeave={() => { if (timer.current) window.clearTimeout(timer.current); setOpen(false); }}>
      <button type="button" className="text-label text-ui-secondary underline decoration-dotted">{label}</button>
      {open ? <span role="tooltip" className="absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-card px-2 py-1 text-micro text-ui-primary shadow">{tip}</span> : null}
    </span>
  );
}

export function ThoughtLine({ steps, done }: { steps: string[]; done?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(!done);
  return (
    <div className="text-label text-ui-secondary">
      <button type="button" onClick={() => setOpen((value) => !value)}>{done ? "Ход мысли" : "Думает…"}</button>
      {open ? <ol className="mt-1 list-decimal pl-4">{steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
    </div>
  );
}

export function PromptBar({ value, onChange, onSend, placeholder = "Сообщение" }: { value: string; onChange: (value: string) => void; onSend: () => void; placeholder?: string }): React.ReactElement {
  return (
    <form className="flex items-end gap-2 rounded-2xl border border-ui-border bg-card p-2" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      <textarea aria-label={placeholder} rows={2} className="min-w-0 flex-1 resize-none bg-transparent text-body text-ui-primary outline-none" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="submit" aria-label="Отправить" className="rounded-full bg-ui-button p-2 text-ui-button-foreground"><Send className="h-4 w-4" /></button>
    </form>
  );
}

export function SwipeToast({ text, onClose }: { text: string; onClose: () => void }): React.ReactElement {
  const [x, setX] = useState(0);
  return (
    <div
      className="w-64 touch-none rounded-lg border border-ui-border bg-card px-3 py-2 text-label text-ui-primary"
      style={{ transform: `translateY(${x}px)`, opacity: 1 - Math.min(1, x / 80) }}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && event.movementY > 0) setX((value) => value + event.movementY); }}
      onPointerUp={() => { if (x > 48) onClose(); else setX(0); }}
    >
      {text}
    </div>
  );
}

export function GlareHover({ children }: { children: ReactNode }): React.ReactElement {
  const [at, setAt] = useState({ x: 50, y: 50 });
  return (
    <div className="relative overflow-hidden rounded-xl border border-ui-border" onMouseMove={(event) => { const r = event.currentTarget.getBoundingClientRect(); setAt({ x: event.clientX - r.left, y: event.clientY - r.top }); }}>
      {children}
      {moves() ? <span aria-hidden className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-xl" style={{ left: at.x, top: at.y }} /> : null}
    </div>
  );
}

export function CursorSpotlight({ children }: { children: ReactNode }): React.ReactElement {
  return <GlareHover><div className="p-3">{children}</div></GlareHover>;
}

export function BorderGlow({ children, active }: { children: ReactNode; active?: boolean }): React.ReactElement {
  return <div className={clsx("rounded-xl border p-3", active ? "border-ui-button shadow-[0_0_24px_rgb(var(--kaiden-accent-base)/0.35)]" : "border-ui-border")}>{children}</div>;
}

export function AnimatedList({ items }: { items: string[] }): React.ReactElement {
  return (
    <ul className="space-y-1">
      {items.map((item, index) => <li key={item} className={clsx("rounded-md bg-ui-hover/50 px-2 py-1 text-body text-ui-primary", moves() && "animate-[orion-rise_400ms_ease_both]")} style={{ animationDelay: moves() ? `${index * 40}ms` : undefined }}>{item}</li>)}
    </ul>
  );
}

export function HoldButton({ label, onConfirm }: { label: string; onConfirm: () => void }): React.ReactElement {
  const [held, setHeld] = useState(0);
  const timer = useRef<number | null>(null);
  const start = (): void => {
    const began = performance.now();
    const tick = (now: number): void => {
      const next = Math.min(1, (now - began) / 700);
      setHeld(next);
      if (next >= 1) { onConfirm(); return; }
      timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
  };
  const stop = (): void => { if (timer.current) cancelAnimationFrame(timer.current); setHeld(0); };
  return (
    <button type="button" className="relative overflow-hidden rounded-lg border border-ui-danger/50 px-3 py-2 text-label text-ui-danger" onPointerDown={start} onPointerUp={stop} onPointerLeave={stop}>
      <span aria-hidden className="absolute inset-y-0 left-0 bg-ui-danger/20" style={{ width: `${held * 100}%` }} />
      <span className="relative">{label}</span>
    </button>
  );
}

export function SlideCommit({ label, onConfirm }: { label: string; onConfirm: () => void }): React.ReactElement {
  const [x, setX] = useState(0);
  return (
    <div className="relative h-10 w-56 overflow-hidden rounded-full bg-ui-hover">
      <span className="absolute inset-0 flex items-center justify-center text-micro text-ui-subtle">{label}</span>
      <button
        type="button"
        aria-label={label}
        className="absolute left-1 top-1 h-8 w-8 rounded-full bg-ui-button"
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setX((value) => Math.min(176, Math.max(0, value + event.movementX))); }}
        onPointerUp={() => { if (x > 150) onConfirm(); setX(0); }}
      />
    </div>
  );
}

export function BellToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.ReactElement {
  return (
    <button type="button" aria-pressed={on} className={clsx("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-label", on ? "border-ui-button text-ui-primary" : "border-ui-border text-ui-subtle")} onClick={() => onChange(!on)}>
      <Bell className="h-4 w-4" /> {on ? "Звук включён" : "Тихо"}
    </button>
  );
}

export function VoicePill({ active, onChange }: { active: boolean; onChange: (active: boolean) => void }): React.ReactElement {
  return (
    <button type="button" aria-pressed={active} className={clsx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-label", active ? "bg-ui-danger/20 text-ui-danger" : "bg-ui-hover text-ui-secondary")} onClick={() => onChange(!active)}>
      <Mic className="h-4 w-4" /> {active ? "Запись" : "Голос"}
    </button>
  );
}

export function SlingButton({ label, onSend }: { label: string; onSend: () => void }): React.ReactElement {
  const [pull, setPull] = useState(0);
  return (
    <button
      type="button"
      className="rounded-full bg-ui-button px-4 py-2 text-label text-ui-button-foreground"
      style={{ transform: `translateX(${-pull}px)` }}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPull((value) => Math.min(48, Math.max(0, value - event.movementX))); }}
      onPointerUp={() => { if (pull > 28) onSend(); setPull(0); }}
    >
      {label}
    </button>
  );
}

export function ClickSpark({ children }: { children: ReactNode }): React.ReactElement {
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number }[]>([]);
  return (
    <div className="relative" onClick={(event) => {
      if (!moves()) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const id = Date.now();
      setSparks((items) => [...items, { id, x: event.clientX - rect.left, y: event.clientY - rect.top }]);
      window.setTimeout(() => setSparks((items) => items.filter((item) => item.id !== id)), 400);
    }}>
      {children}
      {sparks.map((spark) => <span key={spark.id} aria-hidden className="pointer-events-none absolute h-2 w-2 rounded-full bg-ui-button" style={{ left: spark.x, top: spark.y }} />)}
    </div>
  );
}

export function Magnet({ children }: { children: ReactNode }): React.ReactElement {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const expressive = useMotionLevel() === "expressive";
  return (
    <div
      onMouseMove={(event) => {
        if (!expressive) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setShift({ x: (event.clientX - (rect.left + rect.width / 2)) / 8, y: (event.clientY - (rect.top + rect.height / 2)) / 8 });
      }}
      onMouseLeave={() => setShift({ x: 0, y: 0 })}
      style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
    >
      {children}
    </div>
  );
}

export function NoiseOverlay(): React.ReactElement | null {
  if (useMotionLevel() === "off") return null;
  return <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(rgb(255 255 255) 0.6px, transparent 0.6px)", backgroundSize: "3px 3px" }} />;
}

export function FadeContent({ children }: { children: ReactNode }): React.ReactElement {
  return <div className={moves() ? "animate-[orion-rise_500ms_ease_both]" : undefined}>{children}</div>;
}

export function AnimatedContent({ children }: { children: ReactNode }): React.ReactElement {
  return <FadeContent>{children}</FadeContent>;
}

export function PixelTransition({ children }: { children: ReactNode }): React.ReactElement {
  return <div className={clsx(moves() && "animate-[orion-rise_400ms_steps(6)_both]")}>{children}</div>;
}

export function BlurText({ text }: { text: string }): React.ReactElement {
  return <span className={clsx("inline-block text-ui-primary", moves() && "animate-[orion-rise_600ms_ease_both]")}>{text}</span>;
}

export function SplitText({ text }: { text: string }): React.ReactElement {
  if (!moves()) return <span>{text}</span>;
  return <span aria-label={text}>{text.split("").map((char, index) => <span key={`${char}-${index}`} className="inline-block animate-[orion-rise_400ms_ease_both]" style={{ animationDelay: `${index * 18}ms` }}>{char === " " ? "\u00a0" : char}</span>)}</span>;
}

export function ShinyText({ text }: { text: string }): React.ReactElement {
  return <span className={clsx("bg-gradient-to-r from-ui-primary via-white to-ui-primary bg-clip-text text-transparent", moves() && "bg-[length:200%_100%] animate-[orion-sheen_2.4s_linear_infinite]")}>{text}</span>;
}

export function GradientText({ text }: { text: string }): React.ReactElement {
  return <span className="bg-gradient-to-r from-ui-button to-ui-primary bg-clip-text font-semibold text-transparent">{text}</span>;
}

export function TextType({ text }: { text: string }): React.ReactElement {
  const [count, setCount] = useState(moves() ? 0 : text.length);
  useEffect(() => {
    if (!moves()) { setCount(text.length); return undefined; }
    setCount(0);
    const id = window.setInterval(() => setCount((value) => (value >= text.length ? value : value + 1)), 28);
    return () => window.clearInterval(id);
  }, [text]);
  return <span>{text.slice(0, count)}</span>;
}

export function CometDial({ value }: { value: number }): React.ReactElement {
  const r = 18;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" className="stroke-ui-hover" strokeWidth="3" />
      <circle cx="24" cy="24" r={r} fill="none" className="stroke-ui-button" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${clamped * c} ${c}`} transform="rotate(-90 24 24)" />
    </svg>
  );
}

export function Sparkles({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <span className="relative inline-flex">
      {children}
      {moves() ? <span aria-hidden className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-ui-button" /> : null}
    </span>
  );
}

export function PaperPlaneButton({
  label,
  onClick,
  disabled,
  type = "button",
  quiet = false
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  quiet?: boolean;
}): React.ReactElement {
  return (
    <button type={type} aria-label={label} disabled={disabled} className="inline-flex items-center gap-2 rounded-full bg-ui-button px-3 py-1.5 text-label text-ui-button-foreground disabled:opacity-50" onClick={onClick}>
      <Send className="h-4 w-4" />
      {quiet ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

export function StatefulButton({ status, children, onClick }: { status: "idle" | "pending" | "done"; children: ReactNode; onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className="rounded-lg bg-ui-button px-3 py-1.5 text-label text-ui-button-foreground disabled:opacity-60" disabled={status === "pending"} onClick={onClick}>
      {status === "pending" ? "Сохраняю…" : status === "done" ? "Сохранено" : children}
    </button>
  );
}

export function SpecularButton({ children, onClick }: { children: ReactNode; onClick?: () => void }): React.ReactElement {
  return <button type="button" className="rounded-lg border border-white/20 bg-gradient-to-b from-white/15 to-transparent px-3 py-1.5 text-label text-ui-primary" onClick={onClick}>{children}</button>;
}

export function Cover({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="group relative overflow-hidden rounded-xl border border-ui-border">{children}<span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/0 to-white/10 opacity-0 transition group-hover:opacity-100" /></div>;
}

export function MovingBorder({ children }: { children: ReactNode }): React.ReactElement {
  return <div className={clsx("rounded-xl p-px", moves() ? "bg-[conic-gradient(from_var(--orion-angle),transparent,rgb(var(--kaiden-accent-base)),transparent)] animate-[orion-spin_4s_linear_infinite]" : "bg-ui-border")}><div className="rounded-[11px] bg-card p-3">{children}</div></div>;
}

export function DirectionAware({ label }: { label: string }): React.ReactElement {
  const [origin, setOrigin] = useState("center");
  return (
    <button
      type="button"
      className="rounded-lg border border-ui-border px-3 py-4 text-label text-ui-primary"
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        setOrigin(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top");
      }}
    >
      {label} · {origin}
    </button>
  );
}

export function GlassSurface({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="rounded-2xl border border-white/15 bg-white/10 p-3 shadow-lg backdrop-blur-md">{children}</div>;
}

export function PointerHighlight({ children }: { children: ReactNode }): React.ReactElement {
  return <span className="rounded-sm bg-ui-button/15 px-0.5 ring-1 ring-ui-button/40">{children}</span>;
}

export function MorphStatus({ state }: { state: "idle" | "run" | "done" }): React.ReactElement {
  return (
    <span aria-label={state === "done" ? "Готово" : state === "run" ? "В работе" : "Ожидание"} className="inline-flex h-5 w-5 items-center justify-center">
      {state === "done" ? <Check className="h-4 w-4 text-ui-success" /> : <span className={clsx("h-3.5 w-3.5 rounded-full border-2", state === "run" ? "border-ui-button border-t-transparent" : "border-ui-subtle")} />}
    </span>
  );
}

export function Orb(): React.ReactElement {
  return <span aria-hidden className={clsx("inline-block h-3 w-3 rounded-full bg-ui-button/80", moves() && "animate-pulse")} />;
}

export function Presence({ show, children }: { show: boolean; children: ReactNode }): React.ReactElement | null {
  if (!show) return null;
  return <div className={moves() ? "animate-[orion-rise_250ms_ease_both]" : undefined}>{children}</div>;
}

export function Swap({ mode, a, b }: { mode: "a" | "b"; a: ReactNode; b: ReactNode }): React.ReactElement {
  return <div key={mode} className={moves() ? "animate-[orion-rise_250ms_ease_both]" : undefined}>{mode === "a" ? a : b}</div>;
}

export function visualMotionCss(): string {
  return `@keyframes orion-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes orion-sheen{from{background-position:200% 0}to{background-position:-200% 0}}@keyframes orion-spin{to{--orion-angle:360deg}}`;
}

export function MagicBento({ cards }: { cards: string[] }): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 [&>*:first-child]:col-span-2">
      {cards.map((card) => (
        <GlareHover key={card}><div className="p-3 text-label text-ui-primary">{card}</div></GlareHover>
      ))}
    </div>
  );
}
