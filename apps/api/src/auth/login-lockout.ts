/**
 * Блокировка аккаунта после серии неверных попыток входа. Считается по аккаунту (а не по адресу, как лимит входа), поэтому
 * перебор PIN с нескольких устройств не обходит её. Состояние в памяти процесса: перезапуск API сбрасывает счётчики — для
 * домашнего узла этого достаточно, а сохранять неудачные попытки в базу значило бы дать ещё одну точку записи на каждый вход.
 */
export const LOCKOUT_MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

interface Entry {
  failures: number;
  lockedUntil: number;
}

export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures = LOCKOUT_MAX_FAILURES,
    private readonly lockMs = LOCKOUT_MS,
    private readonly now: () => number = Date.now
  ) {}

  /** Сколько минут ещё ждать; 0 — аккаунт не заблокирован. */
  lockedMinutes(key: string): number {
    const entry = this.entries.get(key);
    if (!entry || entry.lockedUntil <= this.now()) return 0;
    return Math.max(1, Math.ceil((entry.lockedUntil - this.now()) / 60_000));
  }

  /** Записывает неудачу; возвращает true, если эта попытка заблокировала аккаунт. */
  fail(key: string): boolean {
    const current = this.entries.get(key);
    // Прежняя блокировка истекла — счёт начинается заново.
    const base = current && current.lockedUntil > 0 && current.lockedUntil <= this.now() ? { failures: 0, lockedUntil: 0 } : (current ?? { failures: 0, lockedUntil: 0 });
    const failures = base.failures + 1;
    const locked = failures >= this.maxFailures;
    this.entries.set(key, { failures, lockedUntil: locked ? this.now() + this.lockMs : 0 });
    this.sweep();
    return locked;
  }

  success(key: string): void {
    this.entries.delete(key);
  }

  private sweep(): void {
    if (this.entries.size < 1000) return;
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.lockedUntil <= now && entry.lockedUntil !== 0) this.entries.delete(key);
  }
}
