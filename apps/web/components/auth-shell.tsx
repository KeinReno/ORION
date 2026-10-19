"use client";

import { KaidenLogo } from "./kaiden-logo";

import { AuroraBackground, SpotlightCard } from "@orion/ui";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Compact first-run form. Registration stays focused on the person's name and unlock method.
 * Kept out of packages/ui since the copy here is ORION-specific, not a
 * reusable primitive.
 */
export function AuthShell({
  title,
  subtitle,
  footer,
  children
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <AuroraBackground />
      <div className="relative w-full max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <SpotlightCard className="w-full">
            <div className="mb-6 flex items-center gap-2.5">
              <KaidenLogo className="h-8 w-8" />
              <span className="text-base font-semibold tracking-tight text-foreground">ORION</span>
            </div>
            <h1 className="mb-1 text-lg font-semibold text-foreground">{title}</h1>
            <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>
            {children}
            <div className="mt-4 text-sm text-muted-foreground">{footer}</div>
          </SpotlightCard>
        </motion.div>
      </div>
    </div>
  );
}
