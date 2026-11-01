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
  it("fails closed for an invalid configured catalog root", async () => {
    process.env.ORION_DEV_CATALOG_ROOT = "/not-a-real-orion-catalog-root";
    const withUser = vi.fn();
    const controller = new DevelopmentImportController({ withUser } as unknown as PrismaService);
    await expect(controller.preview({ userId: "user", email: "test@example.com" }, "workspace"))
      .rejects.toThrow(/unavailable/);
    expect(withUser).not.toHaveBeenCalled();
  });
});
