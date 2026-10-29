"use client";

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from "@codemirror/autocomplete";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, type KeyBinding } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import clsx from "clsx";
import { useEffect, useRef, type MutableRefObject } from "react";
import { applyFormat, type FormatCommand } from "./markdown-format";
import { filterSlashCommands, isSlashTrigger, type SlashCommand } from "./markdown-slash";

/** Autocomplete note titles right after a `[[`. Reads the ref so a title-list refresh needs no view rebuild. */
function wikiLinkCompletionSource(targetsRef: { current: string[] }) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^[\]|]*/);
    if (!before || before.to - before.from < 2) return null;
    const typed = before.text.slice(2).toLowerCase();
    const options: Completion[] = targetsRef.current
      .filter((title) => title.toLowerCase().includes(typed))
      .slice(0, 50)
      .map((title) => ({ label: title, type: "text", apply: `${title}]]` }));
    if (options.length === 0) return null;
    return { from: before.from + 2, options, validFor: /^[^[\]|]*$/ };
  };
}

/**
 * The «/» menu: after a `/` that starts a line (or follows a space) offer blocks to insert. Matching is done
 * by `filterSlashCommands`, so CodeMirror's own fuzzy filter is off for this source.
 */
function slashCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const typed = ctx.matchBefore(/\/[^\s/]*/);
  if (!typed) return null;
  const line = ctx.state.doc.lineAt(typed.from);
  const before = ctx.state.doc.sliceString(line.from, typed.from);
  const charBefore = before.length === 0 ? undefined : before[before.length - 1];
  if (!isSlashTrigger(charBefore)) return null;
  const atLineStart = before.trim() === "";
  const commands = filterSlashCommands(typed.text.slice(1), atLineStart);
  if (commands.length === 0) return null;
  return {
    from: typed.from,
    filter: false,
    // No `validFor`: the list is narrowed by us, so it must be asked again after every keystroke.
    options: commands.map((command) => slashOption(command))
  };
}

function slashOption(command: SlashCommand): Completion {
  return {
    label: command.label,
    detail: command.detail,
    type: "keyword",
    apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
      const caret = from + (command.caret ?? command.insert.length);
      view.dispatch({
        changes: { from, to, insert: command.insert },
        selection: EditorSelection.range(caret, caret + (command.select ?? 0)),
        userEvent: "input.complete",
        scrollIntoView: true
      });
    }
  };
}

/** Source-mode markdown highlighting — Obsidian-ish: markers dimmed, structure legible, no rainbow. */
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.3em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.15em" },
  { tag: t.heading3, fontWeight: "700", fontSize: "1.05em" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "rgb(var(--orion-accent-hover, 124 127 243))", textDecoration: "underline" },
  { tag: t.url, color: "rgb(var(--orion-accent-hover, 129 140 248))" },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: "rgb(var(--orion-code-text, 199 210 254))" },
  { tag: [t.meta, t.processingInstruction], color: "rgb(var(--orion-color-subtle, 113 113 122))" },
  { tag: t.quote, color: "rgb(var(--orion-color-secondary, 161 161 170))" },
  { tag: t.list, color: "rgb(var(--orion-color-secondary, 161 161 170))" },
  { tag: t.contentSeparator, color: "rgb(var(--orion-color-subtle, 82 82 91))" }
]);

