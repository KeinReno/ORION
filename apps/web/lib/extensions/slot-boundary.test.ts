import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@orion/ui";
import { renderContributions } from "./slot-boundary";

// The test environment is plain node (no jsdom), and renderToString does not run error
// boundaries, so this walks the same contract React applies on the client: render the
// boundary's children; if they throw, feed the error to getDerivedStateFromError and
// render what the boundary then returns.
function renderLikeReact(node: ReactNode): string {
  if (!isValidElement(node)) return renderToString(node as ReactElement);
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === ErrorBoundary) {
    const boundary = new ErrorBoundary(element.props as never);
    try {
      return renderToString(element.props.children as ReactElement);
    } catch (error) {
      boundary.state = ErrorBoundary.getDerivedStateFromError(error);
      boundary.componentDidCatch(boundary.state.error as Error, { componentStack: "" });
      return renderToString(boundary.render() as ReactElement);
    }
  }
  return renderLikeReact(element.props.children);
}

const Good = () => createElement("b", null, "ok");
const Bad = () => {
  throw new Error("boom");
};

describe("renderContributions", () => {
  it("isolates a throwing contribution from its siblings and logs plugin and slot once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const nodes = renderContributions(
      "tasks.views.bar" as never,
      [
        { pluginId: "a", component: Good },
        { pluginId: "bad", component: Bad },
        { pluginId: "c", component: Good }
      ] as never,
      {} as never
    );
    const html = nodes.map(renderLikeReact);
    expect(html[0]).toContain("ok");
    expect(html[1]).toContain("Расширение «bad» не загрузилось");
    expect(html[1]).toContain("Повторить");
    expect(html[2]).toContain("ok");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('"bad"');
    expect(log.mock.calls[0]?.[0]).toContain("tasks.views.bar");
    log.mockRestore();
  });
});

describe("ErrorBoundary", () => {
  it("normalises non-Error throws", () => {
    expect(ErrorBoundary.getDerivedStateFromError("x").error?.message).toBe("x");
  });
});
