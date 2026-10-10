"use client";

import { useCalendarFeed, useRotateCalendarFeed } from "@orion/core-react";
import { useToast } from "@orion/ui";
import type { CalendarToolbarSlotProps } from "../../lib/extensions/contracts";
import { CalendarConnectionsButton } from "./calendar-connections";

/** Plugin `calendar-external`: the «Ссылка» button — incoming ICS subscriptions and the outgoing feed link. */
export function CalendarExternalButton({ workspaceId }: CalendarToolbarSlotProps): React.ReactElement {
  const feed = useCalendarFeed(workspaceId);
  const rotateFeed = useRotateCalendarFeed(workspaceId);
  const { toast } = useToast();
  return (
    <CalendarConnectionsButton
      feedUrl={feed.data?.url}
      onRotateFeed={() =>
        rotateFeed.mutate(undefined, {
          onSuccess: () => toast({ title: "Ссылка обновлена, старая больше не работает", tone: "success" })
        })
      }
    />
  );
}
