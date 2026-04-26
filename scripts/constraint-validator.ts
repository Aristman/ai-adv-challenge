/**
 * Constraint-based validator for NER entities.
 *
 * Programmatic validation without involving an LLM.
 * Applies 10 rules and computes a score based on violations.
 */

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface Entity {
  type: "person" | "date" | "money" | "email" | "phone" | "location";
  value: string;
}

interface ConstraintViolation {
  entity: Entity;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

interface ConstraintResult {
  valid: boolean;
  violations: ConstraintViolation[];
  score: number; // 0.0 - 1.0 (1.0 = no violations)
  summary: {
    total_entities: number;
    passed: number;
    warnings: number;
    errors: number;
  };
}

// ─── Rule implementations ──────────────────────────────────────────────────

/** Rule 7: Entity value not empty */
function checkNotEmpty(entity: Entity): ConstraintViolation | null {
  const trimmed = entity.value.trim();
  if (trimmed.length === 0) {
    return {
      entity,
      rule: "entity-value-not-empty",
      message: "Entity value is empty or whitespace only.",
      severity: "error",
    };
  }
  return null;
}

/** Rule 8: Entity type is valid */
function checkTypeValid(entity: Entity): ConstraintViolation | null {
  const validTypes = ["person", "date", "money", "email", "phone", "location"];
  if (!validTypes.includes(entity.type)) {
    return {
      entity,
      rule: "entity-type-valid",
      message: `Invalid entity type: "${entity.type}".`,
      severity: "error",
    };
  }
  return null;
}

/** Rule 1: Email format */
function checkEmailFormat(entity: Entity): ConstraintViolation | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(entity.value.trim())) {
    return {
      entity,
      rule: "email-format",
      message: `Invalid email format: "${entity.value}".`,
      severity: "error",
    };
  }
  return null;
}

/** Rule 2: Phone format */
function checkPhoneFormat(entity: Entity): ConstraintViolation | null {
  const digits = entity.value.replace(/\D/g, "");

  if (digits.length < 7) {
    return {
      entity,
      rule: "phone-format",
      message: `Phone number has only ${digits.length} digits (minimum 7 required): "${entity.value}".`,
      severity: "error",
    };
  }

  const trimmed = entity.value.trim();
  if (!trimmed.startsWith("+") && !trimmed.startsWith("8") && !/^\d/.test(trimmed)) {
    return {
      entity,
      rule: "phone-format",
      message: `Unusual phone format (does not start with +, 8, or digit): "${entity.value}".`,
      severity: "warning",
    };
  }

  return null;
}

/** Rule 3: Money format */
function checkMoneyFormat(entity: Entity): ConstraintViolation | null {
  const hasDigit = /\d/.test(entity.value);
  if (!hasDigit) {
    return {
      entity,
      rule: "money-format",
      message: `Money value contains no digits: "${entity.value}".`,
      severity: "error",
    };
  }

  const valueLower = entity.value.toLowerCase();
  const currencyIndicators = ["руб", "₽", "$", "eur", "usd", "млн", "тысяч"];
  const hasCurrencyIndicator = currencyIndicators.some((indicator) =>
    valueLower.includes(indicator),
  );

  // Extract numeric value to check if > 100
  const numericMatch = entity.value.match(/[\d.,]+/);
  let numericValue = 0;
  if (numericMatch !== null) {
    const cleaned = numericMatch[0].replace(/[.,]/g, "");
    numericValue = parseInt(cleaned, 10);
    if (Number.isNaN(numericValue)) {
      numericValue = 0;
    }
  }

  if (!hasCurrencyIndicator && numericValue <= 100) {
    return {
      entity,
      rule: "money-format",
      message: `Money value lacks explicit currency indicator: "${entity.value}".`,
      severity: "warning",
    };
  }

  return null;
}

