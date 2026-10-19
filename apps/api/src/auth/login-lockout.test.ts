import { describe, expect, it } from "vitest";
import { LoginLockout } from "./login-lockout";

describe("LoginLockout", () => {
  it("блокирует аккаунт после серии неудач и сообщает, сколько ждать", () => {
    let now = 1_000_000;
    const lock = new LoginLockout(3, 10 * 60_000, () => now);
    expect(lock.fail("u1")).toBe(false);
    expect(lock.fail("u1")).toBe(false);
    expect(lock.lockedMinutes("u1")).toBe(0);
    expect(lock.fail("u1")).toBe(true);
    expect(lock.lockedMinutes("u1")).toBe(10);
    now += 4 * 60_000;
    expect(lock.lockedMinutes("u1")).toBe(6);
  });

  it("после истечения блокировки счёт начинается заново", () => {
    let now = 0;
    const lock = new LoginLockout(2, 60_000, () => now);
    lock.fail("u1");
    lock.fail("u1");
    expect(lock.lockedMinutes("u1")).toBe(1);
    now += 61_000;
    expect(lock.lockedMinutes("u1")).toBe(0);
    expect(lock.fail("u1")).toBe(false);
    expect(lock.fail("u1")).toBe(true);
  });

  it("успешный вход сбрасывает счётчик, аккаунты не влияют друг на друга", () => {
    const lock = new LoginLockout(2, 60_000, () => 0);
    lock.fail("u1");
    lock.success("u1");
    expect(lock.fail("u1")).toBe(false);
    lock.fail("u2");
    expect(lock.lockedMinutes("u2")).toBe(0);
    expect(lock.fail("u1")).toBe(true);
    expect(lock.lockedMinutes("u2")).toBe(0);
  });
});
