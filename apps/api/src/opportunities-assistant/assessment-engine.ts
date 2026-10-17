import { ASSESSMENT_RULES_VERSION, type AssessmentCriterion, type ConditionCheck, type EvidenceRef, type Opportunity } from "@orion/shared-types";
import type { ProfileEvidence } from "../opportunities-profiles/public";
import { bestQuote, hasNumericConstraint, normalize, overlap, terms } from "./text-match";

/**
 * Оценка соответствия «возможность ↔ профиль» (provider rules-v1): детерминированные правила без внешних сервисов.
 *
 * Гарантии:
 * - Совпадение засчитывается только по ПОДТВЕРЖДЁННЫМ фактам владельца. Непроверенные факты и упоминания в тексте резюме дают
 *   «неизвестно» с указанием основания; оспоренные — «противоречие».
 * - Неизвестное условие не считается выполненным. Пробелы и неизвестное перечисляются отдельно.
 * - Текст вакансии — данные: он не может ни изменить правила, ни снять блокировки. Команды в нём не интерпретируются.
 */

export const PROVIDER_ID = "rules-v1";
export const MAX_REQUIREMENTS = 40;
const STRONG = 0.6;
const WEAK = 0.34;

export interface ExtractedRequirement { id: string; text: string; fragment: string; importance: "must" | "nice" }
export interface Extraction { items: ExtractedRequirement[]; structured: boolean; truncated: boolean }

const MUST_HEADING = /^(?:требования|мы ожидаем|от вас|ожидания|что (?:мы )?ждем|что нужно|необходимые навыки|обязательные требования|нам важно|requirements|must have|you have|qualifications|what we expect)/;
const NICE_HEADING = /^(?:будет плюсом|желательно|приветствуется|nice to have|плюсом|дополнительно|бонусом|bonus)/;
const DUTY_HEADING = /^(?:обязанности|задачи|что делать|чем предстоит заниматься|ваши задачи|responsibilities|you will|what you will do)/;
const OTHER_HEADING = /^(?:условия|мы предлагаем|что мы предлагаем|предлагаем|о компании|о нас|о проекте|we offer|benefits|about)/;
const BULLET = /^\s*(?:[-*•–—·]|\d{1,2}[.)])\s+/;

function headingKind(line: string): "must" | "nice" | "duty" | "other" | null {
  const head = normalize(line.replace(BULLET, "").trim());
  if (head.length > 90) return null;
  if (NICE_HEADING.test(head)) return "nice";
  if (MUST_HEADING.test(head)) return "must";
  if (DUTY_HEADING.test(head)) return "duty";
  if (OTHER_HEADING.test(head)) return "other";
  return null;
}

/** Выделяет требования из свободного текста вакансии по заголовкам и спискам. Если структуры нет — это явно сообщается. */
export function extractRequirements(description: string): Extraction {
  const lines = description.replace(/<[^>]+>/g, " ").split(/\r?\n/);
  const items: ExtractedRequirement[] = []; const seen = new Set<string>();
  let section: "must" | "nice" | "duty" | "other" | null = null;
  let truncated = false; let sawHeading = false;
  const unstructured: ExtractedRequirement[] = [];
  const push = (target: ExtractedRequirement[], importance: "must" | "nice", raw: string, fragment: string) => {
    const text = raw.replace(BULLET, "").replace(/[;,.]+$/, "").trim().slice(0, 300);
    if (text.length < 3) return;
    const key = normalize(text);
    if (seen.has(key)) return;
    if (items.length + unstructured.length >= MAX_REQUIREMENTS) { truncated = true; return; }
    seen.add(key);
    target.push({ id: `r${items.length + unstructured.length + 1}`, text, fragment: fragment.trim().slice(0, 500), importance });
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const headLine = colon > 0 ? trimmed.slice(0, colon) : trimmed;
    const kind = headingKind(headLine);
    if (kind && (colon > 0 || !BULLET.test(trimmed))) {
      section = kind; sawHeading = true;
      const rest = colon > 0 ? trimmed.slice(colon + 1).trim() : "";
      if (rest && (kind === "must" || kind === "nice")) for (const part of rest.split(";")) push(items, kind, part, trimmed);
      continue;
    }
    if (section === "must" || section === "nice") push(items, section, trimmed, trimmed);
    else if (section === null && BULLET.test(trimmed)) push(unstructured, "must", trimmed, trimmed);
  }
  if (!sawHeading && unstructured.length) return { items: unstructured, structured: false, truncated };
  return { items, structured: sawHeading, truncated };
}

