/**
 * Combined confidence assessor for NER validation.
 *
 * Merges Self-check + Constraint-based validation into a single
 * ACCEPT / REVIEW / REJECT decision with a numeric confidence score.
 */

import type { Entity, SelfCheckResult } from "./self-check";
import type { ConstraintResult } from "./constraint-validator";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ConfidenceInput {
  text: string;
  entities: Entity[];
  selfCheckResult?: SelfCheckResult;
  constraintResult?: ConstraintResult;
}

type Decision = "ACCEPT" | "REVIEW" | "REJECT";

interface ConfidenceReport {
  decision: Decision;
  confidence: number;           // 0.0 - 1.0 overall
  self_check_confidence: number; // 0.0 - 1.0 from self-check
  constraint_score: number;      // 0.0 - 1.0 from constraint validator
  entities: Entity[];            // final entity list
  reason: string;                // human-readable explanation
  checks: {
    self_check_applied: boolean;
    constraint_applied: boolean;
    constraint_errors: number;
    constraint_warnings: number;
  };
}

// ─── Main function ──────────────────────────────────────────────────────────

function assessConfidence(input: ConfidenceInput): ConfidenceReport {
  const selfCheckApplied = input.selfCheckResult !== undefined;
  const constraintApplied = input.constraintResult !== undefined;

  const selfCheckConfidence = input.selfCheckResult?.confidence ?? 0.0;
  const constraintScore = input.constraintResult?.score ?? 1.0;
  const constraintErrors = input.constraintResult?.summary.errors ?? 0;
  const constraintWarnings = input.constraintResult?.summary.warnings ?? 0;
  const constraintValid = input.constraintResult?.valid ?? true;

  // ── 1. Combined confidence ─────────────────────────────────────────────

  let confidence: number;
  if (selfCheckApplied) {
    confidence = 0.6 * selfCheckConfidence + 0.4 * constraintScore;
  } else {
    confidence = constraintScore;
  }

  // ── 2. Base decision from confidence ───────────────────────────────────

  let decision: Decision;
  if (confidence >= 0.7) {
    decision = "ACCEPT";
  } else if (confidence >= 0.4) {
    decision = "REVIEW";
  } else {
    decision = "REJECT";
  }

  // ── 3. Override rules ──────────────────────────────────────────────────

  const reasons: string[] = [];
  let hardReject = false;

  // Rule: constraint valid === false AND errors >= 3 → forced REJECT
  if (constraintApplied && !constraintValid && constraintErrors >= 3) {
    decision = "REJECT";
    hardReject = true;
    reasons.push(`Constraint validation failed with ${constraintErrors} errors`);
  }

  // Rule: self-check removed > 50% of entities → REVIEW (minimum)
  if (selfCheckApplied && input.selfCheckResult !== undefined) {
    const originalCount = input.selfCheckResult.original.entities.length;
    const removedCount = input.selfCheckResult.removed_entities.length;
    if (originalCount > 0 && removedCount / originalCount > 0.5) {
      if (decision !== "REJECT") {
        decision = "REVIEW";
      }
      reasons.push(
        `Self-check removed ${removedCount}/${originalCount} entities (>50%)`,
      );
    }
  }

  // Rule: 0 entities extracted from long text (>30 chars) → REJECT
  const entityCount = input.entities.length;
  if (entityCount === 0 && input.text.length > 30) {
    decision = "REJECT";
    hardReject = true;
    reasons.push("No entities extracted from text longer than 30 characters");
  }

  // Rule: All constraints passed (score = 1.0) AND self_check >= 0.8 → ACCEPT
  if (
    !hardReject &&
    constraintApplied &&
    constraintScore >= 1.0 &&
    selfCheckApplied &&
    selfCheckConfidence >= 0.8
  ) {
    decision = "ACCEPT";
  }

  // ── 4. Final entity list ───────────────────────────────────────────────

  const finalEntities: Entity[] = selfCheckApplied
    ? (input.selfCheckResult?.verified_entities ?? input.entities)
    : input.entities;

  // ── 5. Build reason string ─────────────────────────────────────────────

  let reason: string;
  if (decision === "ACCEPT") {
    reason =
      `All checks passed. Confidence: ${confidence.toFixed(2)} ` +
      `(self-check: ${selfCheckConfidence.toFixed(2)}, ` +
      `constraints: ${constraintScore.toFixed(2)}).`;
  } else if (decision === "REVIEW") {
    const detail = reasons.length > 0 ? reasons.join("; ") : "below acceptance threshold";
    reason =
      `Some concerns found. Confidence: ${confidence.toFixed(2)}. ` +
      `Reasons: ${detail}.`;
  } else {
    const detail = reasons.length > 0 ? reasons.join("; ") : "very low confidence";
    reason =
      `Result rejected. Confidence: ${confidence.toFixed(2)}. ` +
      `Reasons: ${detail}.`;
  }

  return {
    decision,
    confidence,
    self_check_confidence: selfCheckConfidence,
    constraint_score: constraintScore,
    entities: finalEntities,
    reason,
    checks: {
      self_check_applied: selfCheckApplied,
      constraint_applied: constraintApplied,
      constraint_errors: constraintErrors,
      constraint_warnings: constraintWarnings,
    },
  };
}

export { assessConfidence };
export type { ConfidenceInput, ConfidenceReport, Decision };
