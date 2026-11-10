import type { ReactNode } from "react";
import { Card } from "./primitives";

/**
 * Small labelled number card (today's total, streak, balance) — factored out
 * of near-identical local copies in TimePanel and HabitsPanel so the look
 * (and any future tweak to it) stays in one place.
 */
export function StatCard({
  label,
  value,
  hint,
  className
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <Card className={className ? `orion-stat px-3 py-2.5 ${className}` : "orion-stat px-3 py-2.5"}>
      <p className="text-micro font-medium uppercase tracking-[0.08em] text-subtle-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-display leading-none tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1.5 text-label text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
