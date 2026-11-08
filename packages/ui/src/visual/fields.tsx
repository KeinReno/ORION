"use client";

import clsx from "clsx";
import { Check, ChevronDown, Eye, EyeOff, Minus, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { useMotionLevel } from "../motion-level";
import { clampIndex, comboboxMenuAction, glideMenuAction, stepIndex, typeaheadIndex } from "./list-keyboard";

export const visualFieldClass =
  "w-full rounded-lg border border-ui-border bg-ui-tint/[0.03] px-3 py-2 text-body text-ui-primary outline-none transition placeholder:text-ui-subtle focus:border-ui-focus/70 focus:ring-2 focus:ring-ui-focus/25";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}): React.ReactElement {
  return (
    <label className={clsx("flex flex-col gap-1 text-left", className)} htmlFor={htmlFor}>
      <span className="text-label text-ui-secondary">{label}</span>
      {children}
      {error ? <span className="text-micro text-ui-danger">{error}</span> : hint ? <span className="text-micro text-ui-subtle">{hint}</span> : null}
    </label>
  );
}

export function InputGroup({ prefix, suffix, children, className }: { prefix?: ReactNode; suffix?: ReactNode; children: ReactNode; className?: string }): React.ReactElement {
  return (
    <div className={clsx("flex items-stretch overflow-hidden rounded-lg border border-ui-border bg-ui-tint/[0.03] focus-within:border-ui-focus/70 focus-within:ring-2 focus-within:ring-ui-focus/25", className)}>
      {prefix ? <span className="flex items-center border-r border-ui-border px-2 text-label text-ui-subtle">{prefix}</span> : null}
      <div className="min-w-0 flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:ring-0">{children}</div>
      {suffix ? <span className="flex items-center border-l border-ui-border px-2 text-label text-ui-subtle">{suffix}</span> : null}
    </div>
  );
}

export function Frame({ title, children }: { title?: string; children: ReactNode }): React.ReactElement {
  return (
    <fieldset className="rounded-xl border border-ui-border p-3">
      {title ? <legend className="px-1 text-label text-ui-secondary">{title}</legend> : null}
      {children}
    </fieldset>
  );
}