const editorTheme = EditorView.theme(
  {
    // No fixed height: the view grows with its content and the surrounding
    // panel scroll region (title + body + tags together) does the scrolling,
    // Obsidian-style — rather than a scrollbar boxed inside the editor.
    // Fill the host. A sibling format rail must not become the column's minimum width
    // (see the project capture board): otherwise the body wraps one glyph per line.
    "&": { color: "rgb(var(--orion-color-text, 244 244 245))", backgroundColor: "transparent", fontSize: "14px", width: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      lineHeight: "1.65",
      minWidth: "0"
    },
    ".cm-content": { padding: "2px 0", caretColor: "#6366f1", minWidth: "0" },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#6366f1" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(99,102,241,0.25)"
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": { display: "none" },
    ".cm-placeholder": { color: "rgb(var(--orion-color-subtle, 82 82 91))" },
    // The «/» and wiki-link menus: a card like the rest of the app, not CodeMirror's default grey box.
    ".cm-tooltip": { border: "1px solid rgb(var(--orion-color-border, 44 44 53))", borderRadius: "12px", backgroundColor: "rgb(var(--orion-color-elevated, 22 22 26))", overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: "13px",
      minWidth: "16rem",
      maxHeight: "16rem",
      padding: "4px"
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "baseline", gap: "10px", padding: "5px 8px", borderRadius: "8px", color: "rgb(var(--orion-color-secondary, 212 212 216))", lineHeight: "1.4" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(99,102,241,0.22)", color: "rgb(var(--orion-color-text, 250 250 250))" },
    ".cm-completionIcon": { display: "none" },
    ".cm-completionLabel": { flexShrink: "0" },
    ".cm-completionDetail": { marginLeft: "auto", fontStyle: "normal", color: "rgb(var(--orion-color-subtle, 113 113 122))", fontSize: "12px", whiteSpace: "nowrap" }
  },
  { dark: true }
);

/** Imperative handle for the formatting toolbar: it never touches CodeMirror itself. */
export interface MarkdownEditorApi {
  format: (command: FormatCommand) => void;
  /** Format a range captured earlier (a context-menu click may have moved the caret). */
  formatRange: (command: FormatCommand, range: { from: number; to: number }) => void;
  /** Replace a captured range. Used by cut/paste from the selection menu. */
  replaceRange: (range: { from: number; to: number }, insert: string) => void;
  focus: () => void;
  /** The main selection when it is non-empty. Offsets are into the current document. */
  selection: () => { from: number; to: number; text: string } | null;
}

/**
 * ORION-06 — the editor doesn't know about the Shortcut Manager (`apps/web/lib/shortcuts`,
 * decidedly one layer up: packages/ui stays app-logic-free); it just takes the CURRENT combo for
 * each command as a plain string ("mod+shift+x") and turns it into CodeMirror's own key-name
 * format ("Mod-Shift-X"). `note-editor.tsx` is what actually reads the registry and passes the
 * live values down, so a rebind takes effect without this file ever importing from apps/web.
 */
const CM_SPECIAL_KEYS: Record<string, string> = {
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  " ": "Space"
};

function comboToCodeMirrorKey(combo: string): string | null {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const key = parts.filter((part) => part !== "mod" && part !== "shift" && part !== "alt").pop();
  if (!key) return null;
  const mods: string[] = [];
  if (parts.includes("mod")) mods.push("Mod");
  if (parts.includes("alt")) mods.push("Alt");
  if (parts.includes("shift")) mods.push("Shift");
  return [...mods, CM_SPECIAL_KEYS[key] ?? key].join("-");
}

/** All format commands bound to their current combo, plus "selection → task" if wired up. */
function buildFormatKeymap(
  combos: Partial<Record<FormatCommand, string>>,
  convertToTask?: { combo: string; onInvoke: (selectedText: string) => void }
): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const [command, combo] of Object.entries(combos) as [FormatCommand, string | undefined][]) {
    if (!combo) continue;
    const key = comboToCodeMirrorKey(combo);
    if (!key) continue;
    bindings.push({
      key,
      preventDefault: true,
      run: (target) => {
        formatView(target, command);
        return true;
      }
    });
  }
  if (convertToTask) {
    const key = comboToCodeMirrorKey(convertToTask.combo);
    if (key) {
      bindings.push({
        key,
        preventDefault: true,
        run: (target) => {
          const { from, to } = target.state.selection.main;
          const text = target.state.sliceDoc(from, to).trim();
          if (text !== "") convertToTask.onInvoke(text);
          return true;
        }
      });
    }
  }
  return bindings;
}

/** One undoable transaction: the replacement and the restored selection together. */
function formatView(view: EditorView, command: FormatCommand, range?: { from: number; to: number }): void {
  const current = range ?? view.state.selection.main;
  const result = applyFormat(view.state.doc.toString(), { from: current.from, to: current.to }, command);
  view.dispatch({
    changes: { from: result.from, to: result.to, insert: result.insert },
    selection: EditorSelection.range(result.anchor, result.head),
    userEvent: "input.format",
    scrollIntoView: true
  });
  view.focus();
}

function replaceRange(view: EditorView, range: { from: number; to: number }, insert: string): void {
  const caret = range.from + insert.length;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(caret),
    userEvent: "input",
    scrollIntoView: true
  });
  view.focus();
}

