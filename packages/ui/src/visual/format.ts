const ru = new Intl.NumberFormat("ru-RU");

/** Целые и дробные числа так, как их читают в интерфейсе. */
export function formatCount(value: number, digits = 0): string {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Байты → «12 КБ». Ноль остаётся нулём, отрицательные не ожидаются. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  const digits = exp === 0 || value >= 10 || Math.abs(value - Math.round(value)) < 0.05 ? 0 : 1;
  return `${formatCount(value, digits)} ${units[exp]}`;
}

/** Минуты → «2 ч 05 мин» или «12 мин». */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 мин";
  const minutes = Math.round(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${ru.format(rest)} мин`;
  if (rest === 0) return `${ru.format(hours)} ч`;
  return `${ru.format(hours)} ч ${String(rest).padStart(2, "0")} мин`;
}
