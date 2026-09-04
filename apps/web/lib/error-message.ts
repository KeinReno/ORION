import { ApiError } from "@orion/core";

/**
 * Turns a thrown error from a core-react mutation into a message a user can
 * actually act on. Learned from a real incident: a bare "Internal server
 * error" under a form field reads as "nothing happened" when the real cause
 * is the API or database being down.
 */
export function describeAuthError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return "Сервер недоступен: похоже, API или база данных сейчас не запущены.";
    }
    if (error.status === 401) {
      return "Неверный email или пароль.";
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
