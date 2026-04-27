/**
 * Micro-model for two-level NER inference.
 *
 * Extracts entities from Russian text WITHOUT using LLM — only regex + heuristics.
 * Performance target: < 1ms per request, zero network calls.
 *
 * Entity types: person, date, money, email, phone, location
 *
 * Two-pass approach for person & location:
 *   Pass 1 — Dictionary lookup (stems with case-insensitive prefix matching)
 *   Pass 2 — Pattern fallback (capitalized words in context)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

type EntityType = "person" | "date" | "money" | "email" | "phone" | "location";

interface Entity {
  type: EntityType;
  value: string;
}

type MicroStatus = "OK" | "UNSURE" | "EMPTY";

interface MicroModelResult {
  status: MicroStatus;
  entities: Entity[];
  confidence: number; // 0.0 – 1.0
  text: string;
  details: {
    patterns_matched: number;
    total_patterns: number;
    entity_type_confidences: Record<string, number>;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_WEIGHTS: Record<EntityType, number> = {
  email: 0.95,
  phone: 0.9,
  money: 0.85,
  date: 0.8,
  person: 0.5,
  location: 0.4,
};

const TOTAL_ENTITY_TYPES = 6;

// Characters valid right after a name stem (last char of base name OR declension vowel)
const DECLENSION_CHARS = "еиюяоыа";

// Common Russian surname suffixes — words ending in these are NOT matched as first names
const SURNAME_SUFFIXES = [
  "ов", "ова", "ев", "ева", "ин", "ина", "ский", "ская", "цкий", "цкая",
  "ко", "енко", "ичко",
];

// ─── Dictionaries ───────────────────────────────────────────────────────────

const FIRST_NAMES: readonly string[] = [
  // Male
  "Иван", "Пётр", "Дмитрий", "Александр", "Сергей", "Андрей", "Николай",
  "Михаил", "Алексей", "Владимир", "Павел", "Артём", "Максим", "Денис",
  "Игорь", "Юрий", "Константин", "Виктор", "Валентин", "Вадим", "Роман",
  "Евгений", "Антон", "Василий", "Григорий", "Степан", "Борис", "Фёдор",
  "Георгий", "Леонид", "Кирилл", "Никита", "Даниил", "Тимофей", "Матвей",
  "Илья", "Глеб", "Ярослав", "Владислав", "Олег", "Руслан", "Марат",
  "Тимур", "Эдуард", "Станислав", "Вячеслав",
  // Female
  "Анна", "Мария", "Елена", "Ольга", "Наталья", "Ирина", "Татьяна",
  "Светлана", "Екатерина", "Анастасия", "Дарья", "Юлия", "Александра",
  "Ксения", "Полина", "Валентина", "Людмила", "Галина", "Вера", "Надежда",
  "Любовь", "Елизавета", "София", "Марина", "Алина", "Кристина", "Виктория",
  "Вероника", "Алиса", "Маргарита", "Диана", "Евгения",
  // Short / colloquial forms
  "Миша", "Петя", "Вася", "Саша", "Маша", "Катя", "Оля", "Лена",
  "Наташа", "Ира", "Таня", "Света", "Аня", "Даша", "Коля", "Дима",
  "Серёжа", "Андрюша", "Паша", "Вова",
  // Patronymics used as standalone names
  "Иваныч", "Петрович", "Михалыч",
];

const LOCATIONS: readonly string[] = [
  // Russia — major cities
  "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань",
  "Нижний", "Челябинск", "Самара", "Омск", "Ростов-на-Дону",
  "Уфа", "Красноярск", "Воронеж", "Пермь", "Волгоград", "Краснодар",
  "Саратов", "Тюмень", "Тольятти", "Ижевск", "Барнаул", "Иркутск",
  "Ульяновск", "Хабаровск", "Ярославль", "Владивосток", "Махачкала",
  "Томск", "Оренбург", "Кемерово", "Новокузнецк", "Рязань", "Астрахань",
  "Набережные", "Пенза", "Киров", "Липецк", "Чебоксары", "Тула",
  "Калининград", "Балашиха", "Курск", "Ставрополь", "Сочи", "Улан-Удэ",
  "Тверь", "Магнитогорск", "Иваново", "Брянск", "Белгород", "Сургут",
  "Владимир", "Чита", "Архангельск", "Симферополь", "Севастополь",
  // Russia — aliases / historical
  "Питер", "Ленинград",
  // Russia — landmarks
  "Кремль", "Балчуг",
  // World — capitals & major cities
  "Лондон", "Париж", "Берлин", "Токио", "Пекин", "Рим", "Мадрид",
  "Вашингтон", "Оттава", "Канберра", "Вена", "Прага", "Варшава",
  "Будапешт", "Амстердам", "Брюссель", "Стокгольм", "Осло", "Хельсинки",
  "Копенгаген", "Дели", "Бангкок", "Сеул", "Сингапур", "Дубай",
  "Стамбул", "Каир", "Сидней",
  // World — other major cities
  "Нью-Йорк", "Лос-Анджелес", "Чикаго", "Хьюстон", "Финикс",
  "Сан-Франциско", "Майами", "Бостон", "Mountain", "View",
  // Organizations treated as locations
  "Google", "Яндекс",
];

// Multi-word location phrases (searched as literal substrings)
const MULTI_WORD_LOCATIONS: readonly string[] = [
  "Mountain View",
  "Нижний Новгород",
  "Ростов-на-Дону",
  "Набережные Челны",
  "Нью-Йорк",
  "Лос-Анджелес",
  "Сан-Франциско",
];

// Pre-compute stems for fast matching.
// Each entry: [stem, baseName] so we can validate the match.
const NAME_STEMS: readonly [string, string][] = FIRST_NAMES.map((n) => [
  stemOf(n),
  n,
]);
const LOCATION_STEMS: readonly string[] = LOCATIONS.map(stemOf);

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MatchRange {
  start: number;
  end: number;
}

interface Token {
  value: string;
  start: number;
  end: number;
}

/** Normalise ё → е for case/diacritic-insensitive matching. */
function normalizeYo(s: string): string {
  return s.replace(/ё/gi, "е");
}

