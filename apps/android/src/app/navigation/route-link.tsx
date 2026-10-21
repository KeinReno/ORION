import type { ReactNode } from "react";
import { routeHash, type AppRoute } from "./routes";
export function RouteLink({ route, navigate, children, className }: { route: AppRoute; navigate: (route: AppRoute) => void; children: ReactNode; className?: string }) {
  return <a className={className} href={routeHash(route)} onClick={(event) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(route);
  }}>{children}</a>;
}
