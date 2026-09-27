"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Task management moved into ../../../panels/TasksPanel.tsx, opened via the
 * sidebar into the persistent Workbench dock (see ../layout.tsx) — this
 * route only exists so an old /tasks bookmark or link still lands
 * somewhere instead of 404ing.
 */
export default function TasksPageRedirect(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
