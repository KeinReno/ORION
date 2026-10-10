import { cx } from "@orion/ui";
import type { ReactNode } from "react";
import { projectColor } from "../lib/format";

export function FilterChip({
  active,
  onClick,
  color,
  children
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={active && color ? projectColor(color) : undefined}
      className={cx(
        "rounded-full border px-2 py-0.5 text-2xs font-medium transition-colors",
        active
          ? color
            ? ""
            : "border-accent/40 bg-accent/10 text-accent-text"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
