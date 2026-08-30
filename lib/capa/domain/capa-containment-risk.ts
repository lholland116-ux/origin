/**
 * Controlled CAPA containment and impact/risk section contract.
 *
 * Primary controlled sources:
 * - Document #3 — User Requirements Specification
 *   URS-RISK-001 through URS-RISK-010
 * - Document #4 — Workflow and State Specification
 *   G-02
 * - Document #5 — Human Review UI Specification
 *   G-02
 * - BL-056 — Build containment and risk-assessment records
 *
 * Regulatory design context:
 * - FDA Quality Management System Regulation (QMSR)
 * - ISO 13485:2016 section 8.5.2
 * - Former 21 CFR 820.100 retained as a legacy CAPA cross-reference
 *
 * This record stores organization-entered information. It must not be
 * interpreted as an autonomous product-release, patient-risk, recall,
 * field-action, reportability, or risk-acceptance decision.
 */

export const CAPA_CONTAINMENT_RISK_SECTION_TYPE =
  "CAPA.CONTAINMENT_RISK" as const;

export const CAPA_CONTAINMENT_RISK_SCHEMA_VERSION =
  "capa-containment-risk-1.0.0" as const;

export const CAPA_CONTAINMENT_ACTION_TYPES = [
  "correction",
  "containment",
] as const;

export type CapaContainmentActionType =
  (typeof CAPA_CONTAINMENT_ACTION_TYPES)[number];

export const CAPA_CONTAINMENT_ACTION_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type CapaContainmentActionStatus =
  (typeof CAPA_CONTAINMENT_ACTION_STATUSES)[number];

export interface CapaContainmentAction {
  readonly action_id: string;
  readonly action_type:
    CapaContainmentActionType;
  readonly description: string;
  readonly owner_user_id:
    string | null;
  readonly action_date:
    string | null;
  readonly target_date:
    string | null;
  readonly completed_date:
    string | null;
  readonly status:
    CapaContainmentActionStatus;
  readonly rationale: string;
  readonly supporting_evidence_references:
    readonly string[];
}

export interface CapaImpactScope {
  readonly products:
    readonly string[];
  readonly processes:
    readonly string[];
  readonly data:
    readonly string[];
  readonly customers:
    readonly string[];
  readonly patients:
    readonly string[];
}

export interface CapaRiskEvaluation {
  readonly method: string;
  readonly terminology_version:
    string | null;
  readonly result: string;
  readonly rationale: string;
}

export interface CapaRiskEscalation {
  readonly process: string;
  readonly reference: string;
  readonly status: string;
  readonly rationale: string;
}

export interface CapaContainmentRiskContent {
  readonly actions:
    readonly CapaContainmentAction[];
  readonly impact_scope:
    CapaImpactScope;
  readonly risk_evaluation:
    CapaRiskEvaluation | null;
  readonly missing_risk_information:
    readonly string[];
  readonly escalations:
    readonly CapaRiskEscalation[];
}

export const CAPA_CONTAINMENT_RISK_VALIDATION_REASON_CODES = [
  "INVALID_CONTAINMENT_RISK_OBJECT",
  "INVALID_CONTAINMENT_RISK_FIELDS",
  "INVALID_CONTAINMENT_ACTIONS",
  "DUPLICATE_CONTAINMENT_ACTION_ID",
  "INVALID_IMPACT_SCOPE",
  "INVALID_RISK_EVALUATION",
  "INVALID_MISSING_RISK_INFORMATION",
  "INVALID_RISK_ESCALATIONS",
] as const;

export type CapaContainmentRiskValidationReasonCode =
  (typeof CAPA_CONTAINMENT_RISK_VALIDATION_REASON_CODES)[number];

export type CapaContainmentRiskValidationResult =
  | {
      readonly status: "valid";
      readonly value:
        CapaContainmentRiskContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        CapaContainmentRiskValidationReasonCode;
    };

/**
 * Deterministic G-02 internal issue codes. These are not a replacement for
 * the controlled B-01 through B-12 blocker catalog. Each value names the
 * approved S20 blocker semantic directly so presentation/reporting layers
 * can map it to the authoritative catalog without creating a second set of
 * B-identifiers.
 */
export const CAPA_CONTAINMENT_RISK_GATE_BLOCKER_CODES = [
  "MISSING_REQUIRED_CONTROLLED_DATA",
  "UNASSIGNED_CONTAINMENT",
  "UNRESOLVED_RISK_INFORMATION",
  "OVERDUE_CONTAINMENT_CRITICALITY_UNRESOLVED",
  "REQUIRED_SEPARATE_ESCALATION_NOT_ADDRESSED",
] as const;

export type CapaContainmentRiskGateBlockerCode =
  (typeof CAPA_CONTAINMENT_RISK_GATE_BLOCKER_CODES)[number];

