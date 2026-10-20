import type { AssistantViewContext } from "@orion/shared-types";

/**
 * What the user was looking at before they switched to the assistant: when they type, the assistant's own panel is the
 * active one, so the shell remembers the last OTHER panel and its open record here. Sent with each message, so «эта
 * задача» means the task on screen. Module-level, like the panel bus: one per window, no React state needed.
 */
let lastView: AssistantViewContext | null = null;

export const ASSISTANT_PANEL_ID = "assistant";

export function rememberAssistantView(view: AssistantViewContext | null): void {
  if (view && view.panel === ASSISTANT_PANEL_ID) return;
  lastView = view;
}

export function currentAssistantView(): AssistantViewContext | null {
  return lastView;
}

/** «Задачи · «Купить корм»» — shown under the composer so the user knows what «это» will mean. */
export function describeAssistantView(view: AssistantViewContext | null): string | null {
  if (!view) return null;
  return view.title ? `${view.label} · «${view.title}»` : view.label;
}
