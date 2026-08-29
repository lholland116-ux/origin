/**
 * Controlled CAPA scope-section contract.
 *
 * Primary controlled sources:
 * - Document #3 — User Requirements Specification
 *   URS-INT-004 through URS-INT-010
 * - Document #4 — Workflow and State Specification
 *   G-01
 * - Document #5 — Human Review UI Specification
 *   G-01
 * - BL-055 — Build guided intake and scope
 *
 * Regulatory design context:
 * - FDA Quality Management System Regulation (QMSR)
 * - ISO 13485:2016 section 8.5.2
 * - Former 21 CFR 820.100 retained as a legacy CAPA cross-reference
 *
 * This contract represents working scope content. A structurally valid
 * record is not necessarily adequate for G-01 approval. Gate readiness
 * and human disposition are evaluated separately.
 */

export const CAPA_SCOPE_SECTION_TYPE =
  "CAPA.SCOPE" as const;

export const CAPA_SCOPE_SCHEMA_VERSION =
  "capa-scope-1.0.0" as const;

export interface CapaScopeDimensions {
  readonly what: string | null;
  readonly where: string | null;
  readonly when: string | null;
  readonly extent: string | null;
  readonly detection_method: string | null;
}

export interface CapaScopeExtentSummary {
  readonly magnitude: string | null;
  readonly frequency: string | null;
  readonly trend: string | null;
  readonly affected_population: string | null;
}

export interface CapaScopeExclusion {
  readonly subject: string;
  readonly rationale: string;
}

export interface CapaScopeContent {
  readonly problem_statement: string | null;
  readonly scope_dimensions:
    CapaScopeDimensions;
  readonly included_scope:
    readonly string[];
  readonly exclusions:
    readonly CapaScopeExclusion[];
  readonly extent_summary:
    CapaScopeExtentSummary;
  readonly applicability_statement:
    string | null;
  readonly source_reference:
    string | null;
  readonly evidence_references:
    readonly string[];
  readonly unresolved_scope_gaps:
    readonly string[];
}

export const CAPA_SCOPE_VALIDATION_REASON_CODES = [
  "INVALID_SCOPE_OBJECT",
  "INVALID_SCOPE_FIELDS",
  "INVALID_PROBLEM_STATEMENT",
  "INVALID_SCOPE_DIMENSIONS",
  "INVALID_INCLUDED_SCOPE",
  "INVALID_SCOPE_EXCLUSIONS",
  "INVALID_EXTENT_SUMMARY",
  "INVALID_APPLICABILITY_STATEMENT",
  "INVALID_SOURCE_REFERENCE",
  "INVALID_EVIDENCE_REFERENCES",
  "INVALID_UNRESOLVED_SCOPE_GAPS",
] as const;

export type CapaScopeValidationReasonCode =
  (typeof CAPA_SCOPE_VALIDATION_REASON_CODES)[number];

export type CapaScopeValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaScopeContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        CapaScopeValidationReasonCode;
    };

const INVALID = Symbol("INVALID");

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);

  return (
    actual.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(
        value,
        key,
      ),
    )
  );
}

function parsedNullableText(
  value: unknown,
):
  | string
  | null
  | typeof INVALID {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return INVALID;
  }

  return value;
}

function parsedTextArray(
  value: unknown,
):
  | readonly string[]
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result: string[] = [];

  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.trim() !== item
    ) {
      return INVALID;
    }

    result.push(item);
  }

  return Object.freeze(result);
}

function parsedScopeDimensions(
  value: unknown,
):
  | CapaScopeDimensions
  | typeof INVALID {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "what",
      "where",
      "when",
      "extent",
      "detection_method",
    ])
  ) {
    return INVALID;
  }

  const what =
    parsedNullableText(value.what);
  const where =
    parsedNullableText(value.where);
  const when =
    parsedNullableText(value.when);
  const extent =
    parsedNullableText(value.extent);
  const detectionMethod =
    parsedNullableText(
      value.detection_method,
    );

  if (
    what === INVALID ||
    where === INVALID ||
    when === INVALID ||
    extent === INVALID ||
    detectionMethod === INVALID
  ) {
    return INVALID;
  }

  return Object.freeze({
    what,
    where,
    when,
    extent,
    detection_method:
      detectionMethod,
  });
}

