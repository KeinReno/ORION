import type { HealthSummary } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildHealthCardHtml, escapeHtml } from "./health-card";

const now = new Date("2026-10-15T12:00:00.000Z");
const summary: HealthSummary = {
  generatedAt: now.toISOString(),
  subject: {
    id: "s", workspaceId: "w", kind: "member", userId: "u", guardianUserId: null, name: "Анна <b>", birthDate: "1990-10-16", bloodType: "A(II) Rh+",
    allergies: [{ substance: "Арахис", reaction: "сыпь" }], conditions: ["гипертония"], emergencyNote: "Муж: +7 900 000-00-00\n<script>alert(1)</script>",
    access: "own", archivedAt: null, createdAt: "", updatedAt: ""
  },
  medications: [{ id: "m", subjectId: "s", name: "Лозартан", form: "таблетки", dose: "50 мг", times: ["08:00"], weekdays: [], startOn: null, endOn: null, asNeeded: false, stock: null, lowStockAt: null, lowStock: false, note: "", adherence: { planned: 0, taken: 0, skipped: 0 }, archivedAt: null, createdAt: "", updatedAt: "" }],
  measurements: [{
    kind: "blood_pressure",
    latest: { id: "a", subjectId: "s", kind: "blood_pressure", value: 150, value2: 95, measuredAt: "2026-10-14T08:00:00.000Z", context: "", note: "", createdAt: "" },
    recent: [
      { id: "a", subjectId: "s", kind: "blood_pressure", value: 150, value2: 95, measuredAt: "2026-10-14T08:00:00.000Z", context: "", note: "", createdAt: "" },
      { id: "b", subjectId: "s", kind: "blood_pressure", value: 130, value2: 85, measuredAt: "2026-10-10T08:00:00.000Z", context: "", note: "", createdAt: "" }
    ],
    target: { subjectId: "s", kind: "blood_pressure", min: 90, max: 140 }
  }],
  upcomingAppointments: [{ id: "p", subjectId: "s", title: "Кардиолог", at: "2026-10-20T09:00:00.000Z", doctorContactId: null, clinic: "", purpose: "", questions: "про давление", outcome: "", doneAt: null, createdAt: "", updatedAt: "" }],
  recentAppointments: [],
  symptoms: [{ id: "y", subjectId: "s", name: "Головная боль", severity: 6, startedAt: "2026-10-12T08:00:00.000Z", endedAt: null, triggers: "недосып", relief: "", note: "", createdAt: "", updatedAt: "" }]
};

describe("escapeHtml", () => {
  it("экранирует разметку и кавычки", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("buildHealthCardHtml", () => {
  it("карточка врача: всё, что вводил человек, экранировано; нет живой разметки из данных", () => {
    const html = buildHealthCardHtml(summary, "doctor", now);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Анна &lt;b&gt;");
    expect(html).toContain("Карточка для врача");
  });
  it("содержит аллергии, лекарства, показатели с отметкой диапазона, симптомы и визиты с вопросами", () => {
    const html = buildHealthCardHtml(summary, "doctor", now);
    for (const text of ["Арахис", "гипертония", "Лозартан", "50 мг", "150/95", "выше моего диапазона", "130/85", "Головная боль", "продолжается", "Кардиолог", "Спросить: про давление", "35 лет"]) {
      expect(html, text).toContain(text);
    }
  });
  it("экстренная карточка короткая: аллергии, состояния, лекарства, заметка — без показателей, симптомов и визитов", () => {
    const html = buildHealthCardHtml(summary, "emergency", now);
    expect(html).toContain("Экстренная карточка");
    for (const text of ["Арахис", "гипертония", "Лозартан", "Муж: +7 900"]) expect(html, text).toContain(text);
    for (const text of ["Показатели", "Самочувствие", "Кардиолог", "150/95"]) expect(html, text).not.toContain(text);
  });
  it("пустые разделы не рисуются, а аллергии «не указаны» говорят об этом явно", () => {
    const empty: HealthSummary = { ...summary, subject: { ...summary.subject, allergies: [], conditions: [] }, measurements: [], symptoms: [], upcomingAppointments: [], recentAppointments: [], medications: [] };
    const html = buildHealthCardHtml(empty, "doctor", now);
    expect(html).toContain("Не указаны.");
    expect(html).not.toContain("<h2>Показатели</h2>");
    expect(html).not.toContain("<h2>Ближайшие визиты</h2>");
  });
});
