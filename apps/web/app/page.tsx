"use client";

import { useSession } from "@orion/core-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function IndexPage(): React.ReactElement {
  const router = useRouter();
  const { status, retry: retrySession } = useSession();

  useEffect(() => {
    // "unavailable" (API unreachable) stays on this page instead of guessing
    // — redirecting to /login would misreport a network blip as "logged
    // out", and redirecting to /spaces would need a user we don't have.
    if (status === "authenticated") router.replace("/spaces");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "unavailable") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <p>Не удаётся связаться с сервером.</p>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-white/5"
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
      Загрузка…
    </div>
  );
}