export const CAPA_CONTAINMENT_RISK_CANONICAL_BLOCKER_MAPPING = {
  MISSING_REQUIRED_CONTROLLED_DATA: "B-01",
  UNASSIGNED_CONTAINMENT: "B-01",
  UNRESOLVED_RISK_INFORMATION: "B-01",
  OVERDUE_CONTAINMENT_CRITICALITY_UNRESOLVED: "B-09",
  REQUIRED_SEPARATE_ESCALATION_NOT_ADDRESSED: "B-09",
} as const satisfies Record<
  CapaContainmentRiskGateBlockerCode,
  "B-01" | "B-09"
>;

export type CapaContainmentRiskGatePrerequisiteResult =
  | { readonly status: "prerequisites_met" }
  | {
      readonly status: "blocked";
      readonly blocker_codes:
        readonly CapaContainmentRiskGateBlockerCode[];
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
    new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) ===
      value
  );
}

function parsedNullableDate(
  value: unknown,
):
  | string
  | null
  | typeof INVALID {
  if (value === null) {
    return null;
  }

  return (
    typeof value === "string" &&
    isIsoDate(value)
  )
    ? value
    : INVALID;
}

function isActionType(
  value: unknown,
): value is CapaContainmentActionType {
  return (
    value === "correction" ||
    value === "containment"
  );
}

function isActionStatus(
  value: unknown,
): value is CapaContainmentActionStatus {
  return (
    value === "planned" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function parsedActions(
  value: unknown,
):
  | readonly CapaContainmentAction[]
  | "duplicate"
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result:
    CapaContainmentAction[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    if (
      !isPlainObject(item) ||
      !hasExactKeys(item, [
        "action_id",
        "action_type",
        "description",
        "owner_user_id",
        "action_date",
        "target_date",
        "completed_date",
        "status",
        "rationale",
        "supporting_evidence_references",
      ]) ||
      !isTrimmedText(item.action_id) ||
      !isActionType(item.action_type) ||
      !isTrimmedText(item.description) ||
      !isActionStatus(item.status) ||
      !isTrimmedText(item.rationale)
    ) {
      return INVALID;
    }

    if (ids.has(item.action_id)) {
      return "duplicate";
    }

    const ownerUserId =
      parsedNullableText(
        item.owner_user_id,
      );
    const actionDate =
      parsedNullableDate(
        item.action_date,
      );
    const targetDate =
      parsedNullableDate(
        item.target_date,
      );
    const completedDate =
      parsedNullableDate(
        item.completed_date,
      );
    const evidenceReferences =
      parsedTextArray(
        item
          .supporting_evidence_references,
      );

    if (
      ownerUserId === INVALID ||
      actionDate === INVALID ||
      targetDate === INVALID ||
      completedDate === INVALID ||
      evidenceReferences === INVALID
    ) {
      return INVALID;
    }

    if (
      item.status === "completed" &&
      completedDate === null
    ) {
      return INVALID;
    }

    ids.add(item.action_id);

    result.push(
      Object.freeze({
        action_id: item.action_id,
        action_type:
          item.action_type,
        description:
          item.description,
        owner_user_id:
          ownerUserId,
        action_date:
          actionDate,
        target_date:
          targetDate,
        completed_date:
          completedDate,
        status:
          item.status,
        rationale:
          item.rationale,
        supporting_evidence_references:
          evidenceReferences,
      }),
    );
  }

  return Object.freeze(result);
}

function parsedImpactScope(
  value: unknown,
):
  | CapaImpactScope
  | typeof INVALID {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "products",
      "processes",
      "data",
      "customers",
      "patients",
    ])
  ) {
    return INVALID;
  }

  const products =
    parsedTextArray(value.products);
  const processes =
    parsedTextArray(value.processes);
  const data =
    parsedTextArray(value.data);
  const customers =
    parsedTextArray(value.customers);
  const patients =
    parsedTextArray(value.patients);

  if (
    products === INVALID ||
    processes === INVALID ||
    data === INVALID ||
    customers === INVALID ||
    patients === INVALID
  ) {
    return INVALID;
  }

  return Object.freeze({
    products,
    processes,
    data,
    customers,
    patients,
  });
}

function parsedRiskEvaluation(
  value: unknown,
):
  | CapaRiskEvaluation
  | null
  | typeof INVALID {
  if (value === null) {
    return null;
  }

  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "method",
      "terminology_version",
      "result",
      "rationale",
    ]) ||
    !isTrimmedText(value.method) ||
    !isTrimmedText(value.result) ||
    !isTrimmedText(value.rationale)
  ) {
    return INVALID;
  }

  const terminologyVersion =
    parsedNullableText(
      value.terminology_version,
    );

  if (terminologyVersion === INVALID) {
    return INVALID;
  }

  return Object.freeze({
    method: value.method,
    terminology_version:
      terminologyVersion,
    result: value.result,
    rationale: value.rationale,
  });
}

