"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Notes moved into ../../../panels/NotesPanel.tsx, opened via the sidebar
 * into the persistent Workbench dock (see ../layout.tsx) — this route only
 * exists so an old /notes bookmark or link still lands somewhere instead
 * of 404ing.
 */
export default function NotesPageRedirect(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