export function ButtonGroup({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="inline-flex overflow-hidden rounded-lg border border-ui-border [&>button]:rounded-none [&>button]:border-0 [&>button]:border-r [&>button]:border-ui-border [&>button:last-child]:border-r-0">{children}</div>;
}

export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-body text-ui-primary">
          <input type="radio" name={label} checked={value === option.value} onChange={() => onChange(option.value)} className="accent-ui-button" />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function Combobox<T extends { id: string; label: string }>({
  label,
  items,
  value,
  onChange,
  placeholder = "Найти…",
  disabled = false,
  id
}: {
  label: string;
  items: T[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const selected = items.find((item) => item.id === value);
  const active = clampIndex(cursor, filtered.length);
  const optionId = (index: number): string => `${listId}-opt-${index}`;
  const reveal = (): void => {
    if (disabled) return;
    const selectedIndex = Math.max(0, filtered.findIndex((item) => item.id === value));
    setCursor(selectedIndex);
    setOpen(true);
  };
  const choose = (itemId: string): void => {
    onChange(itemId);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  return (
    <div className="relative" ref={rootRef}>
      <input
        ref={inputRef}
        id={id}
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? optionId(active) : undefined}
        role="combobox"
        className={visualFieldClass}
        placeholder={placeholder}
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        onFocus={() => { if (disabled) return; setQuery(""); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setCursor(0); }}
        onKeyDown={(event) => {
          const action = comboboxMenuAction(event.key, open);
          if (action === "none") return;
          if (action === "tab") { setOpen(false); setQuery(""); return; }
          event.preventDefault();
          if (action === "close") {
            event.stopPropagation();
            setOpen(false);
            setQuery("");
            return;
          }
          if (action === "open") { reveal(); return; }
          if (action === "next") setCursor((index) => stepIndex(index, filtered.length, 1));
          if (action === "prev") setCursor((index) => stepIndex(index, filtered.length, -1));
          if (action === "first") setCursor(0);
          if (action === "last") setCursor(Math.max(0, filtered.length - 1));
          if (action === "choose" && filtered[active]) choose(filtered[active].id);
        }}
        onBlur={(event) => {
          if (rootRef.current?.contains(event.relatedTarget as Node)) return;
          window.setTimeout(() => setOpen(false), 120);
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-ui-border bg-card py-1 shadow-lg">
          {filtered.length === 0 ? <li className="px-3 py-2 text-label text-ui-subtle">Ничего не нашлось</li> : filtered.map((item, index) => (
            <li key={item.id} id={optionId(index)} role="option" aria-selected={index === active}>
              <button type="button" className={clsx("block w-full px-3 py-1.5 text-left text-body", index === active ? "bg-ui-hover text-ui-primary" : "text-ui-secondary")} onMouseDown={(event) => { event.preventDefault(); choose(item.id); }}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TagsInput({
  label,
  value,
  onChange,
  placeholder = "Тег и Enter",
  chipStyle
}: {
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  chipStyle?: (tag: string) => React.CSSProperties | undefined;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const add = (raw: string): void => {
    const tag = raw.trim();
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div className="rounded-lg border border-ui-border bg-ui-tint/[0.03] p-2">
      <span className="sr-only">{label}</span>
      <ul className="mb-1 flex flex-wrap gap-1">
        {value.map((tag) => (
          <li key={tag}>
            <button type="button" className="inline-flex items-center gap-1 rounded-full bg-ui-hover px-2 py-0.5 text-label text-ui-primary" style={chipStyle?.(tag)} onClick={() => onChange(value.filter((item) => item !== tag))}>
              {tag} <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <input
        aria-label={label}
        className="w-full bg-transparent text-body text-ui-primary outline-none placeholder:text-ui-subtle"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(draft); }
          if (event.key === "Backspace" && draft === "") onChange(value.slice(0, -1));
        }}
        onBlur={() => { if (draft.trim()) add(draft); }}
      />
    </div>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}): React.ReactElement {
  const clamp = (next: number): number => {
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Меньше" className="rounded-md border border-ui-border p-1.5 text-ui-secondary hover:bg-ui-hover" onClick={() => onChange(clamp(value - step))}><Minus className="h-3.5 w-3.5" /></button>
      <input aria-label={label} inputMode="decimal" className={clsx(visualFieldClass, "text-center tabular-nums")} value={Number.isFinite(value) ? String(value) : ""} onChange={(event) => { const next = Number(event.target.value.replace(",", ".")); if (Number.isFinite(next)) onChange(clamp(next)); }} />
      <button type="button" aria-label="Больше" className="rounded-md border border-ui-border p-1.5 text-ui-secondary hover:bg-ui-hover" onClick={() => onChange(clamp(value + step))}><Plus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }): React.ReactElement {
  const [year = "", month = "", day = ""] = value.split("-");
  const set = (next: { y?: string; m?: string; d?: string }): void => {
    const y = (next.y ?? year).replace(/\D/g, "").slice(0, 4);
    const m = (next.m ?? month).replace(/\D/g, "").slice(0, 2);
    const d = (next.d ?? day).replace(/\D/g, "").slice(0, 2);
    onChange(y || m || d ? `${y}-${m}-${d}` : "");
  };
  const segment = "w-14 bg-transparent text-center text-body tabular-nums text-ui-primary outline-none";
  return (
    <div className={clsx(visualFieldClass, "flex items-center justify-between")} role="group" aria-label={label}>
      <input aria-label="День" inputMode="numeric" className={segment} value={day} placeholder="дд" onChange={(event) => set({ d: event.target.value })} />
      <span className="text-ui-subtle">.</span>
      <input aria-label="Месяц" inputMode="numeric" className={segment} value={month} placeholder="мм" onChange={(event) => set({ m: event.target.value })} />
      <span className="text-ui-subtle">.</span>
      <input aria-label="Год" inputMode="numeric" className={clsx(segment, "w-20")} value={year} placeholder="гггг" onChange={(event) => set({ y: event.target.value })} />
    </div>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? "text" : "password"} className={clsx(visualFieldClass, "pr-10", props.className)} />
      <button type="button" aria-label={shown ? "Скрыть пароль" : "Показать пароль"} className="absolute right-2 top-1/2 -translate-y-1/2 text-ui-subtle" onClick={() => setShown((value) => !value)}>
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function OtpInput({ length = 4, value, onChange, label = "Код" }: { length?: number; value: string; onChange: (value: string) => void; label?: string }): React.ReactElement {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const cells = Array.from({ length }, (_, index) => value[index] ?? "");
  return (
    <div role="group" aria-label={label} className="flex gap-2">
      {cells.map((cell, index) => (
        <input
          key={index}
          ref={(node) => { refs.current[index] = node; }}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`${label}, цифра ${index + 1}`}
          maxLength={1}
          className={clsx(visualFieldClass, "h-12 w-10 px-0 text-center text-lg tabular-nums")}
          value={cell}
          onChange={(event) => {
            const digit = event.target.value.replace(/\D/g, "").slice(-1);
            const next = (value.slice(0, index) + digit + value.slice(index + 1)).slice(0, length);
            onChange(next);
            if (digit) refs.current[index + 1]?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !cell) refs.current[index - 1]?.focus();
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (!text) return;
            event.preventDefault();
            onChange(text);
          }}
        />
      ))}
    </div>
  );
}

export function CodeSlots(props: { length?: number; value: string; onChange: (value: string) => void; label?: string }): React.ReactElement {
  const motion = useMotionLevel() !== "off";
  return <div className={motion ? "[&_input]:transition-transform [&_input:focus]:scale-105" : undefined}><OtpInput {...props} /></div>;
}

export function Editable({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button type="button" className="rounded-md px-1 text-left text-body text-ui-primary hover:bg-ui-hover" onClick={() => { setDraft(value); setEditing(true); }}>
        {value || "Без названия"}
      </button>
    );
  }
  return (
    <input
      aria-label={label}
      autoFocus
      className={visualFieldClass}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { onChange(draft.trim() || value); setEditing(false); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { onChange(draft.trim() || value); setEditing(false); }
        if (event.key === "Escape") setEditing(false);
      }}
    />
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  bare = false
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  bare?: boolean;
}): React.ReactElement {
  const control = (
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={String(value)} onChange={(event) => onChange(Number(event.target.value))} className={bare ? "w-48 accent-ui-button" : "accent-ui-button"} />
  );
  if (bare) return control;
  return (
    <label className="flex flex-col gap-1 text-label text-ui-secondary">
      {label}
      {control}
    </label>
  );
}

export function WakeSlider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }): React.ReactElement {
  const ratio = (props.value - props.min) / (props.max - props.min || 1);
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-6 flex h-3 items-end gap-0.5">
        {Array.from({ length: 16 }, (_, index) => (
          <span key={index} className="flex-1 rounded-sm bg-ui-button/70" style={{ height: index / 16 <= ratio ? `${40 + (index / 16) * 60}%` : "20%", opacity: index / 16 <= ratio ? 1 : 0.25 }} />
        ))}
      </div>
      <Slider {...props} />
    </div>
  );
}

export function ElasticSlider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }): React.ReactElement {
  const [pulled, setPulled] = useState(false);
  const motion = useMotionLevel() !== "off";
  return (
    <div className={clsx(motion && "origin-left transition-transform", pulled && motion && "scale-y-125")} onPointerDown={() => setPulled(true)} onPointerUp={() => setPulled(false)} onPointerLeave={() => setPulled(false)}>
      <Slider {...props} />
    </div>
  );
}

export function ScrubField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }): React.ReactElement {
  const start = useRef<{ x: number; value: number } | null>(null);
  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(visualFieldClass, "cursor-ew-resize text-center tabular-nums")}
      onPointerDown={(event) => { start.current = { x: event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const next = Math.round(Math.min(max, Math.max(min, start.current.value + (event.clientX - start.current.x) / 4)));
        onChange(next);
      }}
      onPointerUp={() => { start.current = null; }}
    >
      {value}
    </button>
  );
}

