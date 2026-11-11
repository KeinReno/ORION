import { describe, expect, it } from "vitest";
import {
  effectiveKnowledgeVerificationState,
  isKnowledgeVerificationOverdue,
  KNOWLEDGE_DEFAULT_VERIFICATION_DAYS
} from "./knowledge";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

describe("состояние проверки материала", () => {
  it("непроверенный остаётся unverified, даже если старая дата проверки есть", () => {
    expect(effectiveKnowledgeVerificationState("unverified", daysAgo(500), NOW, 90)).toBe("unverified");
    expect(effectiveKnowledgeVerificationState("unverified", null, NOW, 90)).toBe("unverified");
  });

  it("свежая проверка — verified, просроченная — outdated", () => {
    expect(effectiveKnowledgeVerificationState("verified", daysAgo(89), NOW, 90)).toBe("verified");
    expect(effectiveKnowledgeVerificationState("verified", daysAgo(91), NOW, 90)).toBe("outdated");
  });

  it("граница порога считается просроченной", () => {
    expect(effectiveKnowledgeVerificationState("verified", daysAgo(90), NOW, 90)).toBe("outdated");
  });

  it("verified без даты проверки не может считаться проверенным", () => {
    expect(effectiveKnowledgeVerificationState("verified", null, NOW, 90)).toBe("unverified");
  });

  it("старый status outdated отдаётся как есть", () => {
    expect(effectiveKnowledgeVerificationState("outdated", null, NOW, 90)).toBe("outdated");
  });

  it("порог по умолчанию — 90 дней", () => {
    expect(KNOWLEDGE_DEFAULT_VERIFICATION_DAYS).toBe(90);
  });

  it("overdue — всё, что не verified: непроверенное и просроченное", () => {
    expect(isKnowledgeVerificationOverdue("unverified", null, NOW, 90)).toBe(true);
    expect(isKnowledgeVerificationOverdue("verified", daysAgo(10), NOW, 90)).toBe(false);
    expect(isKnowledgeVerificationOverdue("verified", daysAgo(120), NOW, 90)).toBe(true);
  });

  it("настраиваемый порог меняет границу", () => {
    expect(effectiveKnowledgeVerificationState("verified", daysAgo(10), NOW, 7)).toBe("outdated");
    expect(effectiveKnowledgeVerificationState("verified", daysAgo(10), NOW, 30)).toBe("verified");
  });
});
