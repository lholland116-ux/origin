/**
 * Controlled CAPA scope-section contract.
 *
 * Primary controlled sources:
 * - Document #3 — User Requirements Specification
 *   URS-INT-002 through URS-INT-010
 * - Document #4 — Workflow and State Specification
 *   S10 and G-01
 * - Document #5 — Human Review UI Specification
 *   G-01
 * - BL-055 — Build guided intake and scope
 *
 * Regulatory design context:
 * - FDA Quality Management System Regulation (QMSR)
 * - ISO 13485:2016 section 8.5.2
 * - Former 21 CFR 820.100 retained as a legacy CAPA cross-reference
 *
 * This contract represents working scope content. Structural validity and
 * gate prerequisites do not constitute adequacy, approval, risk acceptance,
 * regulatory disposition, or workflow authorization.
 */

export const CAPA_SCOPE_SECTION_TYPE =
  "CAPA.SCOPE" as const;

export const CAPA_SCOPE_SCHEMA_VERSION =
  "capa-scope-1.1.0" as const;

export const CAPA_SCOPE_ELEMENT_TYPES = [
  "product",
  "process",
  "site",
  "supplier",
  "system",
  "other",
] as const;

export type CapaScopeElementType =
  (typeof CAPA_SCOPE_ELEMENT_TYPES)[number];

export const CAPA_SCOPE_APPLICABILITY_DECISIONS = [
  "capa_applicable",
  "capa_not_applicable",
  "pending",
] as const;

export type CapaScopeApplicabilityDecision =
  (typeof CAPA_SCOPE_APPLICABILITY_DECISIONS)[number];

export const CAPA_SCOPE_ESCALATION_STATUSES = [
  "open",
  "resolved",
] as const;

export type CapaScopeEscalationStatus =
  (typeof CAPA_SCOPE_ESCALATION_STATUSES)[number];

export interface CapaScopeDimensions {
  readonly what: string | null;
  readonly where: string | null;
  readonly when: string | null;
  readonly extent: string | null;
  readonly detection_method: string | null;
}

export interface CapaScopeElement {
  readonly element_type:
    CapaScopeElementType;
  readonly value: string;
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

export interface CapaScopeTargetDate {
  readonly label: string;
  readonly target_date: string;
}

export interface CapaScopeApplicability {
  readonly decision:
    CapaScopeApplicabilityDecision;
  readonly rationale: string;
}

export interface CapaScopeEscalation {
  readonly process: string;
  readonly reference: string;
  readonly status:
    CapaScopeEscalationStatus;
  readonly rationale: string;
}

export interface CapaScopeContent {
  readonly problem_statement:
    string | null;

  readonly scope_dimensions:
    CapaScopeDimensions;

  readonly affected_scope_elements:
    readonly CapaScopeElement[];

  readonly included_scope:
    readonly string[];

  readonly exclusions:
    readonly CapaScopeExclusion[];

  readonly extent_summary:
    CapaScopeExtentSummary;

  /**
   * Organization-specific priority terminology.
   * LVTChat does not impose an autonomous risk or priority classification.
   */
  readonly priority:
    string | null;

  readonly target_dates:
    readonly CapaScopeTargetDate[];

  /**
   * Explicit human-entered CAPA applicability record.
   * AI must not populate this as an authoritative disposition.
   */
  readonly applicability:
    CapaScopeApplicability | null;

  readonly source_reference:
    string | null;

  readonly evidence_references:
    readonly string[];

  readonly unresolved_scope_gaps:
    readonly string[];