/** Rule 4: Date format */
function checkDateFormat(entity: Entity): ConstraintViolation | null {
  const trimmed = entity.value.trim();

  // Must contain at least one digit to be a date
  if (!/\d/.test(trimmed)) {
    return {
      entity,
      rule: "date-format",
      message: `Date value contains no digits: "${entity.value}".`,
      severity: "error",
    };
  }

  // Must also contain some textual month/day indicator or common date separators
  const monthNames = [
    "январ", "феврал", "март", "апрел", "май", "июн",
    "июл", "август", "сентябр", "октябр", "ноябр", "декабр",
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const hasMonthIndicator = monthNames.some((m) => trimmed.toLowerCase().includes(m));
  const hasDateSeparators = /[\/\-\.\s]\d|[а-я]{2,}\s/i.test(trimmed);

  if (!hasMonthIndicator && !hasDateSeparators) {
    return {
      entity,
      rule: "date-format",
      message: `Value does not look like a date: "${entity.value}".`,
      severity: "error",
    };
  }

  // Warning: year before 2020 might be a model error
  const yearMatch = trimmed.match(/\b(19|20)\d{2}\b/);
  if (yearMatch !== null) {
    const year = parseInt(yearMatch[0], 10);
    if (year < 2020) {
      return {
        entity,
        rule: "date-format",
        message: `Date year ${year} is in the past (before 2020), possibly a model error: "${entity.value}".`,
        severity: "warning",
      };
    }
  }

  return null;
}

/** Rule 5: Person format */
function checkPersonFormat(entity: Entity): ConstraintViolation | null {
  const trimmed = entity.value.trim();
  const words = trimmed.split(/\s+/);

  // Error: only digits or special chars (no letters at all, including Cyrillic)
  if (!/\p{L}/u.test(trimmed)) {
    return {
      entity,
      rule: "person-format",
      message: `Person name contains only digits or special characters: "${entity.value}".`,
      severity: "error",
    };
  }

  // Warning: single word (might not be a name)
  if (words.length === 1) {
    return {
      entity,
      rule: "person-format",
      message: `Person name is a single word, may not be a proper name: "${entity.value}".`,
      severity: "warning",
    };
  }

  return null;
}

/** Rule 6: Location format */
function checkLocationFormat(entity: Entity): ConstraintViolation | null {
  const trimmed = entity.value.trim();

  // Error: contains @ or http
  if (/@/.test(trimmed) || /https?:\/\//i.test(trimmed)) {
    return {
      entity,
      rule: "location-format",
      message: `Location value contains URL/email characters, likely not a location: "${entity.value}".`,
      severity: "error",
    };
  }

  // Warning: too short
  if (trimmed.length < 3) {
    return {
      entity,
      rule: "location-format",
      message: `Location name is too short (${trimmed.length} chars): "${entity.value}".`,
      severity: "warning",
    };
  }

  return null;
}

/** Rule 9: Duplicate entities */
function checkDuplicates(entities: Entity[]): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const seen = new Map<string, Entity>();

  for (const entity of entities) {
    const key = `${entity.type}:${entity.value}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      violations.push({
        entity,
        rule: "no-duplicates",
        message: `Duplicate entity: type="${entity.type}", value="${entity.value}".`,
        severity: "warning",
      });
    } else {
      seen.set(key, entity);
    }
  }

  return violations;
}

/** Fuzzy check: Russian morphology tolerant matching */
function sourceTextFuzzyContains(sourceText: string, entityValue: string): boolean {
  const valueLower = entityValue.toLowerCase();
  const textLower = sourceText.toLowerCase();

  // Exact match (case-insensitive)
  if (textLower.includes(valueLower)) return true;

  // Check first word root (min 4 chars) for Russian morphology
  const firstWord = valueLower.split(/\s+/)[0];
  if (firstWord.length >= 4) {
    const root = firstWord.substring(0, Math.min(4, firstWord.length));
    if (textLower.includes(root)) return true;
  }

  // Strip common Russian endings and check each word
  const endings = /(?:ой|ая|ое|ые|ом|ем|у|а|ов|ев|ин|ич|на|ни|ко|ка|ки|ам|ами|ах|ях|ю|е|и|ь|ё|го|му|ым|ую|ее|его|ому|ыми)$/;
  const words = valueLower.split(/\s+/);
  const allMatch = words.every((word) => {
    if (word.length < 3) return true;
    const stem = word.replace(endings, "");
    return stem.length >= 2 && textLower.includes(stem);
  });
  if (allMatch && words.length > 0) return true;

  return false;
}

/** Rule 10: Entity value appears in source text */
function checkSourceTextPresence(
  entities: Entity[],
  sourceText: string,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const entity of entities) {
    const trimmed = entity.value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (sourceTextFuzzyContains(sourceText, trimmed)) {
      continue;
    }

    violations.push({
      entity,
      rule: "source-text-presence",
      message: `Entity value "${entity.value}" not found in source text — model may have hallucinated.`,
      severity: "warning",
    });
  }

  return violations;
}

// ─── Main function ──────────────────────────────────────────────────────────

function validateConstraints(
  entities: Entity[],
  sourceText?: string,
): ConstraintResult {
  const violations: ConstraintViolation[] = [];

  try {
    // Per-entity rules (rules 1-8)
    const perEntityChecks: Record<string, (e: Entity) => ConstraintViolation | null> = {
      person: checkPersonFormat,
      date: checkDateFormat,
      money: checkMoneyFormat,
      email: checkEmailFormat,
      phone: checkPhoneFormat,
      location: checkLocationFormat,
    };

    for (const entity of entities) {
      // Rule 7: not empty (all types)
      const emptyViolation = checkNotEmpty(entity);
      if (emptyViolation !== null) {
        violations.push(emptyViolation);
        continue; // skip further checks for empty values
      }

      // Rule 8: type valid (all types)
      const typeViolation = checkTypeValid(entity);
      if (typeViolation !== null) {
        violations.push(typeViolation);
        continue; // skip further checks for invalid types
      }

      // Type-specific rules (1-6)
      const typeCheck = perEntityChecks[entity.type];
      if (typeCheck !== undefined) {
        const violation = typeCheck(entity);
        if (violation !== null) {
          violations.push(violation);
        }
      }
    }

    // Rule 9: duplicates
    const dupViolations = checkDuplicates(entities);
    violations.push(...dupViolations);

    // Rule 10: source text presence (optional)
    if (sourceText !== undefined && sourceText.length > 0) {
      const textViolations = checkSourceTextPresence(entities, sourceText);
      violations.push(...textViolations);
    }
  } catch (err) {
    console.error(
      "[constraint-validator] Unexpected error during validation:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // ─── Scoring ──────────────────────────────────────────────────────────
  let score = 1.0;

  let errorCount = 0;
  let warningCount = 0;

  for (const violation of violations) {
    if (violation.severity === "error") {
      score -= 0.15;
      errorCount++;
    } else if (violation.severity === "warning") {
      score -= 0.05;
      warningCount++;
    }
  }

  score = Math.max(0.0, Math.min(1.0, score));

  const passedCount = Math.max(0, entities.length - errorCount);
  const totalCount = entities.length;

  return {
    valid: errorCount === 0,
    violations,
    score,
    summary: {
      total_entities: totalCount,
      passed: passedCount,
      warnings: warningCount,
      errors: errorCount,
    },
  };
}

// ─── Demo (run directly) ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  const testEntities: Entity[] = [
    { type: "person", value: "Иван Петров" },
    { type: "email", value: "test@example.com" },
    { type: "email", value: "invalid-email" },
    { type: "phone", value: "+7 999 123-45-67" },
    { type: "phone", value: "123" },
    { type: "money", value: "5000 рублей" },
    { type: "money", value: "некая сумма" },
    { type: "date", value: "15 марта 2025 года" },
    { type: "date", value: "завтра обязательно" },
    { type: "location", value: "Москва" },
    { type: "location", value: "A@" },
    { type: "person", value: "12345!@#" },
    { type: "person", value: "" },
    { type: "person", value: "Иван Петров" }, // duplicate
  ];

  const sourceText = "Иван Петров приехал в Москву 15 марта 2025 года.";

  console.info("=== Constraint Validator Demo ===\n");
  console.info("Source text:", sourceText);
  console.info("Entities:", JSON.stringify(testEntities, null, 2), "\n");

  const result = validateConstraints(testEntities, sourceText);

  console.info("Valid:", result.valid);
  console.info("Score:", result.score.toFixed(2));
  console.info(
    "Summary:",
    `${result.summary.passed}/${result.summary.total_entities} passed, ` +
      `${result.summary.warnings} warnings, ${result.summary.errors} errors`,
  );

  if (result.violations.length > 0) {
    console.info("\nViolations:");
    for (const v of result.violations) {
      const icon = v.severity === "error" ? "❌" : "⚠️";
      console.info(
        `  ${icon} [${v.rule}] ${v.message} (entity: ${v.entity.type}="${v.entity.value}")`,
      );
    }
  }
}

export { validateConstraints };
export type { ConstraintResult, ConstraintViolation, Entity };
