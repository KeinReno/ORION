"use client";

import MarkdownIt from "markdown-it";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "./hooks";

/**
 * One shared markdown-it instance for note bodies. `html: false` — raw HTML
 * in a note is never rendered, so there's no XSS surface to sanitise;
 * `linkify` turns bare URLs into links. Deliberately no plugins: this is a
 * personal notes renderer, not a CMS.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

/** GitHub-ish slug: lowercased, spaces → dashes, punctuation dropped. Cyrillic is kept. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

// Give every heading an `id` (deduped) so the outline can scroll to it.
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const store = (env ||= {}) as { __slugs?: Map<string, number> };
  const seen = (store.__slugs ??= new Map<string, number>());
  const inline = tokens[idx + 1];
  const raw = inline && inline.type === "inline" ? inline.content : "";
  let slug = slugify(raw) || "heading";
  const n = seen.get(slug) ?? 0;
  seen.set(slug, n + 1);
  if (n > 0) slug = `${slug}-${n}`;
  tokens[idx].attrSet("id", slug);
  return self.renderToken(tokens, idx, options);
};

// External links never replace the app's own page: they open in a new tab (and drop the opener), unless the host
// intercepts the click (see `onExternalLink`).
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx].attrGet("href") ?? "");
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// `[[Target]]` / `[[Target|alias]]` → <a data-wikilink="Target" class="orion-wikilink">alias</a>.
// Registered before "link" so it wins on the leading `[`. No nested brackets.
const OPEN_BRACKET = 0x5b; // "["
md.inline.ruler.before("link", "wikilink", (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== OPEN_BRACKET || state.src.charCodeAt(start + 1) !== OPEN_BRACKET) {
    return false;
  }
  const close = state.src.indexOf("]]", start + 2);
  if (close < 0) return false;
  const inner = state.src.slice(start + 2, close);
  if (inner.length === 0 || inner.includes("[") || inner.includes("]")) return false;
  const pipe = inner.indexOf("|");
  const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  if (!target) return false;
  const label = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim() || target;
  if (!silent) {
    const open = state.push("wikilink_open", "a", 1);
    open.attrSet("data-wikilink", target);
    open.attrSet("class", "orion-wikilink");
    const text = state.push("text", "", 0);
    text.content = label;
    state.push("wikilink_close", "a", -1);
  }
  state.pos = close + 2;
  return true;
});

export function renderMarkdown(source: string): string {
  return md.render(source ?? "", {});
}

/** Target of the `[[wiki link]]` the user clicked in a rendered `MarkdownView`. */
export function wikiLinkFromEvent(event: { target: EventTarget | null }): string | null {
  const el = event.target instanceof Element ? event.target.closest("a.orion-wikilink") : null;
  return el?.getAttribute("data-wikilink") ?? null;
}

export interface OutlineItem {
  /** 1–6 */
  level: number;
  text: string;
  /** matches the `id` on the rendered heading */
  slug: string;
  /** 0-based source line, for jumping the editor */
  line: number;
}

/** Pulls the heading tree out of a markdown string, in document order. */
export function markdownOutline(source: string): OutlineItem[] {
  const tokens = md.parse(source ?? "", {});
  const seen = new Map<string, number>();
  const items: OutlineItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const inline = tokens[i + 1];
    const text = inline && inline.type === "inline" ? inline.content : "";
    let slug = slugify(text) || "heading";
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    items.push({
      level: Number(token.tag.slice(1)),
      text,
      slug,
      line: token.map ? token.map[0] : 0
    });
  }
  return items;
}

/**
 * Read-only render of a markdown note body. No `prose` plugin in this
 * project, so the type scale is spelled out with arbitrary-variant
 * selectors — same approach as `Select`'s `[&>option]` styling.
 */