/** Defaults used only if the caller doesn't pass `formatCombos` — kept so the editor still works standalone. */
const DEFAULT_FORMAT_COMBOS: Partial<Record<FormatCommand, string>> = {
  bold: "mod+b",
  italic: "mod+i",
  code: "mod+e",
  strike: "mod+shift+x",
  link: "mod+shift+k"
};

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Cmd/Ctrl+S inside the editor. */
  onSave?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  /** Note titles to offer as `[[wiki link]]` autocomplete. Omit to disable it. */
  wikiLinkTargets?: string[];
  /**
   * ORION-06 — the live, rebind-aware combo for each format command ("mod+shift+x", CodeMirror's
   * own key syntax is derived from this, not stored anywhere). Omit a command to leave it with no
   * keyboard shortcut at all (still reachable from the toolbar). Caller owns the Shortcut Manager
   * lookup — see this file's `comboToCodeMirrorKey` doc comment for why.
   */
  formatCombos?: Partial<Record<FormatCommand, string>>;
  /** "Selection → task": fires with the trimmed selected text; a no-op binding if either half is missing. */
  convertToTaskCombo?: string;
  onConvertToTask?: (selectedText: string) => void;
  /** Filled with the toolbar handle once the view exists; cleared on unmount. */
  apiRef?: MutableRefObject<MarkdownEditorApi | null>;
}

/**
 * CodeMirror 6 in markdown source mode — the note-body editor (see
 * docs/HISTORY.md v0.9 phase 2). Controlled: `value` in, `onChange` out. The
 * view is created once on mount; external `value` changes (switching notes,
 * reverting) are reconciled without stomping the cursor on the user's own
 * keystrokes. The format keymap is the one thing that CAN change live without
 * a remount — rebinding a shortcut in Settings should take effect in an
 * already-open note — via a `Compartment` reconfigured in its own effect.
 */
export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder,
  autoFocus,
  readOnly,
  className,
  wikiLinkTargets,
  formatCombos,
  convertToTaskCombo,
  onConvertToTask,
  apiRef
}: MarkdownEditorProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const formatKeymapCompartment = useRef(new Compartment()).current;
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onConvertToTaskRef = useRef(onConvertToTask);
  const wikiTargetsRef = useRef<string[]>(wikiLinkTargets ?? []);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onConvertToTaskRef.current = onConvertToTask;
  wikiTargetsRef.current = wikiLinkTargets ?? [];

  function currentFormatKeymap(): KeyBinding[] {
    const combos = formatCombos ?? DEFAULT_FORMAT_COMBOS;
    return buildFormatKeymap(
      combos,
      convertToTaskCombo ? { combo: convertToTaskCombo, onInvoke: (text) => onConvertToTaskRef.current?.(text) } : undefined
    );
  }

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            }
          }
        ]),
        Prec.highest(formatKeymapCompartment.of(keymap.of(currentFormatKeymap()))),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        autocompletion({
          override: [...(wikiLinkTargets !== undefined ? [wikiLinkCompletionSource(wikiTargetsRef)] : []), slashCompletionSource],
          closeOnBlur: true
        }),
        cmPlaceholder(placeholder ?? ""),
        editorTheme,
        EditorState.readOnly.of(Boolean(readOnly)),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        })
      ]
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    if (apiRef) {
      apiRef.current = {
        format: (command) => formatView(instance, command),
        formatRange: (command, range) => formatView(instance, command, range),
        replaceRange: (range, insert) => replaceRange(instance, range, insert),
        focus: () => instance.focus(),
        selection: () => {
          const { from, to } = instance.state.selection.main;
          if (from === to) return null;
          return { from, to, text: instance.state.sliceDoc(from, to) };
        }
      };
    }
    if (autoFocus) instance.focus();
    return () => {
      if (apiRef) apiRef.current = null;
      instance.destroy();
      view.current = null;
    };
    // Mount-once: prop changes flow in through the effects/refs below, not a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (value !== current) {
      instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Serialized so an unrelated re-render (parent recreating the object literal) doesn't reconfigure
  // CodeMirror on every keystroke — only an actual combo value change dispatches an effect.
  const comboKey = JSON.stringify([formatCombos ?? DEFAULT_FORMAT_COMBOS, convertToTaskCombo ?? null]);
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: formatKeymapCompartment.reconfigure(keymap.of(currentFormatKeymap())) });
    // currentFormatKeymap reads formatCombos/convertToTaskCombo via closure; comboKey is their stable fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboKey]);

  return <div ref={host} className={clsx("w-full", className)} />;
}
