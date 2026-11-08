import { Suspense } from "react";
import { NavSidebarWindow } from "./nav-sidebar-window";

export default function NavSidebarRoute(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <NavSidebarWindow />
    </Suspense>
  );
}