function parsedEscalations(
  value: unknown,
):
  | readonly CapaRiskEscalation[]
  | typeof INVALID {
  if (!Array.isArray(value)) {
    return INVALID;
  }

  const result:
    CapaRiskEscalation[] = [];

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
      !isTrimmedText(item.status) ||
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

export function validateCapaContainmentRiskContent(
  value: unknown,
): CapaContainmentRiskValidationResult {
  if (!isPlainObject(value)) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_CONTAINMENT_RISK_OBJECT",
    };
  }

  if (
    !hasExactKeys(value, [
      "actions",
      "impact_scope",
      "risk_evaluation",
      "missing_risk_information",
      "escalations",
    ])
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_CONTAINMENT_RISK_FIELDS",
    };
  }

  const actions =
    parsedActions(value.actions);

  if (actions === "duplicate") {
    return {
      status: "invalid",
      reason_code:
        "DUPLICATE_CONTAINMENT_ACTION_ID",
    };
  }

  if (actions === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_CONTAINMENT_ACTIONS",
    };
  }

  const impactScope =
    parsedImpactScope(
      value.impact_scope,
    );

  if (impactScope === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_IMPACT_SCOPE",
    };
  }

  const riskEvaluation =
    parsedRiskEvaluation(
      value.risk_evaluation,
    );

  if (riskEvaluation === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_RISK_EVALUATION",
    };
  }

  const missingRiskInformation =
    parsedTextArray(
      value.missing_risk_information,
    );

  if (
    missingRiskInformation === INVALID
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_MISSING_RISK_INFORMATION",
    };
  }

  const escalations =
    parsedEscalations(
      value.escalations,
    );

  if (escalations === INVALID) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_RISK_ESCALATIONS",
    };
  }

  return {
    status: "valid",
    value: Object.freeze({
      actions,
      impact_scope: impactScope,
      risk_evaluation:
        riskEvaluation,
      missing_risk_information:
        missingRiskInformation,
      escalations,
    }),
  };
}

function hasRecordedImpactScope(
  impactScope: CapaImpactScope,
): boolean {
  return (
    impactScope.products.length > 0 ||
    impactScope.processes.length > 0 ||
    impactScope.data.length > 0 ||
    impactScope.customers.length > 0 ||
    impactScope.patients.length > 0
  );
}

function isAddressedEscalationStatus(
  status: string,
): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "addressed" ||
    normalized === "resolved" ||
    normalized === "closed" ||
    normalized === "completed" ||
    normalized === "not_required"
  );
}

/**
 * Evaluates objective G-02 prerequisites without making the substantive
 * human risk-acceptance decision.
 *
 * The current controlled schema does not carry action criticality or an
 * approved-exception record. An overdue active containment therefore blocks
 * conservatively while reporting that criticality is unresolved; it is not
 * represented as known critical. Blocker overrides remain out of scope under
 * SRS-TBD-007.
 */
export function evaluateCapaContainmentRiskGatePrerequisites(
  content: CapaContainmentRiskContent,
  trustedReviewDate: string,
): CapaContainmentRiskGatePrerequisiteResult {
  if (!isIsoDate(trustedReviewDate)) {
    throw new TypeError(
      "trustedReviewDate must be a valid ISO calendar date.",
    );
  }

  const blockers: CapaContainmentRiskGateBlockerCode[] = [];
  const activeContainment = content.actions.filter(
    (action) =>
      action.action_type === "containment" &&
      action.status !== "cancelled",
  );

  if (
    content.risk_evaluation === null ||
    !hasRecordedImpactScope(content.impact_scope)
  ) {
    blockers.push("MISSING_REQUIRED_CONTROLLED_DATA");
  }

  if (
    activeContainment.some(
      (action) => action.owner_user_id === null,
    )
  ) {
    blockers.push("UNASSIGNED_CONTAINMENT");
  }

  if (content.missing_risk_information.length > 0) {
    blockers.push("UNRESOLVED_RISK_INFORMATION");
  }

  if (
    activeContainment.some(
      (action) =>
        action.status !== "completed" &&
        action.target_date !== null &&
        action.target_date < trustedReviewDate,
    )
  ) {
    blockers.push(
      "OVERDUE_CONTAINMENT_CRITICALITY_UNRESOLVED",
    );
  }

  if (
    content.escalations.some(
      (escalation) =>
        !isAddressedEscalationStatus(escalation.status),
    )
  ) {
    blockers.push(
      "REQUIRED_SEPARATE_ESCALATION_NOT_ADDRESSED",
    );
  }

  return blockers.length === 0
    ? { status: "prerequisites_met" }
    : {
        status: "blocked",
        blocker_codes: Object.freeze(blockers),
      };
}