export function Listbox({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }): React.ReactElement {
  return (
    <ul role="listbox" aria-label={label} aria-multiselectable className="max-h-40 overflow-auto rounded-lg border border-ui-border">
      {options.map((option) => {
        const on = value.includes(option);
        return (
          <li key={option} role="option" aria-selected={on}>
            <button type="button" className={clsx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-body", on ? "bg-ui-hover text-ui-primary" : "text-ui-secondary")} onClick={() => onChange(on ? value.filter((item) => item !== option) : [...value, option])}>
              {on ? <Check className="h-3.5 w-3.5" /> : <span className="inline-block h-3.5 w-3.5" />} {option}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function GlideSelect({ label, options, value, onChange, id }: { label: string; options: string[]; value: string; onChange: (value: string) => void; id?: string }): React.ReactElement {
  const selected = Math.max(0, options.indexOf(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionId = (index: number): string => `${listId}-opt-${index}`;
  const openAt = (index: number): void => {
    setActive(clampIndex(index, options.length));
    setOpen(true);
  };
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };
  const choose = (option: string): void => {
    onChange(option);
    close(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);
  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        className={clsx(visualFieldClass, "flex items-center justify-between")}
        onClick={() => (open ? close(false) : openAt(selected))}
        onKeyDown={(event) => {
          const action = glideMenuAction(event.key, open);
          if (action === "none" && open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            setActive((index) => typeaheadIndex(options, index, event.key));
            return;
          }
          if (action === "none") return;
          if (action === "tab") { setOpen(false); return; }
          event.preventDefault();
          if (action === "close") { event.stopPropagation(); close(true); return; }
          if (action === "open") { openAt(selected); return; }
          if (action === "next") setActive((index) => stepIndex(index, options.length, 1));
          if (action === "prev") setActive((index) => stepIndex(index, options.length, -1));
          if (action === "first") setActive(0);
          if (action === "last") setActive(Math.max(0, options.length - 1));
          if (action === "choose" && options[active]) choose(options[active]);
        }}
      >
        {value} <ChevronDown className="h-4 w-4 text-ui-subtle" />
      </button>
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-ui-border bg-card py-1">
          <li aria-hidden className="pointer-events-none absolute left-1 right-1 h-8 rounded-md bg-ui-hover transition-transform" style={{ transform: `translateY(${active * 32}px)` }} />
          {options.map((option, index) => (
            <li key={option} id={optionId(index)} role="option" aria-selected={option === value} className="relative">
              <button type="button" tabIndex={-1} className="relative z-10 block h-8 w-full px-3 text-left text-body text-ui-primary" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)} onMouseEnter={() => setActive(index)}>{option}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const sector = Math.floor(h / 60) % 6;
  const table: [number, number, number][] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const rgb = table[sector] ?? table[0];
  return `#${rgb.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }): React.ReactElement {
  const [hue, setHue] = useState(40);
  const [sat, setSat] = useState(0.45);
  const [val, setVal] = useState(0.8);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label text-ui-secondary">{label}</span>
      <button
        type="button"
        aria-label="Насыщенность и яркость"
        className="relative h-28 w-full rounded-lg"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))` }}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const v = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
          setSat(s);
          setVal(v);
          onChange(hsvToHex(hue, s, v));
        }}
      />
      <input aria-label="Оттенок" type="range" min={0} max={360} value={hue} onChange={(event) => { const next = Number(event.target.value); setHue(next); onChange(hsvToHex(next, sat, val)); }} />
      <span className="font-mono text-label text-ui-primary">{value}</span>
    </div>
  );
}

export function VanishInput({ label, placeholders, value, onChange }: { label: string; placeholders: string[]; value: string; onChange: (value: string) => void }): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <input
        aria-label={label}
        className={visualFieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setIndex((item) => (item + 1) % placeholders.length); }}
      />
      {!value ? <span className={clsx("pointer-events-none absolute left-3 top-2 text-body text-ui-subtle transition", focused && "opacity-0")}>{placeholders[index]}</span> : null}
    </div>
  );
}
