import { describe, expect, it } from "vitest";
import { compassInstrumentLink, normalizeCompassUrl } from "./compass-link";

describe("normalizeCompassUrl", () => {
  it("accepts a local http address, with or without the scheme and a trailing path", () => {
    expect(normalizeCompassUrl("http://127.0.0.1:8765/")).toBe("http://127.0.0.1:8765");
    expect(normalizeCompassUrl("localhost:9000/api")).toBe("http://localhost:9000");
    expect(normalizeCompassUrl(" 127.0.0.1:8765 ")).toBe("http://127.0.0.1:8765");
  });
  it("refuses anything that is not this computer — ORION is not a probe for other hosts", () => {
    expect(normalizeCompassUrl("http://192.168.1.5:8765")).toBeNull();
    expect(normalizeCompassUrl("https://example.com")).toBeNull();
    expect(normalizeCompassUrl("http://127.0.0.1.evil.test:8765")).toBeNull();
    expect(normalizeCompassUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeCompassUrl("")).toBeNull();
  });
});

describe("compassInstrumentLink", () => {
  it("encodes the instrument as query parameters", () => {
    expect(compassInstrumentLink("http://127.0.0.1:8765", "moex", "SBER")).toBe("http://127.0.0.1:8765/?market=moex&symbol=SBER");
    expect(compassInstrumentLink("http://127.0.0.1:8765", "crypto", "BTC/USDT")).toBe("http://127.0.0.1:8765/?market=crypto&symbol=BTC%2FUSDT");
  });
});
