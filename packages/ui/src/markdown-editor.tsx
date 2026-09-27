"use client";

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import clsx from "clsx";
import { useEffect, useRef } from "react";

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
    ".cm-placeholder": { color: "#52525b" }
  },
  { dark: true }
);

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
  wikiLinkTargets
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
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        ...(wikiLinkTargets !== undefined
          ? [autocompletion({ override: [wikiLinkCompletionSource(wikiTargetsRef)], closeOnBlur: true })]
          : []),
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
    if (autoFocus) instance.focus();
    return () => {
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
