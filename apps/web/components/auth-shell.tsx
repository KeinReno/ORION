"use client";

import { AuroraBackground, SpotlightCard } from "@orion/ui";
import { motion } from "framer-motion";
import { LayoutGrid, Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

const FEATURES = [
  { icon: LayoutGrid, text: "Задачи, заметки, календарь, финансы и привычки — в одном доке" },
  { icon: Sparkles, text: "Быстрый ввод: одна строка сама решает, что вы имели в виду" },
  { icon: Lock, text: "Ваши данные изолированы построчно на уровне Postgres RLS" }
];

/**
 * Shared frame for /login and /register — two-column hero on desktop
 * (branding + feature list left, form card right), single column on phone.
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
      <div className="relative grid w-full max-w-4xl gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="hidden flex-col gap-6 lg:flex"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">ORION</span>
          </div>
          <h1 className="text-3xl font-semibold leading-tight text-foreground">
            Личное ядро для задач,
            <br />
            заметок и финансов
          </h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Один модульный монолит вместо десятка разрозненных приложений — работает локально, открывается как
            веб-панель и как настольное окно.
          </p>
          <ul className="space-y-3 pt-2">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-accent">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <SpotlightCard className="w-full max-w-sm lg:ml-auto">
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-base font-semibold tracking-tight text-foreground">ORION</span>
            </div>
            <h2 className="mb-1 text-lg font-semibold text-foreground">{title}</h2>
            <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>
            {children}
            <div className="mt-4 text-sm text-muted-foreground">{footer}</div>
          </SpotlightCard>
        </motion.div>
      </div>
    </div>
  );
}
