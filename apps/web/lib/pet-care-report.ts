import {
  computePetStats,
  petPlural,
  PET_ACTIVITY_LABELS,
  PET_APPETITE_LABELS,
  PET_DAY_STATUS_META,
  PET_SEVERITY_LABELS,
  PET_STOOL_LABELS,
  PET_TIME_LABELS,
  PET_WATER_LABELS,
  petSymptomLabel,
  type PetCareDayLog,
  type PetCarePet
} from "@orion/shared-types";
import { petAgeLabel, toPetDayRecord } from "./pet-care-days";

/** CSV для ветеринара: `;` как разделитель и BOM в начале — так файл сразу открывается в русском Excel. */
const BOM = String.fromCharCode(0xfeff);

function cell(value: unknown): string {
  const text = String(value ?? "");
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: Array<Array<string | number>>): string {
  return BOM + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

export function symptomsLine(day: Pick<PetCareDayLog, "symptoms">): string {
  return day.symptoms.map((item) => `${petSymptomLabel(item.id)}${item.count > 1 ? ` ×${item.count}` : ""}`).join(", ");
}

export function petDaysToCsv(days: readonly PetCareDayLog[]): string {
  const header = ["Дата", "Состояние", "Аппетит", "Активность", "Стул", "Вода", "Рвота (раз)", "Вес, кг", "Температура", "Симптомы", "Лекарства", "Заметка"];
  const rows = days.map((day) => [
    day.day,
    PET_DAY_STATUS_META[day.status].label,
    PET_APPETITE_LABELS[day.appetite],
    PET_ACTIVITY_LABELS[day.activity],
    PET_STOOL_LABELS[day.stool],
    PET_WATER_LABELS[day.water],
    day.vomitingCount,
    day.weightKg ?? "",
    day.temperature ?? "",
    symptomsLine(day),
    day.meds,
    day.note
  ]);
  return csv([header, ...rows]);
}

export function petSymptomsToCsv(days: readonly PetCareDayLog[]): string {
  const header = ["Дата", "Симптом", "Выраженность", "Раз", "Время суток", "Примечание"];
  const rows = days.flatMap((day) =>
    day.symptoms.map((item) => [day.day, petSymptomLabel(item.id), PET_SEVERITY_LABELS[item.severity], item.count, item.time === "" ? "" : PET_TIME_LABELS[item.time], item.note])
  );
  return csv([header, ...rows]);
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Самодостаточный HTML-отчёт для ветеринара: открывается в любом браузере, печатается как PDF.
 * Это субъективные наблюдения владельца, не диагноз — отчёт сам об этом напоминает.
 */
export function petReportHtml(pet: PetCarePet, days: readonly PetCareDayLog[], from: string, to: string, generatedAt: string): string {
  const stats = computePetStats(days.map(toPetDayRecord), from, to);
  const daysWord = (n: number): string => petPlural(n, "день", "дня", "дней");
  const header = [
    pet.breed ? `Порода: ${pet.breed}` : "",
    pet.birthday ? `Возраст: ${petAgeLabel(pet.birthday, to)}` : "",
    `Период: ${from} — ${to}`,
    `Сформировано: ${generatedAt}`
  ].filter(Boolean);
  const profile = [pet.chronic ? `Хронические: ${pet.chronic}` : "", pet.allergies ? `Аллергии: ${pet.allergies}` : "", pet.vetContact ? `Ветеринар: ${pet.vetContact}` : ""].filter(Boolean);
  const rows = days
    .map((day) => {
      const status = PET_DAY_STATUS_META[day.status];
      const tail = [symptomsLine(day), day.meds, day.note].filter(Boolean).join(" · ");
      return `<tr><td>${day.day}</td><td><span class="dot" style="background:${status.color}"></span>${escapeHtml(status.label)}</td><td>${day.vomitingCount || ""}</td><td>${escapeHtml(PET_STOOL_LABELS[day.stool])}</td><td>${escapeHtml(PET_APPETITE_LABELS[day.appetite])}</td><td>${day.weightKg ?? ""}</td><td>${escapeHtml(tail)}</td></tr>`;
    })
    .join("");
  const symptomItems = stats.symptomFreq.map((item) => `<li>${escapeHtml(item.label)} — ${item.count} ${daysWord(item.count)}</li>`).join("");
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Дневник самочувствия — ${escapeHtml(pet.name)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:900px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px}
.meta{color:#555;font-size:12px}.summary{background:#f3f4f6;border-radius:8px;padding:10px 14px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d1d5db;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f3f4f6}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.note{color:#555;font-style:italic;font-size:12px;margin-top:16px}
</style></head><body>
<h1>Дневник самочувствия — ${escapeHtml(pet.name)}</h1>
<div class="meta">${header.map(escapeHtml).join(" · ")}</div>
${profile.length > 0 ? `<div class="meta">${profile.map(escapeHtml).join(" · ")}</div>` : ""}
<p class="summary">Отмечено дней: <b>${stats.loggedDays}</b> из ${stats.totalDays}. Плохих или критических: <b>${stats.badOrWorse}</b>.
Случаев рвоты: <b>${stats.vomitingEpisodes}</b> (в ${stats.vomitingDays} ${daysWord(stats.vomitingDays)}).
Дней с жидким стулом: <b>${stats.looseStoolDays}</b>. Самая длинная серия плохих дней подряд: <b>${stats.longestBadStreak}</b>.</p>
${symptomItems ? `<h2>Симптомы за период</h2><ul>${symptomItems}</ul>` : ""}
<h2>По дням</h2>
${days.length === 0 ? "<p>За выбранный период записей нет.</p>" : `<table><thead><tr><th>Дата</th><th>Состояние</th><th>Рвота</th><th>Стул</th><th>Аппетит</th><th>Вес, кг</th><th>Симптомы / лекарства / заметка</th></tr></thead><tbody>${rows}</tbody></table>`}
<p class="note">Это субъективные наблюдения владельца, не медицинский диагноз.</p>
</body></html>`;
}

/** Скачивание текстового файла из браузера и из Tauri-окна (без диалога сохранения). */
export function downloadPetFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