const factEvidence = (fact: ProfileEvidence["facts"][number]): EvidenceRef => ({ kind: "fact", id: fact.id, text: fact.statement.slice(0, 300), state: fact.state, source: fact.source.slice(0, 200) });

function judge(requirement: ExtractedRequirement, evidence: ProfileEvidence): AssessmentCriterion {
  const reqTerms = terms(requirement.text);
  const base = { id: requirement.id, text: requirement.text, fragment: requirement.fragment, importance: requirement.importance };
  if (!reqTerms.size) return { ...base, verdict: "unknown", evidence: [], reason: "Требование слишком общее, чтобы проверить его по словам. Оцените вручную." };
  const ranked = evidence.facts.map((fact) => ({ fact, ratio: overlap(reqTerms, terms(fact.statement)) })).filter((x) => x.ratio >= WEAK).sort((a, b) => b.ratio - a.ratio);
  const confirmed = ranked.filter((x) => x.fact.state === "confirmed");
  const unverified = ranked.filter((x) => x.fact.state === "unverified");
  const disputed = ranked.filter((x) => x.fact.state === "disputed");
  const refs: EvidenceRef[] = ranked.slice(0, 3).map((x) => factEvidence(x.fact));
  if (evidence.activeResume) {
    const quote = bestQuote(reqTerms, evidence.activeResume.content);
    if (quote) refs.push({ kind: "resume", id: evidence.activeResume.id, text: quote, state: "unverified", source: `Текст активного резюме «${evidence.activeResume.title}»` });
  }
  const numeric = hasNumericConstraint(requirement.text);
  const numericNote = numeric ? " Числовое требование (годы опыта) автоматически не проверяется — сравните сами." : "";
  if (confirmed.length) {
    const strong = confirmed[0].ratio >= STRONG && !numeric;
    return { ...base, verdict: strong ? "matched" : "partial", evidence: refs,
      reason: (strong ? "Есть подтверждённый владельцем факт, совпадающий по ключевым словам." : confirmed[0].ratio >= STRONG ? "Подтверждённый факт совпадает по словам." : "Подтверждённый факт совпадает лишь частично.") + numericNote };
  }
  if (disputed.length) return { ...base, verdict: "conflict", evidence: refs, reason: "Подходящий факт оспорен владельцем — он не может служить основанием." };
  if (unverified.length || refs.some((r) => r.kind === "resume")) {
    return { ...base, verdict: "unknown", evidence: refs, reason: "Есть только непроверенные сведения (факт без подтверждения или упоминание в тексте резюме). Подтвердите факт в профиле." + numericNote };
  }
  return { ...base, verdict: "gap", evidence: [], reason: "В профиле нет сведений, подтверждающих это требование." };
}

const includesAny = (haystack: string, needles: string[]): string | null => {
  const h = normalize(haystack);
  return needles.find((n) => normalize(n).length > 1 && h.includes(normalize(n))) ?? null;
};

