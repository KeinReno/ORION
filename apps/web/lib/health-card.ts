import {
  HEALTH_MEASUREMENT_META,
  formatMeasurement,
  rangeState,
  symptomMinutes,
  type HealthSummary
} from "@orion/shared-types";

/**
 * Печатные карточки «Здоровья»: для врача (подробная) и экстренная (коротко). Это обычный HTML-документ для
 * печати или сохранения в PDF — никуда сам не отправляется. Всё пользовательское экранируется: названия
 * и заметки вводит человек, а документ собирается из строк.
 */
export type HealthCardKind = "doctor" | "emergency";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;
const date = (iso: string): string => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const dateTime = (iso: string): string => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function age(birthDate: string | null, now: Date): string {
  if (!birthDate) return "";
  const born = new Date(`${birthDate}T00:00:00Z`);
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) years -= 1;
  return years >= 0 ? `${years} ${years % 10 === 1 && years % 100 !== 11 ? "год" : [2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years % 100) ? "года" : "лет"}` : "";
}

function section(title: string, body: string): string {
  return body ? `<section><h2>${e(title)}</h2>${body}</section>` : "";
}

const list = (items: string[]): string => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");

function medicationLine(m: HealthSummary["medications"][number]): string {
  const schedule = m.asNeeded ? "по требованию" : `${m.times.join(", ")}${m.weekdays.length ? ` (${m.weekdays.map((d) => WEEKDAYS[d]).join(", ")})` : ""}`;
  const parts = [`<b>${e(m.name)}</b>`, m.dose ? e(m.dose) : "", m.form ? e(m.form) : "", schedule ? e(schedule) : ""].filter(Boolean);
  return parts.join(" · ") + (m.note ? `<br><small>${e(m.note)}</small>` : "");
}

/** Готовый HTML-документ карточки. `now` передаётся явно, чтобы результат был предсказуем в тестах. */
export function buildHealthCardHtml(summary: HealthSummary, kind: HealthCardKind, now: Date = new Date()): string {
  const { subject } = summary;
  const title = kind === "doctor" ? "Карточка для врача" : "Экстренная карточка";
  const ageText = age(subject.birthDate, now);

  const identity = [
    subject.birthDate ? `<p>Дата рождения: ${e(date(`${subject.birthDate}T00:00:00Z`))}${ageText ? ` (${e(ageText)})` : ""}</p>` : "",
    subject.bloodType ? `<p>Группа крови: <b>${e(subject.bloodType)}</b></p>` : ""
  ].join("");

  const allergies = subject.allergies.length
    ? list(subject.allergies.map((a) => `<b>${e(a.substance)}</b>${a.reaction ? ` — ${e(a.reaction)}` : ""}`))
    : "<p class=\"muted\">Не указаны.</p>";
  const conditions = subject.conditions.length ? list(subject.conditions.map(e)) : "<p class=\"muted\">Не указаны.</p>";
  const medications = summary.medications.length ? list(summary.medications.map(medicationLine)) : "<p class=\"muted\">Не указаны.</p>";

  let body = section("Аллергии", allergies) + section("Хронические состояния", conditions) + section("Принимаю сейчас", medications);

  if (kind === "emergency") {
    body += section("Экстренная заметка", subject.emergencyNote ? `<p class="pre">${e(subject.emergencyNote)}</p>` : "<p class=\"muted\">Не указана.</p>");
  } else {
    body += section("Экстренная заметка", subject.emergencyNote ? `<p class="pre">${e(subject.emergencyNote)}</p>` : "");

    const rows = summary.measurements.map((m) => {
      const meta = HEALTH_MEASUREMENT_META[m.kind];
      const state = rangeState(m.latest.value, m.target);
      const flag = state === "above" ? " ↑ выше моего диапазона" : state === "below" ? " ↓ ниже моего диапазона" : "";
      const history = m.recent.slice(1).map((r) => formatMeasurement(r)).join(", ");
      return `<tr><td>${e(meta.label)}</td><td><b>${e(formatMeasurement(m.latest))}</b> ${e(meta.unit)}${e(flag)}</td><td>${e(dateTime(m.latest.measuredAt))}</td><td>${e(history)}</td></tr>`;
    });
    body += section("Показатели", rows.length ? `<table><thead><tr><th>Показатель</th><th>Последнее</th><th>Когда</th><th>Предыдущие</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : "");

    const symptoms = summary.symptoms.map((s) => {
      const days = Math.round(symptomMinutes(s, now) / 1440);
      const span = s.endedAt ? `${e(date(s.startedAt))} — ${e(date(s.endedAt))}` : `с ${e(date(s.startedAt))}, продолжается${days > 0 ? ` (${days} дн.)` : ""}`;
      const extra = [s.triggers ? `возможные причины: ${e(s.triggers)}` : "", s.relief ? `помогало: ${e(s.relief)}` : "", s.note ? e(s.note) : ""].filter(Boolean).join("; ");
      return `<b>${e(s.name)}</b>, сила ${s.severity}/10 · ${span}${extra ? `<br><small>${extra}</small>` : ""}`;
    });
    body += section("Самочувствие за последние 90 дней", list(symptoms));

    body += section("Ближайшие визиты", list(summary.upcomingAppointments.map((a) => `<b>${e(a.title)}</b> · ${e(dateTime(a.at))}${a.questions ? `<br><small>Спросить: ${e(a.questions)}</small>` : ""}`)));
    body += section("Недавние визиты", list(summary.recentAppointments.map((a) => `<b>${e(a.title)}</b> · ${e(date(a.at))}${a.outcome ? `<br><small>${e(a.outcome)}</small>` : ""}`)));
  }

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${e(title)} — ${e(subject.name)}</title><style>
    @page { margin: 16mm; }
    body { font: 13px/1.45 system-ui, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 16px 0 4px; padding-bottom: 2px; border-bottom: 1px solid #999; }
    ul { margin: 4px 0 0; padding-left: 18px; } li { margin: 2px 0; } p { margin: 3px 0; }
    table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 8px 3px 0; border-bottom: 1px solid #ddd; vertical-align: top; } th { font-size: 11px; color: #555; }
    small, .muted { color: #555; } .pre { white-space: pre-wrap; } footer { margin-top: 20px; font-size: 11px; color: #666; }
  </style></head><body>
    <h1>${e(title)}</h1><p><b>${e(subject.name)}</b></p>${identity}${body}
    <footer>Составлено ${e(dateTime(summary.generatedAt))} в ORION по записям самого человека. Это личный журнал, он не заменяет медицинское заключение.</footer>
  </body></html>`;
}

/**
 * Печатает HTML через невидимый iframe: работает в браузере и в десктопной оболочке (где `window.open` открыл бы
 * системный браузер). Диалог печати даёт и «Сохранить как PDF».
 */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("Не удалось подготовить документ к печати");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = (): void => {
    window.setTimeout(() => frame.remove(), 1000);
  };
  frame.contentWindow?.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Если браузер не шлёт afterprint, убираем рамку сами.
    window.setTimeout(cleanup, 60_000);
  }, 50);
}
