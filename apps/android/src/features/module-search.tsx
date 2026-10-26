import { useId, useRef } from "react";
import { Search, X } from "lucide-react";
import { DepthCard } from "../depth-card";

/** An explicit touch target also works on WebViews without a native search cancel. */
export function ModuleSearch({ placeholder, query, setQuery }: {
  placeholder: string; query: string; setQuery: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return <DepthCard><div className="search module-search">
    <Search size={20} aria-hidden="true" />
    <label className="sr-only" htmlFor={id}>Поиск</label>
    <input ref={input} id={id} type="search" placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} />
    {query && <button type="button" className="icon-button search-clear" aria-label="Очистить поиск" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={20} aria-hidden="true" /></button>}
  </div></DepthCard>;
}
