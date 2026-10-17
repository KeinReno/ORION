import type { AssessmentCriterion, DraftKind, DraftSectionBasis, Opportunity } from "@orion/shared-types";
import type { ProfileEvidence } from "../opportunities-profiles/public";
import { overlap, terms } from "./text-match";

/**
 * Сборка черновика из ПОДТВЕРЖДЁННЫХ фактов (шаблон template-v1). Движок не пишет «от лица кандидата» ничего, чего нет в
 * подтверждённых фактах: если опоры нет, раздел остаётся пустым с пометкой, а пробелы уходят в заметки владельцу
 * (в текст отклика они не попадают). Служебные разделы (приветствие, подпись) не содержат утверждений о кандидате.
 */

export interface StoredSection { id: string; text: string; factIds: string[]; origin: "template" | "generated" | "manual"; generatedText: string; requirementId: string | null; hint: string }
export interface GeneratedDraft { sections: StoredSection[]; notes: string[] }

const MAX_FACT_SECTIONS = 6;
const WEAK = 0.34;

function template(id: string, text: string, hint: string): StoredSection { return { id, text, factIds: [], origin: "template", generatedText: text, requirementId: null, hint }; }

export function generateDraft(input: { kind: DraftKind; question?: string; opportunity: Opportunity; evidence: ProfileEvidence; criteria: AssessmentCriterion[] }): GeneratedDraft {
  const { kind, opportunity, evidence } = input;
  const confirmed = new Map(evidence.facts.filter((f) => f.state === "confirmed").map((f) => [f.id, f]));
  const notes: string[] = [];

  if (kind === "answer") {
    const questionTerms = terms(input.question ?? "");
    const ranked = evidence.facts.map((fact) => ({ fact, ratio: overlap(questionTerms, terms(fact.statement)) })).filter((x) => x.ratio >= WEAK).sort((a, b) => b.ratio - a.ratio);
    const usable = ranked.filter((x) => x.fact.state === "confirmed").slice(0, 2);
    for (const x of ranked.filter((y) => y.fact.state !== "confirmed").slice(0, 3)) notes.push(`Есть ${x.fact.state === "disputed" ? "оспоренный" : "непроверенный"} факт, похожий на тему вопроса: «${x.fact.statement.slice(0, 160)}». Подтвердите его в профиле, чтобы использовать.`);
    const text = usable.map((x) => x.fact.statement).join(" ");
    if (!text) notes.push("Нет подтверждённых фактов по теме вопроса. Ответ нужно написать самому — ассистент ничего не придумывает за кандидата.");
    return { notes, sections: [{ id: "s-answer", text, factIds: usable.map((x) => x.fact.id), origin: "generated", generatedText: text, requirementId: null, hint: `Вопрос: ${input.question ?? ""}`.slice(0, 300) }] };
  }

  const org = opportunity.organizationName.trim();
  const intro = kind === "proposal"
    ? `Готов обсудить заказ «${opportunity.title}»${org ? ` для «${org}»` : ""}.`
    : `Меня заинтересовала вакансия «${opportunity.title}»${org ? ` в «${org}»` : ""}.`;
  const sections: StoredSection[] = [template("s-greeting", "Здравствуйте!", "Служебный текст"), template("s-intro", intro, "Служебный текст из карточки возможности")];

  const used = new Set<string>();
  const ordered = [...input.criteria.filter((c) => c.importance === "must"), ...input.criteria.filter((c) => c.importance === "nice")];
  for (const criterion of ordered) {
    if (sections.filter((s) => s.requirementId).length >= MAX_FACT_SECTIONS) break;
    if (criterion.verdict !== "matched" && criterion.verdict !== "partial") continue;
    const facts = criterion.evidence.filter((e) => e.kind === "fact" && e.state === "confirmed" && confirmed.has(e.id) && !used.has(e.id)).slice(0, 2);
    if (!facts.length) continue;
    for (const f of facts) used.add(f.id);
    const text = `По требованию «${criterion.text}»: ${facts.map((f) => confirmed.get(f.id)?.statement ?? f.text).join(" ")}`;
    sections.push({ id: `s-${criterion.id}`, text, factIds: facts.map((f) => f.id), origin: "generated", generatedText: text, requirementId: criterion.id, hint: `Требование вакансии: ${criterion.fragment}`.slice(0, 300) });
  }
  if (sections.length === 2) {
    sections.push({ id: "s-empty", text: "", factIds: [], origin: "generated", generatedText: "", requirementId: null, hint: "Нет подтверждённых фактов под требования вакансии. Подтвердите факты в профиле или напишите этот раздел сами." });
  }
  sections.push(template("s-closing", "Буду рад обсудить детали.", "Служебный текст"), template("s-signature", evidence.profile.displayName, "Имя из профиля"));

  for (const c of input.criteria.filter((x) => x.importance === "must" && x.verdict !== "matched" && x.verdict !== "partial")) {
    notes.push(`Не подтверждено: «${c.text}» — ${c.verdict === "gap" ? "в профиле нет сведений" : c.verdict === "conflict" ? "факт оспорен" : "только непроверенные сведения"}. В текст не вошло.`);
  }
  if (!evidence.activeResume) notes.push("Не выбрано активное резюме: при отправке будет непонятно, какую версию прикладывать.");
  return { sections, notes: notes.slice(0, 25) };
}

/** Основание раздела вычисляется на чтении по ТЕКУЩИМ состояниям фактов. */
export function sectionBasis(section: StoredSection, facts: Map<string, ProfileEvidence["facts"][number]>): DraftSectionBasis {
  if (section.origin === "template" && section.text === section.generatedText) return "template";
  if (!section.text.trim()) return "empty";
  if (section.origin === "manual" || section.text !== section.generatedText || !section.factIds.length) return "manual";
  return section.factIds.every((id) => facts.get(id)?.state === "confirmed") ? "confirmed" : "unverified";
}

export function draftText(sections: { text: string }[]): string {
  return sections.map((s) => s.text.trim()).filter(Boolean).join("\n\n");
}
