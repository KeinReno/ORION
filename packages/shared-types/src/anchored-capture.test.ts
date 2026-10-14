import { describe, expect, it } from "vitest";
import {
  captureSchema,
  createCaptureInputSchema,
  effectiveCaptureSeverity,
  listCapturesQuerySchema,
  updateCaptureInputSchema
} from "./anchored-capture";

describe("createCaptureInputSchema", () => {
  it("accepts a capture without an anchor and defaults the body", () => {
    const parsed = createCaptureInputSchema.parse({ kind: "note", title: "  купить лампочки " });
    expect(parsed.title).toBe("купить лампочки");
    expect(parsed.body).toBe("");
    expect(parsed.anchorType ?? null).toBeNull();
  });

  it("accepts a full anchor pair", () => {
    expect(createCaptureInputSchema.safeParse({ kind: "idea", title: "x", anchorType: "home", anchorId: "h1" }).success).toBe(true);
  });

  it("rejects half an anchor", () => {
    expect(createCaptureInputSchema.safeParse({ kind: "idea", title: "x", anchorType: "home" }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ kind: "idea", title: "x", anchorId: "h1" }).success).toBe(false);
  });

  it("rejects unknown anchor types, kinds and empty titles", () => {
    expect(createCaptureInputSchema.safeParse({ kind: "idea", title: "x", anchorType: "planet", anchorId: "1" }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ kind: "wish", title: "x" }).success).toBe(false);
    expect(createCaptureInputSchema.safeParse({ kind: "idea", title: "   " }).success).toBe(false);
  });
});

describe("updateCaptureInputSchema", () => {
  it("does not allow setting promoted by hand", () => {
    expect(updateCaptureInputSchema.safeParse({ status: "promoted" }).success).toBe(false);
    expect(updateCaptureInputSchema.safeParse({ status: "dismissed" }).success).toBe(true);
  });
});

describe("listCapturesQuerySchema", () => {
  it("allows no anchor filter, the none filter, and a full pair", () => {
    expect(listCapturesQuerySchema.safeParse({}).success).toBe(true);
    expect(listCapturesQuerySchema.safeParse({ anchorType: "none" }).success).toBe(true);
    expect(listCapturesQuerySchema.safeParse({ anchorType: "goal", anchorId: "g" }).success).toBe(true);
  });

  it("requires anchorId exactly when a real type is given", () => {
    expect(listCapturesQuerySchema.safeParse({ anchorType: "goal" }).success).toBe(false);
    expect(listCapturesQuerySchema.safeParse({ anchorType: "none", anchorId: "g" }).success).toBe(false);
    expect(listCapturesQuerySchema.safeParse({ anchorId: "g" }).success).toBe(false);
  });
});

describe("captureSchema / severity", () => {
  it("response schema has no defaults: a missing field is an error", () => {
    expect(captureSchema.safeParse({ id: "1" }).success).toBe(false);
  });

  it("only problems carry a severity", () => {
    expect(effectiveCaptureSeverity("problem", undefined)).toBe("annoyance");
    expect(effectiveCaptureSeverity("problem", "bug")).toBe("bug");
    expect(effectiveCaptureSeverity("idea", "bug")).toBeNull();
    expect(effectiveCaptureSeverity("note", undefined)).toBeNull();
  });
});
