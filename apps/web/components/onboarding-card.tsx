"use client";

import { usePreferences, useUpdatePreferences } from "@orion/core-react";
import { isOnboardingPending } from "@orion/shared-types";
import { Button, Kbd } from "@orion/ui";
import { useEffect, useState } from "react";
import { captureShortcutLabel } from "../lib/mod-key";

/**
 * First-run card on Today. Inline, not a modal: the capture field stays
 * usable while this explains the loop. Dismiss writes
 * `UserPreference.onboardingCompletedAt`; Settings can clear it.
 */
export function OnboardingCard({ onCapture }: { onCapture: () => void }): React.ReactElement | null {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const pending = isOnboardingPending(preferences.data);
  const [optimisticDone, setOptimisticDone] = useState(false);

  useEffect(() => {
    if (pending) setOptimisticDone(false);
  }, [pending]);

  if (!pending || optimisticDone) return null;

  function dismiss(): void {
    setOptimisticDone(true);
    update.mutate(
      { onboardingCompletedAt: new Date().toISOString() },
      { onError: () => setOptimisticDone(false) }
    );
  }

  return (
    <section className="orion-onboarding rounded-lg border border-border bg-card/40 px-4 py-3.5">
      <p className="text-sm font-medium text-foreground">Как устроен день</p>
      <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">1. Захват.</span> Мысль — в поле сверху или{" "}
          <Kbd>{captureShortcutLabel()}</Kbd>. По умолчанию она попадает в инбокс.
        </li>
        <li>
          <span className="font-medium text-foreground">2. Разбор.</span> В инбоксе «На сегодня» делает задачу со
          сроком до конца дня. Очередь при этом не закрывается.
        </li>
        <li>
          <span className="font-medium text-foreground">3. Сегодня.</span> Просроченное, фокус и таймер — на этой
          панели.
        </li>
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onCapture}>
          Записать мысль
        </Button>
        <Button size="sm" variant="outline" onClick={dismiss}>
          Понятно
        </Button>
      </div>
    </section>
  );
}