  readonly required_escalations:
    readonly CapaScopeEscalation[];
}

export const CAPA_SCOPE_VALIDATION_REASON_CODES = [
  "INVALID_SCOPE_OBJECT",
  "INVALID_SCOPE_FIELDS",
  "INVALID_PROBLEM_STATEMENT",
  "INVALID_SCOPE_DIMENSIONS",
  "INVALID_AFFECTED_SCOPE_ELEMENTS",
  "INVALID_INCLUDED_SCOPE",
  "INVALID_SCOPE_EXCLUSIONS",
  "INVALID_EXTENT_SUMMARY",
  "INVALID_PRIORITY",
  "INVALID_TARGET_DATES",
  "INVALID_APPLICABILITY",
  "INVALID_SOURCE_REFERENCE",
  "INVALID_EVIDENCE_REFERENCES",
  "INVALID_UNRESOLVED_SCOPE_GAPS",
  "INVALID_REQUIRED_ESCALATIONS",
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

export const CAPA_SCOPE_GATE_BLOCKER_CODES = [
  "MISSING_PROBLEM_STATEMENT",
  "MISSING_AFFECTED_SCOPE",
  "MISSING_INCLUDED_SCOPE",
  "MISSING_KNOWN_EXTENT",
  "MISSING_SOURCE_REFERENCE",
  "MISSING_PRIORITY",
  "MISSING_TARGET_DATE",
  "CAPA_APPLICABILITY_NOT_CONFIRMED",
  "UNRESOLVED_SCOPE_GAPS",
  "UNRESOLVED_REQUIRED_ESCALATION",
] as const;

export type CapaScopeGateBlockerCode =
  (typeof CAPA_SCOPE_GATE_BLOCKER_CODES)[number];

/**
 * Deterministic G-01 prerequisite evaluation.
 *
 * Passing these checks means only that configured objective prerequisites
 * are present. It explicitly does not mean that the problem statement or
 * scope is adequate. The authorized human reviewer remains responsible for
 * the substantive G-01 decision.
 */
export type CapaScopeGatePrerequisiteResult =
  | {
      readonly status:
        "prerequisites_met";
    }
  | {
      readonly status: "blocked";
      readonly blocker_codes:
        readonly CapaScopeGateBlockerCode[];
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

function isTrimmedText(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value
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

  return isTrimmedText(value)
    ? value
    : INVALID;
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
    if (!isTrimmedText(item)) {
      return INVALID;
    }

    result.push(item);
  }

  return Object.freeze(result);
}

function isIsoDate(
  value: string,
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed =
    new Date(
      `${value}T00:00:00.000Z`,
    );

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) ===
      value
  );
}

function isScopeElementType(
  value: unknown,
): value is CapaScopeElementType {
  return (
    value === "product" ||
    value === "process" ||
    value === "site" ||
    value === "supplier" ||
    value === "system" ||
    value === "other"
  );
}

function isApplicabilityDecision(
  value: unknown,
): value is CapaScopeApplicabilityDecision {
  return (
    value === "capa_applicable" ||
    value === "capa_not_applicable" ||
    value === "pending"
  );
}

function isEscalationStatus(
  value: unknown,
): value is CapaScopeEscalationStatus {
  return (
    value === "open" ||
    value === "resolved"
  );
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

function parsedScopeElements(
  value: unknown,
):
  | readonly CapaScopeElement[]
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result:
    CapaScopeElement[] = [];
  const seen =
    new Set<string>();

  for (const item of value) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, [
        "element_type",
        "value",
      ]) ||
      !isScopeElementType(
        item.element_type,
      ) ||
      !isTrimmedText(item.value)
    ) {
      return INVALID;
    }

    const identity =
      `${item.element_type}\u0000${item.value}`;

    if (seen.has(identity)) {
      return INVALID;
    }

    seen.add(identity);

    result.push(
      Object.freeze({
        element_type:
          item.element_type,
        value: item.value,
      }),
    );
  }

  return Object.freeze(result);
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
      !isTrimmedText(item.subject) ||
      !isTrimmedText(item.rationale)
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

function parsedTargetDates(
  value: unknown,
):
  | readonly CapaScopeTargetDate[]
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result:
    CapaScopeTargetDate[] = [];

  for (const item of value) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, [
        "label",
        "target_date",
      ]) ||
      !isTrimmedText(item.label) ||
      typeof item.target_date !==
        "string" ||
      !isIsoDate(item.target_date)
    ) {
      return INVALID;
    }

    result.push(
      Object.freeze({
        label: item.label,
        target_date:
          item.target_date,
      }),
    );
  }

  return Object.freeze(result);
}

function parsedApplicability(
  value: unknown,
):
  | CapaScopeApplicability
  | null
  | typeof INVALID {
  if (value === null) {
    return null;
  }

  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "decision",
      "rationale",
    ]) ||
    !isApplicabilityDecision(
      value.decision,
    ) ||
    !isTrimmedText(value.rationale)
  ) {
    return INVALID;
  }

  return Object.freeze({
    decision: value.decision,
    rationale: value.rationale,
  });
}