/** Build a matching stem from a base-form name (first N−1 chars, min 3). */
function stemOf(name: string): string {
  return normalizeYo(name.substring(0, Math.max(3, name.length - 1)).toLowerCase());
}

/** Check whether *word* could be a declined form of *baseName* (via stem). */
function isValidPersonMatch(word: string, baseName: string, stem: string): boolean {
  const wordLower = normalizeYo(word.toLowerCase());
  if (!wordLower.startsWith(stem)) return false;

  // Length guard: declined form is at most baseName.length + 1
  if (word.length > baseName.length + 1) return false;

  // Surname guard: words ending in common surname suffixes are not first names
  const wl = wordLower;
  for (const suf of SURNAME_SUFFIXES) {
    if (wl.endsWith(suf) && wl.length > suf.length + 1) return false;
  }

  // Next-char guard: the character right after the stem should be the last
  // character of the base name OR a common declension vowel.
  const lastCharOfName = normalizeYo(baseName.slice(-1).toLowerCase());
  const nextChar = wordLower[stem.length]; // may be undefined (exact match)
  if (nextChar === undefined) return true; // shouldn't happen with N-1 stem
  if (nextChar === lastCharOfName) return true;
  return DECLENSION_CHARS.includes(nextChar);
}

/** Return true if [start, end) overlaps any existing range. */
function overlaps(start: number, end: number, ranges: readonly MatchRange[]): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}

/** Add entity if it doesn't overlap existing ranges. */
function addEntity(
  entities: Entity[],
  ranges: MatchRange[],
  type: EntityType,
  value: string,
  start: number,
  end: number,
): void {
  if (!overlaps(start, end, ranges)) {
    entities.push({ type, value });
    ranges.push({ start, end });
  }
}

/** Count digit characters in a string. */
function countDigits(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++; // '0'–'9'
  }
  return n;
}

/** Run a regex globally and collect all matches with their positions. */
function extractAll(
  pattern: RegExp,
  text: string,
): Array<{ value: string; index: number }> {
  const results: Array<{ value: string; index: number }> = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push({ value: m[0], index: m.index });
  }
  return results;
}