/** Условия и ограничения профиля. Денежные значения не конвертируются; заказ не подменяется месячной зарплатой. */
export function checkConditions(opportunity: Opportunity, evidence: ProfileEvidence): ConditionCheck[] {
  const prefs = evidence.profile.preferences; const c = opportunity.conditions; const checks: ConditionCheck[] = [];
  const company = includesAny(opportunity.organizationName, prefs.excludedCompanies);
  if (prefs.excludedCompanies.length) checks.push(company
    ? { key: "company", verdict: "mismatch", severity: "hard", reason: `Работодатель «${opportunity.organizationName}» в списке исключений профиля.` }
    : { key: "company", verdict: "ok", severity: "none", reason: "Работодатель не в списке исключений." });
  const role = includesAny(opportunity.title, prefs.excludedRoles);
  if (prefs.excludedRoles.length) checks.push(role
    ? { key: "role", verdict: "mismatch", severity: "hard", reason: `Название содержит исключённую роль «${role}».` }
    : { key: "role", verdict: "ok", severity: "none", reason: "Название не содержит исключённых ролей." });
  if (prefs.workFormats.length) {
    if (c.workFormat === "unknown") checks.push({ key: "workFormat", verdict: "unknown", severity: "none", reason: "Формат работы в карточке не указан." });
    else checks.push(prefs.workFormats.includes(c.workFormat)
      ? { key: "workFormat", verdict: "ok", severity: "none", reason: "Формат работы допустим для профиля." }
      : { key: "workFormat", verdict: "mismatch", severity: "hard", reason: "Формат работы не входит в допустимые для профиля." });
  }
  if (prefs.minSalaryNetRub !== null) {
    const top = c.amountMax ?? c.amountMin;
    if (top === null) checks.push({ key: "salary", verdict: "unknown", severity: "none", reason: "Сумма в карточке не указана." });
    else if (c.currency !== "RUB") checks.push({ key: "salary", verdict: "review", severity: "none", reason: `Валюта ${c.currency}: конвертация не выполняется, сравните вручную.` });
    else if (c.paymentBasis !== "monthly") checks.push({ key: "salary", verdict: "review", severity: "none", reason: "Оплата не помесячная или не указана: заказ или почасовая ставка не сравниваются с месячным минимумом." });
    else if (top < prefs.minSalaryNetRub) checks.push({ key: "salary", verdict: "mismatch", severity: "hard", reason: `Верхняя граница ${top} ниже минимума профиля ${prefs.minSalaryNetRub} ₽ на руки.` });
    else if (c.taxBasis === "net") checks.push({ key: "salary", verdict: "ok", severity: "none", reason: "Верхняя граница не ниже минимума. Она не гарантирует фактический доход." });
    else checks.push({ key: "salary", verdict: "review", severity: "none", reason: "Сумма до налогов или без указания: сравнение с суммой «на руки» невозможно." });
  }
  if (prefs.city.trim()) {
    if (c.workFormat === "remote") checks.push({ key: "city", verdict: "ok", severity: "none", reason: "Удалённая работа — город не важен." });
    else if (!c.city.trim()) checks.push({ key: "city", verdict: "unknown", severity: "none", reason: "Город в карточке не указан." });
    else if (normalize(c.city).includes(normalize(prefs.city.trim())) || normalize(prefs.city.trim()).includes(normalize(c.city))) checks.push({ key: "city", verdict: "ok", severity: "none", reason: "Город совпадает." });
    else checks.push({ key: "city", verdict: "mismatch", severity: c.workFormat === "unknown" ? "none" : "hard", reason: `Город вакансии «${c.city}» не совпадает с городом профиля «${prefs.city}».` });
  }
  const titleTerms = terms(opportunity.title);
  if (!evidence.tracks.length) checks.push({ key: "track", verdict: "unknown", severity: "none", reason: "У профиля нет треков — соответствие направлению не проверено." });
  else {
    const hit = evidence.tracks.find((t) => overlap(terms(t.name), titleTerms) >= WEAK || overlap(titleTerms, terms(t.name)) >= WEAK);
    checks.push(hit ? { key: "track", verdict: "ok", severity: "none", reason: `Название совпадает по словам с треком «${hit.name}».` } : { key: "track", verdict: "review", severity: "none", reason: "Название вакансии по словам не совпадает ни с одним треком профиля." });
  }
  return checks;
}

export interface EngineOutput {
  score: number | null; confidence: "low" | "medium" | "high";
  breakdown: Record<"must" | "conditions" | "track" | "nice", { weight: number; earned: number | null; count: number }>;
  criteria: AssessmentCriterion[]; conditions: ConditionCheck[]; unknowns: string[]; autoSendBlockers: string[];
}

