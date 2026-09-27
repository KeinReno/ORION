"use client";

import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useEscapeKey } from "./hooks";

export interface FuseButtonProps {
  /** Idle label, e.g. "Архивировать". */
  label: string;
  /** Shown while armed, e.g. "Ещё раз — архив". Second click commits; Escape cancels. */
  armedLabel?: string;
  /** Shown once committed, briefly, before the caller unmounts/replaces this button. */
  doneLabel?: string;
  icon?: ComponentType<{ className?: string }>;
  /** How long the fuse burns before committing. Default 3s — long enough to change your mind, short enough not to feel stuck. */
  durationMs?: number;
  onCommit: () => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Arm-then-commit button for actions with an existing safety net (archive,
 * soft-delete to trash) where a full `ConfirmDialog` interrupt is more
 * friction than the action deserves: click once to arm, a burning fill
 * shows the window to change your mind (Escape cancels), a second click
 * commits immediately, otherwise commit happens when the fuse runs out.
 * Not for anything irreversible — `ConfirmDialog`/`Modal` stays for
 * permanent-delete flows.
 */
export function FuseButton({
  label,
  armedLabel = "Ещё раз",
  doneLabel,
  icon: Icon,
  durationMs = 3000,
  onCommit,
  size = "sm",
  className
}: FuseButtonProps): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "armed" | "settled">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  useEscapeKey(() => cancel(), phase === "armed");

  function arm(): void {
    setPhase("armed");
    timerRef.current = setTimeout(() => {
      onCommit();
      setPhase("settled");
    }, durationMs);
  }

  function cancel(): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPhase("idle");
  }

  return (
    <button
      type="button"
      disabled={phase === "settled"}
      onClick={(e) => {
        e.stopPropagation();
        if (phase === "idle") arm();
        else if (phase === "armed") {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = null;
          onCommit();
          setPhase("settled");
        }
      }}
      className={clsx(
        "relative inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 text-2xs font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default",
        size === "md" && "px-3 py-1.5 text-xs",
        phase === "settled"
          ? "border-success/30 bg-success/10 text-success"
          : phase === "armed"
            ? "border-warning/40 text-warning hover:bg-warning/10"
            : "border-border text-muted-foreground hover:border-border-strong hover:bg-white/5 hover:text-foreground",
        className
      )}
    >
      {phase === "armed" && !reduceMotion ? (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-warning/20"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: durationMs / 1000, ease: "linear" }}
        />
      ) : null}
      <span className="relative flex items-center gap-1.5">
        {phase === "settled" ? <Check className="h-3.5 w-3.5" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {phase === "idle" ? label : phase === "armed" ? armedLabel : (doneLabel ?? label)}
      </span>
    </button>
  );
}
