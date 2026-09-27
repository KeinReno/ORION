"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { cx, Spinner } from "../primitives";

type Grid = Array<Array<string | number | boolean | null>>;

const MAX_ROWS = 500;
const MAX_COLS = 60;

export default function SheetView({
  url,
  name,
  className
}: {
  url: string;
  name: string;
  className?: string;
}): React.ReactElement {
  const [sheets, setSheets] = useState<Array<{ name: string; grid: Grid }> | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const wb = XLSX.read(buf, { type: "array" });
        const parsed = wb.SheetNames.map((sheetName) => {
          const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(wb.Sheets[sheetName], {
            header: 1,
            blankrows: false,
            defval: null
          });
          return { name: sheetName, grid: rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLS)) };
        });
        if (!alive) return;
        setSheets(parsed);
        setActive(0);
        setState("ok");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const current = sheets?.[active];
  const truncated = useMemo(() => {
    if (!current) return false;
    return current.grid.length >= MAX_ROWS || current.grid.some((r) => r.length >= MAX_COLS);
  }, [current]);

  if (state === "error") return <div className="p-6 text-sm text-muted-foreground">Не удалось открыть таблицу.</div>;
  if (state === "loading" || !sheets || !current) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className={cx("flex h-full flex-col", className)}>
      {sheets.length > 1 ? (
        <div className="orion-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={cx(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                i === active ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="orion-scroll min-h-0 flex-1 overflow-auto p-3">
        {truncated ? (
          <p className="mb-2 text-2xs text-subtle-foreground">
            Показаны первые {MAX_ROWS} строк / {MAX_COLS} столбцов файла «{name}».
          </p>
        ) : null}
        <table className="border-collapse text-xs">
          <tbody>
            {current.grid.map((row, r) => (
              <tr key={r}>
                <td className="sticky left-0 border border-border bg-card px-2 py-1 text-right text-subtle-foreground">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td key={c} className="border border-border px-2 py-1 text-foreground">
                    {cell === null ? "" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
