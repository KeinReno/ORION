import { describe, expect, it } from "vitest";
import { buildQrData, encodeQr, rsRemainder } from "./qr";

describe("qr", () => {
  it("makes the Reed-Solomon remainder of a finished codeword zero", () => {
    const data = buildQrData(new TextEncoder().encode("ORION"), 19);
    const ecc = rsRemainder(data, 7);
    const full = new Uint8Array(data.length + ecc.length);
    full.set(data);
    full.set(ecc, data.length);
    expect([...rsRemainder(full, 7)].every((byte) => byte === 0)).toBe(true);
  });

  it("draws a version-1 finder and grows when the text no longer fits", () => {
    const small = encodeQr("ORION");
    expect(small).toHaveLength(21);
    expect(small[0][0]).toBe(true);
    expect(small[0][6]).toBe(true);
    expect(small[6][0]).toBe(true);
    expect(small[3][3]).toBe(true);
    expect(small[1][1]).toBe(false);
    expect(encodeQr("x".repeat(40))).toHaveLength(29);
    expect(encodeQr("ORION")).toEqual(small);
  });

  it("refuses a payload past version 5", () => {
    expect(() => encodeQr("я".repeat(80))).toThrow(/qr_too_long/);
  });
});