export function MarkdownView({
  source,
  className,
  onWikiLink,
  onExternalLink,
  getWikiLinkPreview
}: {
  source: string;
  className?: string;
  /** Called with the target title when a `[[wiki link]]` in the rendered body is clicked. */
  onWikiLink?: (target: string) => void;
  /**
   * A plain click on an http(s) link in the rendered body: the host takes it (ORION opens it in its built-in browser). Not
   * called for a click with Ctrl/Cmd/Shift/Alt or the middle button — those keep the browser's own behaviour (a new tab).
   */
  onExternalLink?: (href: string) => void;
  /** Resolves a hovered `[[wiki link]]`'s target to a preview, if the note exists — no preview shown if it doesn't. */
  getWikiLinkPreview?: (target: string) => { title: string; snippet: string } | undefined;
}): React.ReactElement {
  const mounted = useMounted();
  const reduceMotion = useReducedMotion();
  const [hover, setHover] = useState<{ target: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function handleMouseOver(e: React.MouseEvent<HTMLDivElement>): void {
    if (!getWikiLinkPreview) return;
    const target = wikiLinkFromEvent(e.nativeEvent);
    if (!target) return;
    if (hover?.target === target) return;
    if (timer.current) clearTimeout(timer.current);
    const el = e.target as Element;
    const link = el.closest("a.orion-wikilink");
    if (!link) return;
    const rect = link.getBoundingClientRect();
    timer.current = setTimeout(() => setHover({ target, rect }), 250);
  }
  function handleMouseOut(e: React.MouseEvent<HTMLDivElement>): void {
    // Moving within the same link (e.g. onto its own text node) isn't a real leave.
    const next = e.relatedTarget instanceof Element ? e.relatedTarget.closest("a.orion-wikilink") : null;
    const current = (e.target as Element).closest("a.orion-wikilink");
    if (next && next === current) return;
    if (timer.current) clearTimeout(timer.current);
    setHover(null);
  }

  const preview = hover && getWikiLinkPreview ? getWikiLinkPreview(hover.target) : undefined;

  return (
    <>
      <div
        onClick={
          onWikiLink || onExternalLink
            ? (e) => {
                const target = onWikiLink ? wikiLinkFromEvent(e.nativeEvent) : null;
                if (target && onWikiLink) {
                  e.preventDefault();
                  onWikiLink(target);
                  return;
                }
                if (!onExternalLink || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
                const href = anchor?.getAttribute("href") ?? "";
                if (anchor && !anchor.classList.contains("orion-wikilink") && /^https?:\/\//i.test(href)) {
                  e.preventDefault();
                  onExternalLink(href);
                }
              }
            : undefined
        }
        onMouseOver={getWikiLinkPreview ? handleMouseOver : undefined}
        onMouseOut={getWikiLinkPreview ? handleMouseOut : undefined}
        className={clsx(
          "text-sm leading-relaxed text-foreground",
          "[&_a.orion-wikilink]:cursor-pointer [&_a.orion-wikilink]:text-accent-text [&_a.orion-wikilink]:decoration-dotted [&_a.orion-wikilink]:underline-offset-2",
          "[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight first:[&_h1]:mt-0",
          "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold first:[&_h2]:mt-0",
          "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold first:[&_h3]:mt-0",
          "[&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold",
          "[&_p]:my-2.5 [&_ul]:my-2.5 [&_ol]:my-2.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5",
          "[&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1",
          "[&_a]:text-accent-text [&_a]:underline [&_a]:decoration-accent/40 hover:[&_a]:decoration-accent",
          "[&_strong]:font-semibold [&_em]:italic",
          "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
          "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-white/[0.03] [&_pre]:p-3",
          "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
          "[&_hr]:my-5 [&_hr]:border-border",
          "[&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:border-border [&_th]:py-1 [&_th]:pr-3 [&_th]:font-semibold",
          "[&_td]:border-b [&_td]:border-border/60 [&_td]:py-1 [&_td]:pr-3",
          "[&_img]:my-3 [&_img]:rounded-lg",
          className
        )}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
      />
      {mounted && hover && preview
        ? createPortal(
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
                style={{
                  position: "fixed",
                  left: hover.rect.left + hover.rect.width / 2,
                  top: hover.rect.top - 8,
                  transform: "translate(-50%, -100%)"
                }}
                className="pointer-events-none z-[140] w-64 rounded-lg border border-border bg-card/95 p-3 text-left shadow-xl shadow-black/40 backdrop-blur-md"
              >
                <p className="truncate text-xs font-semibold text-foreground">{preview.title}</p>
                {preview.snippet ? (
                  <p className="mt-1 line-clamp-3 whitespace-normal text-2xs text-muted-foreground">{preview.snippet}</p>
                ) : null}
              </motion.div>
            </AnimatePresence>,
            document.body
          )
        : null}
    </>
  );
}
