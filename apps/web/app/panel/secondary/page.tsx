import { Suspense } from "react";
import { SecondaryDockWindow } from "./secondary-dock-window-page";

export default function SecondaryDockRoute(): React.ReactElement {
  // Same reason as `/panel/[panelId]`: `useSearchParams()` needs a `<Suspense>`
  // boundary under Next 14's app router static export.
  return (
    <Suspense fallback={null}>
      <SecondaryDockWindow />
    </Suspense>
  );
}
