"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The calendar moved into ../../../panels/CalendarPanel.tsx, opened via the
 * sidebar into the persistent Workbench dock (see ../layout.tsx) — this
 * route only exists so an old /calendar bookmark or link still lands
 * somewhere instead of 404ing.
 */
export default function CalendarPageRedirect(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
