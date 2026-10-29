"use client";

import type { UserPreference } from "@orion/shared-types";
import { Card, IconButton } from "@orion/ui";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { isApplePlatform } from "../../lib/mod-key";
import { catalogConflicts, effectiveCombo, getShortcutDef, SHORTCUT_CATALOG, type ShortcutDef } from "../../lib/shortcuts/catalog";
import { comboFromEvent, describeCombo } from "../../lib/shortcuts/combo";

/**
 * ORION-06 — rebind any catalog shortcut. "Reset" only appears once a shortcut actually differs
 * from its default (that's the only state `overrides` needs to carry — see catalog.ts's doc
 * comment). A conflict (two shortcuts the same scope can both reach, bound to the same combo) is
 * shown inline rather than blocked outright — recording still saves it, same as most apps, but the
 * person sees immediately which other command they just stepped on.
 */
export function ShortcutsSettings({
  overrides,
  onChange
}: {
  overrides: Readonly<Record<string, string>>;
  onChange: (patch: Pick<Partial<UserPreference>, "shortcutOverrides">) => void;
}): React.ReactElement {
  const isMac = useMemo(() => isApplePlatform(), []);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutDef[]>();
    for (const def of SHORTCUT_CATALOG) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return [...map.entries()];
  }, []);
  const conflicts = catalogConflicts(overrides);

  function setCombo(id: string, combo: string): void {
    onChange({ shortcutOverrides: { ...overrides, [id]: combo } });
  }
  function resetCombo(id: string): void {
    const next = { ...overrides };
    delete next[id];
    onChange({ shortcutOverrides: next });
  }

  return (
    <div data-setting="shortcuts-list" className="space-y-4">
      <p className="text-2xs text-subtle-foreground">
        Нажмите на сочетание и введите новое. Esc отменяет запись без изменений.
      </p>
      {grouped.map(([category, defs]) => (
        <Card key={category} className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">{category}</div>
          <ul className="divide-y divide-border">
            {defs.map((def) => {
              const combo = effectiveCombo(def, overrides);
              const isOverridden = overrides[def.id] !== undefined;
              const conflict = conflicts.find((entry) => entry.a === def.id || entry.b === def.id);
              const conflictWith = conflict ? getShortcutDef(conflict.a === def.id ? conflict.b : conflict.a) : undefined;
              const recording = recordingId === def.id;
              return (
                <li key={def.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{def.label}</span>
                  <button
                    type="button"
                    className={`rounded border px-2 py-1 font-mono text-xs ${recording ? "border-accent text-accent" : "border-border text-foreground hover:border-accent/60"}`}
                    onClick={() => setRecordingId(def.id)}
                    onBlur={() => setRecordingId((current) => (current === def.id ? null : current))}
                    onKeyDown={(event) => {
                      if (!recording) return;
                      event.preventDefault();
                      if (event.key === "Escape") {
                        setRecordingId(null);
                        return;
                      }
                      const captured = comboFromEvent(event);
                      if (!captured) return; // only a modifier held so far — keep waiting
                      setCombo(def.id, captured);
                      setRecordingId(null);
                    }}
                  >
                    {recording ? "Нажмите сочетание…" : combo ? describeCombo(combo, isMac) : "— не задано"}
                  </button>
                  {isOverridden ? (
                    <IconButton label="Вернуть по умолчанию" size="sm" onClick={() => resetCombo(def.id)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </IconButton>
                  ) : null}
                  {conflictWith ? (
                    <p className="w-full basis-full text-2xs text-destructive">
                      Совпадает с «{conflictWith.label}» — сработает только одно из двух действий.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
