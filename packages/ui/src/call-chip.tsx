"use client";

import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type CallChipStatus = "running" | "done" | "error";

export interface CallChipProps {
  label: string;
  sublabel?: string;
  status: CallChipStatus;
  onRetry?: () => void;
  className?: string;
}

/**
 * Feedback chip for an async operation that isn't instant — first use is
 * Documents upload, which used to give zero feedback between "click Upload"
 * and the success toast. There is deliberately no real progress bar: ORION's
 * `ApiClient` is fetch-based (see its doc comment — it's the one place HTTP
 * lives, retry-on-401 included), and `fetch` has no cross-browser upload
 * progress event without dropping to `XMLHttpRequest` for this one call,
 * which would fork that contract for a cosmetic bar. The sweeping fill is
 * honestly indeterminate — "still working," not "73% done."
 */
export function CallChip({ label, sublabel, status, onRetry, className }: CallChipProps): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (status !== "running") return;
    startRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, [status]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: status === "error" && !reduceMotion ? [0, -6, 6, -4, 4, 0] : 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: status === "error" ? 0.4 : 0.2, ease: "easeOut" }}
      className={clsx(
        "relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg shadow-black/20",
        className
      )}
    >
      {status === "running" && !reduceMotion ? (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 w-2/5 bg-accent/15"
          initial={{ x: "-100%" }}
          animate={{ x: "250%" }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
        />
      ) : null}
      {status === "done" ? <span aria-hidden className="absolute inset-0 bg-success/10" /> : null}
      {status === "error" ? <span aria-hidden className="absolute inset-0 bg-destructive/10" /> : null}

      <span
        className={clsx(
          "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          status === "done"
            ? "bg-success/20 text-success"
            : status === "error"
              ? "bg-destructive/20 text-destructive"
              : "bg-accent/20 text-accent-text"
        )}
      >
        {status === "done" ? (
          <Check className="h-3.5 w-3.5" />
        ) : status === "error" ? (
          <X className="h-3.5 w-3.5" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{label}</span>
        {sublabel ? <span className="block truncate text-subtle-foreground">{sublabel}</span> : null}
      </span>

      <span className="relative shrink-0 font-mono tabular-nums text-subtle-foreground">
        {status === "running" ? `${(elapsedMs / 1000).toFixed(1)}с` : status === "done" ? "готово" : "ошибка"}
      </span>

      {status === "error" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Повторить"
          className="relative shrink-0 rounded-md p-1 text-destructive transition-colors hover:bg-destructive/15"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </motion.div>
  );
}
