import { SlidersHorizontal, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/** Keeps the list reachable; collapsing never clears the current view. */
export function ModuleFilters({ name, active, children }: { name: string; active: number; children: ReactNode }) {
  return <details className="view-options">
    <summary aria-label={name}><SlidersHorizontal size={18} aria-hidden="true" /><span>Фильтры и порядок</span>{active > 0 && <span className="filter-count">{active}</span>}<ChevronDown className="disclosure-chevron" size={18} aria-hidden="true" /></summary>
    <div className="module-filters">{children}</div>
  </details>;
}
