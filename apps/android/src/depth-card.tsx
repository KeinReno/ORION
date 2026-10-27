import type { ReactNode } from "react";

/** Card depth is relative to the common content plane, without per-card perspective. */
export function DepthCard({ children, className = "", elevation = "card" }: { children: ReactNode; className?: string; elevation?: "base" | "card" }) {
  return <div data-elevation={elevation} className={"depth-card " + className}><div className="depth-card-body">{children}</div></div>;
}
