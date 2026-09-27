"use client";

import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "./hooks";

export type ToastTone = "default" | "success" | "danger";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Optional single action button (e.g. "Отменить"). */
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 4000. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Minimal toast stack (no `sonner` dependency). Mount once near the app
 * root; panels fire `useToast().toast(...)` after a mutation settles.
 */
export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const mounted = useMounted();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions): number => {
      const id = ++seq.current;
      setToasts((list) => [...list, { ...options, id }]);
      const duration = options.duration ?? (options.action ? 8000 : 4000);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }
      return id;
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted
        ? createPortal(
            <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
              <AnimatePresence initial={false}>
                {toasts.map((t) => (
                  <motion.div
                    key={t.id}
                    layout
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.7}
                    onDragEnd={(_event, info) => {
                      if (Math.abs(info.offset.x) > 80 || Math.abs(info.velocity.x) > 500) dismiss(t.id);
                    }}
                    initial={{ opacity: 0, x: 24, scale: 0.98 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 24, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className={clsx(
                      "pointer-events-auto relative touch-pan-y overflow-hidden rounded-xl border bg-card/90 p-3 shadow-xl shadow-black/40 backdrop-blur-md",
                      t.tone === "success" && "border-success/30",
                      t.tone === "danger" && "border-destructive/30",
                      (!t.tone || t.tone === "default") && "border-border"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={clsx(
                          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                          t.tone === "success" && "bg-success",
                          t.tone === "danger" && "bg-destructive",
                          (!t.tone || t.tone === "default") && "bg-accent"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground">{t.title}</p>
                        {t.description ? <p className="mt-0.5 text-2xs text-muted-foreground">{t.description}</p> : null}
                        {t.action ? (
                          <button
                            type="button"
                            onClick={() => {
                              t.action?.onClick();
                              dismiss(t.id);
                            }}
                            className="mt-1.5 text-2xs font-medium text-accent hover:text-accent-hover"
                          >
                            {t.action.label}
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => dismiss(t.id)}
                        aria-label="Закрыть"
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/*
                     * Burning countdown along the bottom edge — the visual
                     * cue that this one is about to auto-dismiss (and roughly
                     * how much longer), same "fuse" metaphor as `FuseButton`.
                     * Only for auto-dismissing toasts (`duration > 0`); one
                     * that stays until dismissed shouldn't imply a countdown
                     * that never ends.
                     */}
                    {(t.duration ?? 4000) > 0 ? (
                      <motion.span
                        aria-hidden
                        className={clsx(
                          "absolute inset-x-0 bottom-0 h-0.5 origin-left",
                          t.tone === "success" ? "bg-success/50" : t.tone === "danger" ? "bg-destructive/50" : "bg-accent/50"
                        )}
                        initial={{ scaleX: 1 }}
                        animate={{ scaleX: 0 }}
                        transition={{ duration: (t.duration ?? 4000) / 1000, ease: "linear" }}
                      />
                    ) : null}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

/** Returns a no-op-safe toast API; throws only if the provider is truly absent. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast() must be used inside <ToastProvider>");
  return api;
}