/**
 * Tokenise text into capitalised words (Cyrillic or Latin) with positions.
 * Matches: Иван, Москва, Санкт-Петербург, Mountain, View, Google …
 * Skips: ООО, INV, all-lowercase words.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁ]?[а-яёa-z]+)*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// ─── 1. Email Extraction ───────────────────────────────────────────────────

function extractEmails(text: string, entities: Entity[], ranges: MatchRange[]): void {
  const re = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
  for (const m of extractAll(re, text)) {
    addEntity(entities, ranges, "email", m.value, m.index, m.index + m.value.length);
  }
}

// ─── 2. Date Extraction ────────────────────────────────────────────────────

function extractDates(text: string, entities: Entity[], ranges: MatchRange[]): void {
  const monthNames =
    "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";
  const monthNamesNom =
    "январ[ье]|феврал[ье]|март[ае]?|апрел[ья]|ма[йея]|июн[ье]|июл[ье]|август[ае]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]";

  // 1 — "15 марта 2025"
  for (const m of extractAll(new RegExp(`\\d{1,2}\\s+(?:${monthNames})\\s+\\d{4}`, "gui"), text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 2 — YYYY-MM-DD
  for (const m of extractAll(/\d{4}-\d{2}-\d{2}/gu, text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 3 — DD.MM.YY(YY)
  for (const m of extractAll(/\d{2}\.\d{2}\.\d{2,4}/gu, text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 4 — DD/MM/YYYY or DD/MM/YY
  for (const m of extractAll(/\d{1,2}\/\d{1,2}\/\d{2,4}/gu, text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 5 — relative days (case-insensitive)
  for (const m of extractAll(/(?:завтра|вчера|сегодня)(?![\p{L}])/gui, text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 6 — "через N период"
  for (const m of extractAll(
    /через\s+\d+\s+(?:день|дня|дней|недел[юи]|месяц[аев]?|год[аев]?)/gui,
    text,
  )) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 7 — "конец месяца"
  for (const m of extractAll(/конец\s+месяца/gui, text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 8 — "YYYY по YYYY"
  for (const m of extractAll(/\d{4}\s+по\s+\d{4}/gu, text)) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 9 — written-out year "Тысяча … … года"
  for (const m of extractAll(
    /[Тт]ысяча\s+[\wёЁа-яА-Я]+\s+[\wёЁа-яА-Я]+\s+[\wёЁа-яА-Я]+\s+года/gu,
    text,
  )) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
  // 10 — "Month YYYY год(а)?"
  for (const m of extractAll(
    new RegExp(`(?:${monthNamesNom})\\s+\\d{4}\\s*года?`, "gui"),
    text,
  )) {
    addEntity(entities, ranges, "date", m.value, m.index, m.index + m.value.length);
  }
}

// ─── 3. Phone Extraction ───────────────────────────────────────────────────

function extractPhones(text: string, entities: Entity[], ranges: MatchRange[]): void {
  // 1 — international "+X …"
  for (const m of extractAll(/\+\d[\d\s\-\(\)]{7,20}\d/gu, text)) {
    if (countDigits(m.value) >= 10 && countDigits(m.value) <= 15) {
      addEntity(entities, ranges, "phone", m.value, m.index, m.index + m.value.length);
    }
  }
  // 2 — Russian 8X… / 8 (XXX)…
  for (const m of extractAll(/8[\s\-\(]*\(?\d[\d\s\-\)]{7,20}\d/gu, text)) {
    if (countDigits(m.value) >= 10 && countDigits(m.value) <= 15) {
      addEntity(entities, ranges, "phone", m.value, m.index, m.index + m.value.length);
    }
  }
  // 3 — bare 10–11 consecutive digits
  for (const m of extractAll(/(?<!\d)\d{10,11}(?!\d)/gu, text)) {
    addEntity(entities, ranges, "phone", m.value, m.index, m.index + m.value.length);
  }
}

// ─── 4. Money Extraction ───────────────────────────────────────────────────

function extractMoney(text: string, entities: Entity[], ranges: MatchRange[]): void {
  // A — number + currency word/symbol  (15 000 рублей, 500$, 3000₽, 50 баксов)
  for (const m of extractAll(
    /\d[\d\s]*\s*(?:руб(?:лей)?\.?|₽|\$|€|USD|EUR|доллар(?:ов)?|бакс(?:ов)?|цент(?:ов)?)/gu,
    text,
  )) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
  // B — currency symbol before number  ($100, ₽5000, $1.5M)
  for (const m of extractAll(/[₽$€]\s*\d[\d.,]*[KkMmBb]?\b/gu, text)) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
  // C — number + к / р  (100к, 500р)
  // NOTE: (?![\\p{L}]) is a Unicode-aware word boundary since \\b doesn't work with Cyrillic
  for (const m of extractAll(/\d+[кКрР](?![\p{L}])/gu, text)) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
  // D — number + million/thousand/billion word  (150 миллионам рублей, 5 млрд)
  // NOTE: \\p{L}* instead of \\w* for Cyrillic, (?![\\p{L}]) instead of \\b
  for (const m of extractAll(
    /\d+(?:[.,]\d+)?[\d\s]*\s*(?:миллион\p{L}*|млрд\p{L}*|тысяч\p{L}*)(?:\s+руб(?:лей)?)?(?![\p{L}])/gui,
    text,
  )) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
  // E — "полмиллиона", "полтысячи"
  for (const m of extractAll(/пол(?:миллион\p{L}*|тысяч\p{L}*)(?![\p{L}])/gui, text)) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
  // F — word-based numbers + money unit  (сто пятьдесят тысяч, пять миллиардов)
  const numberWords =
    "сто|двести|триста|четыреста|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|" +
    "один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|" +
    "одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|" +
    "семнадцать|восемнадцать|девятнадцать|" +
    "двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто";
  const moneyUnits = "тысяч\\p{L}*|миллион\\p{L}*|миллиард\\p{L}*|млрд\\p{L}*";

  // NOTE: \\b doesn't work with Cyrillic in JS Unicode mode, so we use (?![\\p{L}])
  for (const m of extractAll(
    new RegExp(
      `(?:(?:${numberWords})\\s+)+(?:${moneyUnits})(?:\\s+руб(?:лей)?)?(?![\\p{L}])`,
      "gui",
    ),
    text,
  )) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
  // G — standalone money-unit words (миллион, млрд, миллиарда … but NOT тысяч/тысяча alone)
  for (const m of extractAll(
    /(?:миллион(?:а|ов|у|ом|е)?|миллиард(?:а|ов|у|ом|е)?|млрд(?:а|ов|у)?)(?![\p{L}])/gui,
    text,
  )) {
    addEntity(entities, ranges, "money", m.value, m.index, m.index + m.value.length);
  }
}

// ─── 5. Person Extraction (two-pass) ───────────────────────────────────────

/**
 * Pass 1 — Dictionary lookup.
 * For every capitalised word matching a known name stem, try to combine with
 * the next capitalised word (unless it's a known location).
 *
 * Uses strict stem matching: the word must look like a declined form of the
 * base name (length ≤ name.length + 1, next char after stem is the name's
 * last char or a declension vowel).
 */
