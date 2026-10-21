import { useLayoutEffect, useRef, type ReactNode } from "react";

// One perspective/rotation per card; long forms need a more distant camera to avoid overlap.
export function DepthCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { element.style.perspective = `${Math.max(1000, element.offsetHeight * 8)}px`; };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={"depth-card " + className}><div className="depth-card-body">{children}</div></div>;
}
