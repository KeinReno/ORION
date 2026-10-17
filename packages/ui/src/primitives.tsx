"use client";

import clsx from "clsx";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { AlertCircle, Check, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SPRING_SNAP } from "./motion";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";

/** Short alias for `clsx`, re-exported so panels don't need it as a direct dep. */
export const cx = clsx;

type ButtonVariant = "primary" | "outline" | "ghost" | "subtle" | "danger";
type ButtonSize = "sm" | "md";
/** Bind straight to a mutation's own `isPending`/`isSuccess`/`isError` — no separate state to keep in sync. */
type ButtonStatus = "idle" | "pending" | "success" | "error";

/**
 * Shared by `Button` and `IconButton`: `isSuccess`/`isError` on a react-query
 * mutation stay true until the next `.mutate()` call — they never expire on
 * their own. So the brief flash is owned here, on the rising edge into
 * success/error, rather than trusting the caller to ever pass `"idle"` back.
 */
function useStatusFlash(status: ButtonStatus): { flash: "success" | "error" | null; transition: Transition } {
  const reduceMotion = useReducedMotion();
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const prevStatus = useRef<ButtonStatus>(status);
  useEffect(() => {
    if ((status === "success" || status === "error") && prevStatus.current !== status) {
      setFlash(status);
      prevStatus.current = status;
      const timer = setTimeout(() => setFlash(null), 1200);
      return () => clearTimeout(timer);
    }
    prevStatus.current = status;
    if (status !== "success" && status !== "error") setFlash(null);
  }, [status]);
  return { flash, transition: reduceMotion ? { duration: 0 } : SPRING_SNAP };
}

function StatusFlashIcon({ flash, transition }: { flash: "success" | "error"; transition: Transition }): React.ReactElement {
  return (
    <motion.span
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={transition}
      className={clsx("flex items-center justify-center", flash === "success" ? "text-ui-success" : "text-ui-danger")}
    >
      {flash === "success" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
    </motion.span>
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  status = "idle",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  status?: ButtonStatus;
}): React.ReactElement {
  const { flash, transition } = useStatusFlash(status);

  return (
    <button
      disabled={disabled || status === "pending"}
      className={clsx(
        "inline-flex select-none items-center justify-center gap-2 rounded-ui-button font-medium transition-[color,background-color,border-color,transform] outline-none",
        "focus-visible:ring-2 focus-visible:ring-ui-focus/60 disabled:pointer-events-none disabled:opacity-50",
        "active:scale-[0.97]",
        size === "sm" ? "px-2.5 py-1.5 text-label" : "px-4 py-2 text-body",
        variant === "primary" && "bg-ui-button text-ui-button-foreground hover:bg-ui-accent-hover",
        variant === "outline" && "border border-ui-border-strong bg-transparent text-ui-primary hover:bg-ui-hover",
        variant === "ghost" && "bg-ui-tint/5 text-ui-primary hover:bg-ui-tint/10",
        variant === "subtle" && "bg-transparent text-ui-secondary hover:bg-ui-tint/5 hover:text-ui-primary",
        variant === "danger" && "bg-ui-danger/10 text-ui-danger hover:bg-ui-danger/20",
        className
      )}
      {...props}
    >
      {status === "pending" ? <Spinner className="h-4 w-4" /> : null}
      {flash ? <StatusFlashIcon flash={flash} transition={transition} /> : null}
      {children}
    </button>
  );
}

/**
 * Square, icon-only button. `label` is required and becomes the accessible
 * name (and the native tooltip) — an icon on its own tells a screen reader
 * nothing. `status` swaps the icon for a spinner/flash the same way `Button`
 * does — see e.g. calendar-connections.tsx's sync button.
 */
export function IconButton({
  className,
  label,
  tone = "default",
  size = "md",
  status = "idle",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "default" | "danger";
  size?: "sm" | "md";
  status?: ButtonStatus;
}): React.ReactElement {
  const { flash, transition } = useStatusFlash(status);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || status === "pending"}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-md text-ui-secondary transition-[color,background-color,transform] outline-none",
        "focus-visible:ring-2 focus-visible:ring-ui-focus/60 active:scale-[0.93]",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        tone === "default" && "hover:bg-ui-tint/10 hover:text-ui-primary",
        tone === "danger" && "hover:bg-ui-danger/15 hover:text-ui-danger",
        className
      )}
      {...props}
    >
      {status === "pending" ? <Spinner className="h-4 w-4" /> : flash ? <StatusFlashIcon flash={flash} transition={transition} /> : children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-lg border border-ui-border bg-ui-tint/[0.03] px-3 py-2 text-body text-ui-primary transition-colors",
        "placeholder:text-ui-subtle outline-none focus:border-ui-focus/70 focus:ring-2 focus:ring-ui-focus/25",
        props.className
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full rounded-lg border border-ui-border bg-ui-tint/[0.03] px-3 py-2 text-body text-ui-primary transition-colors",
        "placeholder:text-ui-subtle outline-none focus:border-ui-focus/70 focus:ring-2 focus:ring-ui-focus/25",
        props.className
      )}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  return (
    <select
      {...props}
      className={clsx(
        // py-2 matches Input/Button(md) — Select used to carry its own
        // py-1.5, ~4px shorter at default density than every other control
        // it sits next to in a form row (S12 control-height audit).
        // A native select is as wide as its longest option; min-w-0/max-w-full keep a
        // long option from stretching the card or form it sits in.
        "min-w-0 max-w-full rounded-lg border border-ui-border bg-ui-tint/[0.03] px-2.5 py-2 text-body text-ui-primary transition-colors",
        "outline-none focus:border-ui-focus/70 focus:ring-2 focus:ring-ui-focus/25",
        "[&>option]:bg-ui-overlay [&>option]:text-ui-primary",
        className
      )}
    />
  );
}

