"use client";
import { ASSESSMENT_VERDICT_LABEL, type Assessment, type EvidenceRef } from "@orion/shared-types";

const CONDITION_LABEL = { workFormat: "Формат работы", salary: "Оплата", city: "Город", company: "Работодатель", role: "Роль", track: "Направление (трек)" } as const;
const CONDITION_VERDICT = { ok: "Подходит", mismatch: "Не подходит", unknown: "Неизвестно", review: "Нужна ручная проверка" } as const;
const CONFIDENCE = { low: "низкая", medium: "средняя", high: "высокая" } as const;

function evidenceLabel(e: EvidenceRef): string {
  if (e.kind === "resume") return "Упоминание в тексте резюме — не проверено";
  return e.state === "confirmed" ? "Факт, подтверждён владельцем" : e.state === "disputed" ? "Факт, оспорен" : "Факт, не проверен";
}

/** Оценка с основаниями. Цвет не единственный носитель смысла: у каждого вывода есть текстовая метка. */
export function AssessmentView({ assessment }: { assessment: Assessment }) {
  const a = assessment;
  const pct = (value: number | null) => (value === null ? "нет данных" : `${Math.round(value * 100)}%`);
  return <div className="space-y-3 text-sm" aria-label="Оценка соответствия">
    {a.stale && <p role="status" className="rounded-lg border border-border p-3">
      <strong>Оценка устарела.</strong> {a.staleReasons.join("; ")}. Она остаётся в истории как прежняя; пересчитайте, чтобы получить актуальную.
    </p>}
    <p>
      Рейтинг: <strong>{a.score === null ? "не рассчитан" : `${a.score} из 100`}</strong> · надёжность исходных данных: {CONFIDENCE[a.confidence]}.
      <span className="block text-xs text-muted-foreground">Рейтинг — порядок для просмотра, а не вероятность найма. Расчёт: обязательные требования 50%, условия 20%, направление 15%, желательные 15%. Неизвестное баллов не даёт.</span>
    </p>
    <details>
      <summary>Из чего сложился рейтинг</summary>
      <ul className="space-y-1 py-2 text-xs">
        <li>Обязательные требования ({a.breakdown.must.count}): {pct(a.breakdown.must.earned)}</li>
        <li>Условия ({a.breakdown.conditions.count}): {pct(a.breakdown.conditions.earned)}</li>
        <li>Направление ({a.breakdown.track.count}): {pct(a.breakdown.track.earned)}</li>
        <li>Желательные требования ({a.breakdown.nice.count}): {pct(a.breakdown.nice.earned)}</li>
      </ul>
    </details>
    {a.autoSendBlockers.length > 0 && <div>
      <p className="font-medium">Что мешает автоматической отправке</p>
      <ul className="list-disc space-y-1 pl-5 text-xs">{a.autoSendBlockers.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul>
    </div>}
    <div>
      <p className="font-medium">Требования вакансии ({a.criteria.length})</p>
      {!a.criteria.length && <p className="text-xs text-muted-foreground">Требования в тексте не выделены.</p>}
      <ul className="space-y-2">
        {a.criteria.map((c) => <li key={c.id} className="rounded-lg border border-border p-3">
          <p className="break-words">{c.importance === "must" ? "Обязательно" : "Желательно"}: «{c.text}»</p>
          <p className="font-medium">{ASSESSMENT_VERDICT_LABEL[c.verdict]}</p>
          <p className="text-xs text-muted-foreground">{c.reason}</p>
          {c.evidence.length > 0 && <ul className="mt-1 space-y-1 text-xs">{c.evidence.map((e, i) => <li key={`${e.id}-${i}`} className="break-words"><span className="text-muted-foreground">{evidenceLabel(e)}:</span> «{e.text}» <span className="text-muted-foreground">({e.source})</span></li>)}</ul>}
          <details className="mt-1"><summary className="text-xs">Фрагмент вакансии</summary><p className="break-words text-xs text-muted-foreground">{c.fragment}</p></details>
        </li>)}
      </ul>
    </div>
    {a.conditions.length > 0 && <div>
      <p className="font-medium">Условия профиля</p>
      <ul className="space-y-1 text-xs">{a.conditions.map((c) => <li key={c.key} className="break-words">{CONDITION_LABEL[c.key]}: <strong>{CONDITION_VERDICT[c.verdict]}</strong>{c.severity === "hard" ? " (жёсткое ограничение)" : ""} — {c.reason}</li>)}</ul>
    </div>}
    {a.unknowns.length > 0 && <div>
      <p className="font-medium">Что ассистент не знает</p>
      <ul className="list-disc space-y-1 pl-5 text-xs">{a.unknowns.map((u, i) => <li key={i} className="break-words">{u}</li>)}</ul>
    </div>}
    <p className="text-xs text-muted-foreground">Оценка {a.provider.id} ({a.provider.version}) от {new Date(a.createdAt).toLocaleString("ru-RU")}. Внешним сервисам данные не передавались.</p>
  </div>;
}
