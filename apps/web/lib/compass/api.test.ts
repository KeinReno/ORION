import { ApiError as OrionApiError } from "@orion/core";
import { afterEach, describe, expect, it } from "vitest";
import { api, ApiError, setCompassTransport } from "./api";

afterEach(() => setCompassTransport(null));

describe("клиент Compass поверх прокси ORION", () => {
  it("без подключённого транспорта не ходит в сеть, а честно говорит об этом", async () => {
    await expect(api.accounts()).rejects.toMatchObject({ status: 0 });
  });

  it("передаёт метод, путь с запросом и тело JSON", async () => {
    const calls: unknown[][] = [];
    setCompassTransport(async (method, path, body) => {
      calls.push([method, path, body]);
      return [];
    });
    await api.journal({ mode: "paper" });
    await api.addAlert({ market: "moex", symbol: "SBER", price: 300 });
    expect(calls[0]).toEqual(["GET", "/api/journal?mode=paper", undefined]);
    expect(calls[1]).toEqual(["POST", "/api/alerts", { market: "moex", symbol: "SBER", price: 300 }]);
  });

  it("ошибка движка (detail, code) превращается в ApiError Compass", async () => {
    setCompassTransport(async () => {
      throw new OrionApiError(409, "Conflict", { detail: "Нет согласия на облачный AI", code: "consent" });
    });
    const error = await api.aiStatus().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "consent", message: "Нет согласия на облачный AI" });
  });

  it("сбой сети — «Нет связи с движком»", async () => {
    setCompassTransport(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(api.accounts()).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Нет связи") });
  });
});
