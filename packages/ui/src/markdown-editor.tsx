"use client";

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection } from "@codemirror/view";
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
  { tag: t.link, color: "#7c7ff3", textDecoration: "underline" },
  { tag: t.url, color: "#818cf8" },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: "#c7d2fe" },
  { tag: [t.meta, t.processingInstruction], color: "#71717a" },
  { tag: t.quote, color: "#a1a1aa" },
  { tag: t.list, color: "#a1a1aa" },
  { tag: t.contentSeparator, color: "#52525b" }
]);

const editorTheme = EditorView.theme(
  {
    // No fixed height: the view grows with its content and the surrounding
    // panel scroll region (title + body + tags together) does the scrolling,
    // Obsidian-style — rather than a scrollbar boxed inside the editor.
    "&": { color: "#f4f4f5", backgroundColor: "transparent", fontSize: "14px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      lineHeight: "1.65"
    },
    ".cm-content": { padding: "2px 0", caretColor: "#6366f1" },
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#6366f1" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(99,102,241,0.25)"
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-gutters": { display: "none" },
    ".cm-placeholder": { color: "#52525b" },
    // The «/» and wiki-link menus: a card like the rest of the app, not CodeMirror's default grey box.
    ".cm-tooltip": { border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", backgroundColor: "#16161a", overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.45)" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: "13px",
      minWidth: "16rem",
      maxHeight: "16rem",
      padding: "4px"
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "baseline", gap: "10px", padding: "5px 8px", borderRadius: "8px", color: "#d4d4d8", lineHeight: "1.4" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(99,102,241,0.22)", color: "#fafafa" },
    ".cm-completionIcon": { display: "none" },
    ".cm-completionLabel": { flexShrink: "0" },
    ".cm-completionDetail": { marginLeft: "auto", fontStyle: "normal", color: "#71717a", fontSize: "12px", whiteSpace: "nowrap" }
  },
  { dark: true }
);

/** Imperative handle for the formatting toolbar: it never touches CodeMirror itself. */
export interface MarkdownEditorApi {
  format: (command: FormatCommand) => void;
  focus: () => void;
}

/** One undoable transaction: the replacement and the restored selection together. */
function formatView(view: EditorView, command: FormatCommand): void {
  const range = view.state.selection.main;
  const result = applyFormat(view.state.doc.toString(), { from: range.from, to: range.to }, command);
  view.dispatch({
    changes: { from: result.from, to: result.to, insert: result.insert },
    selection: EditorSelection.range(result.anchor, result.head),
    userEvent: "input.format",
    scrollIntoView: true
  });
  view.focus();
}

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
  /** Filled with the toolbar handle once the view exists; cleared on unmount. */
  apiRef?: MutableRefObject<MarkdownEditorApi | null>;
}

/**
 * CodeMirror 6 in markdown source mode — the note-body editor (see
 * docs/PLAN.md v0.9 phase 2). Controlled: `value` in, `onChange` out. The
 * view is created once on mount; external `value` changes (switching notes,
 * reverting) are reconciled without stomping the cursor on the user's own
 * keystrokes.
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
  apiRef
}: MarkdownEditorProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const wikiTargetsRef = useRef<string[]>(wikiLinkTargets ?? []);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  wikiTargetsRef.current = wikiLinkTargets ?? [];

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
          },
          // Same commands as the toolbar. Mod-K is taken by the command palette,
          // so the link shortcut is Mod-Shift-K.
          ...(
            [
              ["Mod-b", "bold"],
              ["Mod-i", "italic"],
              ["Mod-e", "code"],
              ["Mod-Shift-x", "strike"],
              ["Mod-Shift-k", "link"]
            ] as const
          ).map(([key, command]) => ({
            key,
            preventDefault: true,
            run: (target: EditorView) => {
              formatView(target, command);
              return true;
            }
          })),
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap
        ]),
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
    if (apiRef) apiRef.current = { format: (command) => formatView(instance, command), focus: () => instance.focus() };
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

  return <div ref={host} className={clsx("w-full", className)} />;
}