const credit = (c: AssessmentCriterion) => (c.verdict === "matched" ? 1 : c.verdict === "partial" ? 0.5 : 0);

export function runRules(opportunity: Opportunity, evidence: ProfileEvidence): EngineOutput {
  const extraction = extractRequirements(opportunity.description);
  const criteria = extraction.items.map((item) => judge(item, evidence));
  const conditions = checkConditions(opportunity, evidence);
  const must = criteria.filter((c) => c.importance === "must"); const nice = criteria.filter((c) => c.importance === "nice");
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const softKeys = ["workFormat", "salary", "city"];
  const condChecks = conditions.filter((c) => softKeys.includes(c.key));
  const trackCheck = conditions.find((c) => c.key === "track");
  const breakdown = {
    must: { weight: 0.5, earned: average(must.map(credit)), count: must.length },
    conditions: { weight: 0.2, earned: average(condChecks.map((c) => (c.verdict === "ok" ? 1 : 0))), count: condChecks.length },
    track: { weight: 0.15, earned: trackCheck ? (trackCheck.verdict === "ok" ? 1 : 0) : null, count: trackCheck ? 1 : 0 },
    nice: { weight: 0.15, earned: average(nice.map(credit)), count: nice.length }
  };
  const used = Object.values(breakdown).filter((b) => b.earned !== null);
  const weightSum = used.reduce((a, b) => a + b.weight, 0);
  const score = weightSum > 0 ? Math.round((100 * used.reduce((a, b) => a + b.weight * (b.earned ?? 0), 0)) / weightSum) : null;

  const unknowns: string[] = [];
  if (!extraction.items.length) unknowns.push("В тексте вакансии не удалось выделить требования (нет раздела «Требования» или списка) — оценка по ним невозможна.");
  else if (!extraction.structured) unknowns.push("В тексте нет разделов «Требования»/«Желательно»: пункты списка приняты за обязательные требования.");
  if (extraction.truncated) unknowns.push(`Учтены только первые ${MAX_REQUIREMENTS} требований.`);
  for (const check of conditions) if (check.verdict === "unknown" || check.verdict === "review") unknowns.push(check.reason);
  if (!evidence.facts.some((f) => f.state === "confirmed")) unknowns.push("У профиля нет ни одного подтверждённого факта — совпадения засчитывать нечем.");
  if (!evidence.activeResume) unknowns.push("Не выбрано активное резюме: упоминания в его тексте не использованы, версия для отклика не определена.");
  if (criteria.some((c) => hasNumericConstraint(c.text))) unknowns.push("Числовые требования (годы опыта) автоматически не проверяются.");

  const autoSendBlockers: string[] = [];
  for (const check of conditions) {
    if (check.severity === "hard") autoSendBlockers.push(`Жёсткое ограничение: ${check.reason}`);
    else if (softKeys.includes(check.key) && check.verdict !== "ok") autoSendBlockers.push(`Условие не подтверждено: ${check.reason}`);
  }
  for (const c of must) if (c.verdict !== "matched" && c.verdict !== "partial") autoSendBlockers.push(`Обязательное требование без подтверждения: «${c.text}»`);
  if (!evidence.activeResume) autoSendBlockers.push("Не выбрано активное резюме.");
  if (evidence.profile.archivedAt) autoSendBlockers.push("Профиль в архиве.");

  const confirmedCount = evidence.facts.filter((f) => f.state === "confirmed").length;
  const knownConditions = !conditions.some((c) => softKeys.includes(c.key) && (c.verdict === "unknown" || c.verdict === "review"));
  const confidence: EngineOutput["confidence"] = !criteria.length || confirmedCount === 0 ? "low" : criteria.length >= 3 && confirmedCount >= 3 && knownConditions ? "high" : "medium";
  return { score, confidence, breakdown, criteria, conditions, unknowns, autoSendBlockers };
}

export const RULES_VERSION = ASSESSMENT_RULES_VERSION;
