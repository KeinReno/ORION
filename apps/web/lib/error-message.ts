import { ApiError } from "@orion/core";

/**
 * Turns a thrown error from a core-react mutation into a message a user can
 * actually act on. Learned from a real incident: a bare "Internal server
 * error" under a form field reads as "nothing happened" when the real cause
 * is the API or database being down.
 */
export function describeAuthError(error: unknown, kind?: "pin" | "password"): string {
  if (error instanceof ApiError) {
    // Only a bare 500 (Nest's uncaught-exception handler) lacks a useful
    // message. 502/503/504 are often a deliberate, specific exception (e.g.
    // FeedbackService's "не настроена на сервере" when the GitHub token is
    // missing) — showing the generic "server is down" line there buries the
    // real, actionable cause under a false diagnosis.
    if (error.status === 500) {
      return "Сервер недоступен: похоже, API или база данных сейчас не запущены.";
    }
    if (error.status === 401) {
      if (kind === "pin") return "Неверный PIN.";
      if (kind === "password") return "Неверный пароль.";
      return "Неверное имя, пароль или PIN.";
    }
    if (error.status === 409) {
      return error.message || "Пользователь с таким email уже существует.";
    }
    return error.message || "Не удалось выполнить запрос.";
  }
  if (error instanceof TypeError) {
    return "Не удалось связаться с сервером. Проверьте, что API запущен на http://localhost:4000.";
  }
  return error instanceof Error ? error.message : "Неизвестная ошибка.";
}

/**
 * Human-readable error for panel EmptyState / toast — never dump a raw
 * exception. Auth-specific 401 copy lives in `describeAuthError`.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    // See the comment in `describeAuthError` — only a bare 500 lacks a
    // real cause; 502/503/504 often carry one worth showing instead.
    if (error.status === 500) {
      return "Сервер недоступен: похоже, API или база данных сейчас не запущены.";
    }
    if (error.status === 409) return error.message || "Конфликт: запись уже изменена.";
    if (error.status === 403) return "Нет доступа к этому пространству.";
    if (error.status === 404) return "Запись не найдена — возможно, её уже удалили.";
    return error.message || "Не удалось выполнить запрос.";
  }
  if (error instanceof TypeError) {
    return "Не удалось связаться с сервером. Проверьте, что API запущен на http://localhost:4000.";
  }
  return error instanceof Error ? error.message : "Неизвестная ошибка.";
}
