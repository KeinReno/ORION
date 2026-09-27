"use client";

import { useEffect, useState } from "react";
import { AutosaveStatus } from "./autosave-status";
import { Textarea } from "./primitives";

/**
 * Short operational scratchpad — save-on-blur, not per keystroke. Used by
 * Projects («Где я остановился») and the same pattern in Inventory notes /
 * document metadata. Long free-text (a note body) stays on debounce +
 * AutosaveStatus instead.
 */
export function ContextNoteField({
  value,
  busy,
  onSave,
  label = "Где я остановился",
  placeholder = "Что делал в прошлый раз, что дальше…"
}: {
  value: string;
  busy: boolean;
  onSave: (value: string) => void;
  label?: string;
  placeholder?: string;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const dirty = draft !== value;

  function commit(): void {
    if (dirty) onSave(draft);
  }

  return (
    <label className="flex flex-col gap-1 text-micro uppercase text-subtle-foreground">
      <span className="flex items-center justify-between gap-2">
        {label}
        <AutosaveStatus state={busy ? "saving" : dirty ? "dirty" : "saved"} />
      </span>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        disabled={busy}
        className="text-body text-foreground"
      />
    </label>
  );
}