function extractPersonsDict(text: string, entities: Entity[], ranges: MatchRange[]): void {
  const tokens = tokenize(text);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (overlaps(tok.start, tok.end, ranges)) continue;

    // Check if this token matches any name stem (strict)
    let matchedStem: [string, string] | null = null;
    for (const entry of NAME_STEMS) {
      if (isValidPersonMatch(tok.value, entry[1], entry[0])) {
        matchedStem = entry;
        break;
      }
    }
    if (matchedStem === null) continue;

    // Look ahead: next capitalised token within 1–2 chars gap?
    let combined = false;
    if (i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const gap = next.start - tok.end;
      if (gap >= 1 && gap <= 2 && !overlaps(next.start, next.end, ranges)) {
        // Don't combine if the next token is a known location
        let nextIsLocation = false;
        for (const ls of LOCATION_STEMS) {
          if (normalizeYo(next.value.toLowerCase()).startsWith(ls)) {
            nextIsLocation = true;
            break;
          }
        }
        if (!nextIsLocation) {
          const value = text.substring(tok.start, next.end);
          addEntity(entities, ranges, "person", value, tok.start, next.end);
          combined = true;
        }
      }
    }

    if (!combined) {
      addEntity(entities, ranges, "person", tok.value, tok.start, tok.end);
    }
  }
}

/**
 * Pass 2 — Pattern fallback.
 * Two consecutive capitalised words (Cyrillic or Latin) not yet matched.
 */
function extractPersonsPattern(text: string, entities: Entity[], ranges: MatchRange[]): void {
  // Cyrillic: "Ивван Петтров"
  const cyrillicRe =
    /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ]?[а-яё]+)*\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ]?[а-яё]+)*/gu;
  for (const m of extractAll(cyrillicRe, text)) {
    addEntity(entities, ranges, "person", m.value, m.index, m.index + m.value.length);
  }
  // Latin: "John Smith"
  const latinRe = /[A-Z][a-z]+\s+[A-Z][a-z]+/gu;
  for (const m of extractAll(latinRe, text)) {
    addEntity(entities, ranges, "person", m.value, m.index, m.index + m.value.length);
  }
}

