import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentImportController } from "./development-import.controller";
import { PrismaService } from "../common/prisma.service";

const originalRoot = process.env.ORION_DEV_CATALOG_ROOT;
afterEach(() => {
  if (originalRoot === undefined) delete process.env.ORION_DEV_CATALOG_ROOT;
  else process.env.ORION_DEV_CATALOG_ROOT = originalRoot;
});

describe("development import preview controller", () => {
  it("fails closed without a configured trusted catalog root", async () => {
    delete process.env.ORION_DEV_CATALOG_ROOT;
    const withUser = vi.fn();
    const controller = new DevelopmentImportController({ withUser } as unknown as PrismaService);
    await expect(controller.preview({ userId: "user", email: "test@example.com" }, "workspace"))
      .rejects.toThrow(/not configured/);
    expect(withUser).not.toHaveBeenCalled();
  });
  it("does not issue consent without configured catalog or reviewed request", async () => {
    const withUser = vi.fn();
    const controller = new DevelopmentImportController({ withUser } as unknown as PrismaService);
    delete process.env.ORION_DEV_CATALOG_ROOT;
    await expect(controller.consent({ userId: "user", email: "test@example.com" },
      "workspace", { previewDigest: "a".repeat(64), choices: {} }))
      .rejects.toThrow(/not configured/);
    process.env.ORION_DEV_CATALOG_ROOT = "/not-a-real-orion-catalog-root";
    await expect(controller.consent({ userId: "user", email: "test@example.com" },
      "workspace", { previewDigest: "a".repeat(64) }))
      .rejects.toThrow(/Invalid consent request/);
    for (const previewDigest of ["short", "A".repeat(64), "g".repeat(64), "a".repeat(65)]) {
      await expect(controller.consent({ userId: "user", email: "test@example.com" },
        "workspace", { previewDigest, choices: {} }))
        .rejects.toThrow(/Invalid consent request/);
    }
    expect(withUser).not.toHaveBeenCalled();
  });
  it("executes preview planning within withUser", async () => {
    process.env.ORION_DEV_CATALOG_ROOT = "/invalid";
    const withUser = vi.fn();
    const controller = new DevelopmentImportController({ withUser } as unknown as PrismaService);
    await expect(controller.preview({ userId: "user", email: "test@example.com" }, "w"))
      .rejects.toThrow(/unavailable/);
    expect(withUser).not.toHaveBeenCalled();
  });
  it("fails closed for an invalid configured catalog root", async () => {
    process.env.ORION_DEV_CATALOG_ROOT = "/not-a-real-orion-catalog-root";
    const withUser = vi.fn();
    const controller = new DevelopmentImportController({ withUser } as unknown as PrismaService);
    await expect(controller.preview({ userId: "user", email: "test@example.com" }, "workspace"))
      .rejects.toThrow(/unavailable/);
    expect(withUser).not.toHaveBeenCalled();
  });
});