function parsedExtentSummary(
  value: unknown,
):
  | CapaScopeExtentSummary
  | typeof INVALID {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "magnitude",
      "frequency",
      "trend",
      "affected_population",
    ])
  ) {
    return INVALID;
  }

  const magnitude =
    parsedNullableText(value.magnitude);
  const frequency =
    parsedNullableText(value.frequency);
  const trend =
    parsedNullableText(value.trend);
  const affectedPopulation =
    parsedNullableText(
      value.affected_population,
    );

  if (
    magnitude === INVALID ||
    frequency === INVALID ||
    trend === INVALID ||
    affectedPopulation === INVALID
  ) {
    return INVALID;
  }

  return Object.freeze({
    magnitude,
    frequency,
    trend,
    affected_population:
      affectedPopulation,
  });
}

function parsedExclusions(
  value: unknown,
):
  | readonly CapaScopeExclusion[]
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result:
    CapaScopeExclusion[] = [];

  for (const item of value) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, [
        "subject",
        "rationale",
      ]) ||
      typeof item.subject !== "string" ||
      item.subject.length === 0 ||
      item.subject.trim() !==
        item.subject ||
      typeof item.rationale !== "string" ||
      item.rationale.length === 0 ||
      item.rationale.trim() !==
        item.rationale
    ) {
      return INVALID;
    }

    result.push(
      Object.freeze({
        subject: item.subject,
        rationale: item.rationale,
      }),
    );
  }

  return Object.freeze(result);
}

export function validateCapaScopeContent(
  value: unknown,
): CapaScopeValidationResult {
  if (!isPlainObject(value)) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_SCOPE_OBJECT",
    };
  }

  if (
    !hasExactKeys(value, [
      "problem_statement",
      "scope_dimensions",
      "included_scope",
      "exclusions",
      "extent_summary",
      "applicability_statement",
      "source_reference",
      "evidence_references",
      "unresolved_scope_gaps",
    ])
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_SCOPE_FIELDS",
    };
  }

  const problemStatement =
    parsedNullableText(
      value.problem_statement,
    );

  if (problemStatement === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_PROBLEM_STATEMENT",
    };
  }

  const scopeDimensions =
    parsedScopeDimensions(
      value.scope_dimensions,
    );

  if (scopeDimensions === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_SCOPE_DIMENSIONS",
    };
  }

  const includedScope =
    parsedTextArray(
      value.included_scope,
    );

  if (includedScope === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_INCLUDED_SCOPE",
    };
  }

  const exclusions =
    parsedExclusions(value.exclusions);

  if (exclusions === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_SCOPE_EXCLUSIONS",
    };
  }

  const extentSummary =
    parsedExtentSummary(
      value.extent_summary,
    );

  if (extentSummary === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_EXTENT_SUMMARY",
    };
  }

  const applicabilityStatement =
    parsedNullableText(
      value.applicability_statement,
    );

  if (
    applicabilityStatement === INVALID
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_APPLICABILITY_STATEMENT",
    };
  }

  const sourceReference =
    parsedNullableText(
      value.source_reference,
    );

  if (sourceReference === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_SOURCE_REFERENCE",
    };
  }

  const evidenceReferences =
    parsedTextArray(
      value.evidence_references,
    );

  if (
    evidenceReferences === INVALID
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_EVIDENCE_REFERENCES",
    };
  }

  const unresolvedScopeGaps =
    parsedTextArray(
      value.unresolved_scope_gaps,
    );

  if (
    unresolvedScopeGaps === INVALID
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_UNRESOLVED_SCOPE_GAPS",
    };
  }

  return {
    status: "valid",
    value: Object.freeze({
      problem_statement:
        problemStatement,
      scope_dimensions:
        scopeDimensions,
      included_scope:
        includedScope,
      exclusions,
      extent_summary:
        extentSummary,
      applicability_statement:
        applicabilityStatement,
      source_reference:
        sourceReference,
      evidence_references:
        evidenceReferences,
      unresolved_scope_gaps:
        unresolvedScopeGaps,
    }),
  };
}