// ─── 6. Location Extraction (two-pass) ─────────────────────────────────────

/** Pass 1 — Dictionary lookup (multi-word phrases first, then single-word stems). */
function extractLocationsDict(text: string, entities: Entity[], ranges: MatchRange[]): void {
  // Multi-word phrases (exact substring search)
  for (const phrase of MULTI_WORD_LOCATIONS) {
    let idx = text.indexOf(phrase);
    while (idx !== -1) {
      addEntity(entities, ranges, "location", phrase, idx, idx + phrase.length);
      idx = text.indexOf(phrase, idx + 1);
    }
  }
  // Single-word stems
  const tokens = tokenize(text);
  for (const tok of tokens) {
    if (overlaps(tok.start, tok.end, ranges)) continue;
    const tokLower = normalizeYo(tok.value.toLowerCase());
    for (const stem of LOCATION_STEMS) {
      if (tokLower.startsWith(stem)) {
        addEntity(entities, ranges, "location", tok.value, tok.start, tok.end);
        break;
      }
    }
  }
}

/**
 * Pass 2 — Pattern fallback.
 * Capitalised word after a spatial preposition (в, из, на, у, к, за, от, …).
 */
function extractLocationsPattern(text: string, entities: Entity[], ranges: MatchRange[]): void {
  const re =
    /(?:^|[^\p{L}])(?:в|из|на|у|к|за|от|под|над|с|до|через|около)\s+([А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁ]?[а-яёa-z]+)*)/gui;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[1];
    const wordOffset = m[0].indexOf(word);
    const wordStart = m.index + wordOffset;
    const wordEnd = wordStart + word.length;
    if (!overlaps(wordStart, wordEnd, ranges)) {
      addEntity(entities, ranges, "location", word, wordStart, wordEnd);
    }
  }
}

// ─── Main Function ──────────────────────────────────────────────────────────

async function extractMicro(text: string): Promise<MicroModelResult> {
  const entities: Entity[] = [];
  const ranges: MatchRange[] = [];

  // Extraction order: high-confidence regex first, then heuristic types.
  // Location dictionary runs BEFORE person dictionary so that location words
  // (e.g. "Ленинграде") are claimed by location and not misidentified as
  // person names.
  extractEmails(text, entities, ranges);
  extractDates(text, entities, ranges);
  extractPhones(text, entities, ranges);
  extractMoney(text, entities, ranges);
  extractLocationsDict(text, entities, ranges);   // ← location dict first
  extractPersonsDict(text, entities, ranges);     // ← person dict second
  extractPersonsPattern(text, entities, ranges);  // person pattern (skips loc ranges)
  extractLocationsPattern(text, entities, ranges);

  // ── Compute confidence ─────────────────────────────────────────────────

  if (entities.length === 0) {
    return {
      status: "EMPTY",
      entities: [],
      confidence: 0.0,
      text,
      details: {
        patterns_matched: 0,
        total_patterns: TOTAL_ENTITY_TYPES,
        entity_type_confidences: {},
      },
    };
  }

  const totalWeight = entities.reduce((sum, e) => sum + CONFIDENCE_WEIGHTS[e.type], 0);
  const confidence = totalWeight / entities.length;

  const entity_type_confidences: Record<string, number> = {};
  for (const e of entities) {
    entity_type_confidences[e.type] = CONFIDENCE_WEIGHTS[e.type];
  }
  const patterns_matched = Object.keys(entity_type_confidences).length;

  const status: MicroStatus = confidence >= 0.7 ? "OK" : "UNSURE";

  return {
    status,
    entities,
    confidence,
    text,
    details: {
      patterns_matched,
      total_patterns: TOTAL_ENTITY_TYPES,
      entity_type_confidences,
    },
  };
}

// ─── CLI Entry Point ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const textIdx = args.indexOf("--text");
    const inputText =
      textIdx !== -1 && args[textIdx + 1]
        ? args[textIdx + 1]
        : "Иван Петров приехал в Москву 15 марта 2025 года.";

    const result = await extractMicro(inputText);
    console.log(JSON.stringify(result, null, 2));
  })();
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { extractMicro };
export type { EntityType, Entity, MicroStatus, MicroModelResult };
