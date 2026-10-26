import { useEffect, useRef } from "react";

/** Draft progress stays quiet; only actionable errors move focus into view. */
export function EditorFeedback({ error, notice }: { error: string; notice: string }) {
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!error) return;
    alert.current?.focus({ preventScroll: true });
    alert.current?.scrollIntoView({ block: "center" });
  }, [error]);
  return <div className="editor-feedback">
    {error && <p ref={alert} tabIndex={-1} className="error" role="alert">{error}</p>}
    <p className="notice" role="status">{notice}</p>
  </div>;
}