function parsedEscalations(
  value: unknown,
):
  | readonly CapaScopeEscalation[]
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result:
    CapaScopeEscalation[] = [];

  for (const item of value) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, [
        "process",
        "reference",
        "status",
        "rationale",
      ]) ||
      !isTrimmedText(item.process) ||
      !isTrimmedText(item.reference) ||
      !isEscalationStatus(
        item.status,
      ) ||
      !isTrimmedText(item.rationale)
    ) {
      return INVALID;
    }

    result.push(
      Object.freeze({
        process: item.process,
        reference: item.reference,
        status: item.status,
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
      "affected_scope_elements",
      "included_scope",
      "exclusions",
      "extent_summary",
      "priority",
      "target_dates",
      "applicability",
      "source_reference",
      "evidence_references",
      "unresolved_scope_gaps",
      "required_escalations",
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

  const affectedScopeElements =
    parsedScopeElements(
      value.affected_scope_elements,
    );

  if (
    affectedScopeElements === INVALID
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_AFFECTED_SCOPE_ELEMENTS",
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

  const priority =
    parsedNullableText(value.priority);

  if (priority === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_PRIORITY",
    };
  }

  const targetDates =
    parsedTargetDates(
      value.target_dates,
    );

  if (targetDates === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_TARGET_DATES",
    };
  }

  const applicability =
    parsedApplicability(
      value.applicability,
    );

  if (applicability === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_APPLICABILITY",
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

  const requiredEscalations =
    parsedEscalations(
      value.required_escalations,
    );

  if (
    requiredEscalations === INVALID
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_REQUIRED_ESCALATIONS",
    };
  }

  return {
    status: "valid",
    value: Object.freeze({
      problem_statement:
        problemStatement,
      scope_dimensions:
        scopeDimensions,
      affected_scope_elements:
        affectedScopeElements,
      included_scope:
        includedScope,
      exclusions,
      extent_summary:
        extentSummary,
      priority,
      target_dates:
        targetDates,
      applicability,
      source_reference:
        sourceReference,
      evidence_references:
        evidenceReferences,
      unresolved_scope_gaps:
        unresolvedScopeGaps,
      required_escalations:
        requiredEscalations,
    }),
  };
}

export function evaluateCapaScopeGatePrerequisites(
  content: CapaScopeContent,
): CapaScopeGatePrerequisiteResult {
  const blockers:
    CapaScopeGateBlockerCode[] = [];

  if (
    content.problem_statement === null
  ) {
    blockers.push(
      "MISSING_PROBLEM_STATEMENT",
    );
  }

  if (
    content.affected_scope_elements
      .length === 0
  ) {
    blockers.push(
      "MISSING_AFFECTED_SCOPE",
    );
  }

  if (
    content.included_scope.length ===
    0
  ) {
    blockers.push(
      "MISSING_INCLUDED_SCOPE",
    );
  }

  const hasKnownExtent =
    content.scope_dimensions.extent !==
      null ||
    content.extent_summary.magnitude !==
      null ||
    content.extent_summary.frequency !==
      null ||
    content.extent_summary.trend !==
      null ||
    content.extent_summary
      .affected_population !== null;

  if (!hasKnownExtent) {
    blockers.push(
      "MISSING_KNOWN_EXTENT",
    );
  }

  if (
    content.source_reference === null
  ) {
    blockers.push(
      "MISSING_SOURCE_REFERENCE",
    );
  }

  if (content.priority === null) {
    blockers.push(
      "MISSING_PRIORITY",
    );
  }

  if (
    content.target_dates.length === 0
  ) {
    blockers.push(
      "MISSING_TARGET_DATE",
    );
  }

  if (
    content.applicability === null ||
    content.applicability.decision !==
      "capa_applicable"
  ) {
    blockers.push(
      "CAPA_APPLICABILITY_NOT_CONFIRMED",
    );
  }

  if (
    content.unresolved_scope_gaps
      .length > 0
  ) {
    blockers.push(
      "UNRESOLVED_SCOPE_GAPS",
    );
  }

  if (
    content.required_escalations.some(
      (item) =>
        item.status === "open",
    )
  ) {
    blockers.push(
      "UNRESOLVED_REQUIRED_ESCALATION",
    );
  }

  if (blockers.length > 0) {
    return {
      status: "blocked",
      blocker_codes:
        Object.freeze(blockers),
    };
  }

  return {
    status: "prerequisites_met",
  };
}