export function Card({
  className,
  interactive,
  elevate,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  /** Subtle hover lift (translate + shadow) for cards in a grid that aren't themselves a click target — their actions live inside. */
  elevate?: boolean;
}): React.ReactElement {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-border bg-card p-4",
        interactive && "cursor-pointer transition-colors hover:border-border-strong hover:bg-card-hover",
        elevate && "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg hover:shadow-black/30",
        className
      )}
      {...props}
    />
  );
}

type BadgeTone = "neutral" | "accent" | "danger" | "success" | "warning";

const BADGE_STATUS_ICON: Partial<Record<BadgeTone, typeof AlertCircle>> = {
  danger: AlertCircle,
  warning: TriangleAlert
};

export function Badge({
  tone = "neutral",
  className,
  style,
  icon,
  children
}: {
  tone?: BadgeTone;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Danger/warning duplicate colour with a glyph so status isn't colour-only.
   * Defaults on for labelled chips; stays off for count pips (`2`, `9+`) —
   * the number is already the shape, and a second circle on a bell looks like
   * a reflected icon rather than a count.
   */
  icon?: boolean;
  children: ReactNode;
}): React.ReactElement {
  const countOnly =
    typeof children === "number" || (typeof children === "string" && /^\d+\+?$/.test(children.trim()));
  const StatusIcon = (icon ?? !countOnly) ? BADGE_STATUS_ICON[tone] : undefined;
  return (
    <span
      style={style}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-none",
        tone === "neutral" && "border-border text-muted-foreground",
        tone === "accent" && "border-accent/30 bg-accent/10 text-accent-text",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        className
      )}
    >
      {StatusIcon ? <StatusIcon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Monospace keyboard-hint chip, e.g. for the ⌘K palette affordance. */
export function Kbd({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <kbd className="rounded border border-border bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }): React.ReactElement {
  return <div className={clsx("animate-pulse rounded-md bg-white/[0.06]", className)} />;
}

export function Spinner({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={clsx("inline-block animate-spin rounded-full border-2 border-white/20 border-t-white/70", className ?? "h-4 w-4")}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "neutral"
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  /** `danger` — load/save error. `success` — empty-as-victory (inbox cleared). */
  tone?: "neutral" | "danger" | "success";
}): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      {Icon ? (
        <span
          className={clsx(
            "flex h-11 w-11 items-center justify-center rounded-full",
            tone === "danger" && "bg-destructive/10 text-destructive",
            tone === "success" && "bg-accent/10 text-accent-text",
            tone === "neutral" && "bg-white/[0.04] text-muted-foreground"
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-title text-foreground">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-label text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Required when `label` is only an icon: the button's accessible name (also shown as a tooltip). */
  ariaLabel?: string;
  /** Extra `data-*` attributes for the button (e.g. a drag-handle marker the app reads). */
  dataAttrs?: Record<`data-${string}`, string>;
}

/** Compact tab-like switch (view modes, sort order). Fully keyboard-operable. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  "aria-label": groupLabel
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** Names the group for assistive tech ("Вид списка"). */
  "aria-label"?: string;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label={groupLabel}
      className={clsx("inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-white/[0.02] p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={option.ariaLabel}
            title={option.ariaLabel}
            {...option.dataAttrs}
            onClick={() => onChange(option.value)}
            className={clsx(
              "rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              size === "sm" ? "px-2 py-1 text-2xs" : "px-2.5 py-1 text-label",
              active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Divider({ className }: { className?: string }): React.ReactElement {
  return <div className={clsx("h-px w-full bg-border", className)} />;
}
