"use client";

import { useToast } from "@orion/ui";
import { useEffect } from "react";
import { openPanel } from "./panel-bus";
import { fetchUpdateStatus } from "./updates-local";

const KEY = "orion.update.announced.v1";
const FIRST_DELAY_MS = 20_000;
const EVERY_MS = 30 * 60 * 1000;

function announced(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function remember(tag: string): void {
  try {
    window.localStorage.setItem(KEY, tag);
  } catch {
    // Хранилище недоступно: уведомление просто повторится при следующем запуске.
  }
}

/**
 * Один раз на версию сообщает, что есть новое обновление программы (проверку делает сам локальный API по расписанию).
 * Ничего не ставит: установка — только по кнопке в Настройки → Обновления. Если службы обновлений нет (веб-версия,
 * разработка), запрос молча не удаётся и ничего не происходит.
 */
export function useUpdateNotifier(): void {
  const { toast } = useToast();
  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const status = await fetchUpdateStatus();
        const latest = status.latest;
        if (cancelled || !latest || (status.state !== "available" && status.state !== "ready") || announced() === latest.tag) return;
        remember(latest.tag);
        toast({
          title: `Доступно обновление ORION ${latest.tag}`,
          description: "Откройте Настройки → Обновления, чтобы скачать и установить.",
          tone: "default",
          duration: 20_000,
          action: { label: "Открыть", onClick: () => openPanel("settings") }
        });
      } catch {
        // Службы обновлений нет или она недоступна — это не ошибка для пользователя.
      }
    }
    const first = setTimeout(() => void tick(), FIRST_DELAY_MS);
    const timer = setInterval(() => void tick(), EVERY_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [toast]);
}
