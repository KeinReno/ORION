/**
 * Лексическое сопоставление текстов для оценки «требование ↔ факт». Это НЕ понимание смысла: только общие значимые слова
 * (с грубым усечением окончаний). Ограничения честно показываются пользователю в оценке (provider rules-v1).
 */

const STOP = new Set([
  "и", "в", "во", "на", "с", "со", "по", "к", "ко", "о", "об", "от", "до", "для", "из", "за", "или", "а", "но", "не", "как", "что", "это", "при", "над", "под", "без", "у", "же", "ли", "бы", "быть", "будет", "есть", "мы", "вы", "ваш", "наш", "ваши", "наши", "нас", "вас", "также", "уже", "еще", "ещё", "любой", "любые", "все", "всех", "его", "ее", "её", "их", "то", "так", "более", "менее", "очень", "умение", "умения", "готовность", "способность",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "is", "are", "be", "as", "we", "you", "your", "our", "will", "have", "has", "must", "should", "ability", "strong", "good", "knowledge", "understanding"
]);
/** Слова, которые есть почти в каждом требовании и ничего не различают. */
const GENERIC = new Set(["опыт", "опыта", "опытом", "работа", "работы", "работе", "работать", "навык", "навыки", "навыков", "знание", "знания", "знаний", "владение", "понимание", "уровень", "год", "года", "лет", "наличие", "плюс", "желательно", "обязательно", "experience", "work", "working", "skills", "skill", "years", "year", "plus"]);

export function normalize(text: string): string { return text.toLowerCase().replace(/ё/g, "е"); }

export function stem(word: string): string {
  if (/^[0-9]+$/.test(word)) return word;
  if (/^[a-z0-9#+]+$/.test(word)) return word.length > 4 ? word.replace(/(?:ing|ed|es|s)$/, "") : word;
  // Фиксированный префикс: словоформы («запросов»/«запросы») должны давать одну и ту же основу.
  return word.length <= 5 ? word : word.slice(0, 5);
}

/** Значимые основы слов: без стоп-слов, общих слов и чисел. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalize(text).match(/[a-zа-я0-9]+(?:[#+]+)?/g) ?? []) {
    if (raw.length < 2 || STOP.has(raw) || GENERIC.has(raw) || /^[0-9]+$/.test(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** Доля значимых слов требования, найденных в тексте. 0, если у требования нет значимых слов. */
export function overlap(requirement: Set<string>, text: Set<string>): number {
  if (!requirement.size) return 0;
  let hit = 0;
  for (const term of requirement) if (text.has(term)) hit += 1;
  return hit / requirement.size;
}

/** Числовое требование («от 3 лет») автоматически не проверяется. */
export function hasNumericConstraint(text: string): boolean {
  return /\d+\s*\+?\s*(?:лет|года|год|yrs?|years?)/i.test(text);
}

/** Строка исходного текста, лучше всего покрывающая слова требования, — как цитата-основание. */
export function bestQuote(requirement: Set<string>, text: string): string | null {
  let best: { line: string; ratio: number } | null = null;
  for (const line of text.split(/\r?\n|(?<=[.!?])\s+/)) {
    const trimmed = line.trim();
    if (trimmed.length < 3) continue;
    const ratio = overlap(requirement, terms(trimmed));
    if (ratio > (best?.ratio ?? 0)) best = { line: trimmed, ratio };
  }
  return best && best.ratio >= 0.6 ? best.line.slice(0, 240) : null;
}
