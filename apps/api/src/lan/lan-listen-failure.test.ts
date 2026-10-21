import { describe, expect, it } from "vitest";
import { lanListenFailureMessage } from "./lan.service";

describe("LAN host listener failure", () => {
  it("names a taken port and suggests another one", () => {
    const busy = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    expect(lanListenFailureMessage(busy, 4443)).toContain("Порт 4443 занят другой программой");
    expect(lanListenFailureMessage(busy, 4443)).toContain("4444");
    expect(lanListenFailureMessage(busy, 4444)).toContain("4445");
  });

  it("explains a refused port and passes anything else through", () => {
    expect(lanListenFailureMessage(Object.assign(new Error("x"), { code: "EACCES" }), 443)).toContain("Нет права открыть порт 443");
    expect(lanListenFailureMessage(new Error("boom"), 4443)).toBe("Не удалось открыть порт 4443 для сети: boom");
  });
});
