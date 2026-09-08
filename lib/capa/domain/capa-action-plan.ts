/** Controlled S60 action-plan contract and objective S60 readiness checks. */

export const CAPA_ACTION_PLAN_SECTION_TYPE =
  "CAPA.ACTION_PLAN" as const;

export const CAPA_ACTION_PLAN_SCHEMA_VERSION =
  "capa-action-plan-1.0.0" as const;

export const CAPA_ACTION_TYPES = [
  "corrective",
  "preventive",
  "correction",
  "containment",
] as const;

export type CapaActionType =
  (typeof CAPA_ACTION_TYPES)[number];

export const CAPA_ACTION_STATUSES = [
  "planned",
  "approved",
  "in_progress",
  "implemented",
  "verified",
  "cancelled",
  "overdue",
] as const;

export type CapaActionStatus =
  (typeof CAPA_ACTION_STATUSES)[number];

export const CAPA_ACTION_LINK_TARGET_TYPES = [
  "cause",
  "contributing_factor",
  "risk",
  "gap",
] as const;

export type CapaActionLinkTargetType =
  (typeof CAPA_ACTION_LINK_TARGET_TYPES)[number];

export interface CapaActionPlanDraftProvenance {
  readonly source_type:
    | "human"
    | "ai_proposal";
  readonly source_reference:
    string | null;
  readonly adopted_by_user_id:
    string | null;
  readonly adopted_at:
    string | null;
}

export interface CapaActionLink {
  readonly target_type:
    CapaActionLinkTargetType;
  readonly target_id: string;
  readonly rationale: string;
}

export type CapaActionPlanActionLink = CapaActionLink;

export interface CapaActionPlanItem {
  readonly item_id: string;
  readonly action_type: string | null;
  readonly description: string | null;
  readonly linked_targets: readonly CapaActionLink[];
  readonly owner_user_id: string | null;
  readonly due_date: string | null;
  readonly status: CapaActionStatus;
  readonly deliverable: string | null;
  readonly implementation_evidence: string | null;
  readonly dependency_item_ids: readonly string[];
  readonly unintended_consequence_assessment: string | null;
  readonly effectiveness_check_required: boolean;
  readonly draft_provenance: CapaActionPlanDraftProvenance;
}

export interface CapaActionPlanEffectivenessCheck {
  readonly check_id: string;
  readonly action_item_ids: readonly string[];
  readonly acceptance_criteria: string | null;
  readonly evaluation_method: string | null;
  readonly data_source: string | null;
  readonly timing: string | null;
  readonly responsible_role: string | null;
  readonly sample_or_rationale: string | null;
  readonly draft_provenance: CapaActionPlanDraftProvenance;
}

export interface CapaActionPlanContent {
  readonly items: readonly CapaActionPlanItem[];
  readonly effectiveness_checks:
    readonly CapaActionPlanEffectivenessCheck[];
}

export const CAPA_ACTION_PLAN_VALIDATION_REASON_CODES = [
  "INVALID_ACTION_PLAN_OBJECT",
  "INVALID_ACTION_PLAN_FIELDS",
  "INVALID_ACTION_PLAN_ITEMS",
  "INVALID_ACTION_PLAN_EFFECTIVENESS_CHECKS",
  "DUPLICATE_ACTION_ITEM_ID",
  "INVALID_ACTION_ITEM",
  "INVALID_ACTION_TYPE",
  "INVALID_ACTION_LINK",
  "DUPLICATE_ACTION_LINK",
  "INVALID_ACTION_OWNER",
  "INVALID_ACTION_DUE_DATE",
  "INVALID_ACTION_STATUS",
  "INVALID_ACTION_DEPENDENCIES",
  "DUPLICATE_ACTION_DEPENDENCY",
  "INVALID_ACTION_PROVENANCE",
  "DUPLICATE_EFFECTIVENESS_CHECK_ID",
  "INVALID_EFFECTIVENESS_CHECK",
  "INVALID_EFFECTIVENESS_ACTION_REFERENCES",
  "DUPLICATE_EFFECTIVENESS_ACTION_REFERENCE",
  "INVALID_EFFECTIVENESS_PROVENANCE",
] as const;

export type CapaActionPlanValidationReasonCode =
  (typeof CAPA_ACTION_PLAN_VALIDATION_REASON_CODES)[number];

export type CapaActionPlanValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaActionPlanContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        CapaActionPlanValidationReasonCode;
    };

export const CAPA_ACTION_PLAN_READINESS_BLOCKER_CODES = [
  "EMPTY_ACTION_PLAN",
  "UNLINKED_ACTION",
  "MISSING_ACTION_TYPE",
  "MISSING_ACTION_DESCRIPTION",
  "UNASSIGNED_ACTION",
  "MISSING_ACTION_DUE_DATE",
  "MISSING_ACTION_DELIVERABLE",
  "MISSING_IMPLEMENTATION_EVIDENCE",
  "MISSING_UNINTENDED_CONSEQUENCE_ASSESSMENT",
  "MISSING_DEPENDENCY_TARGET",
  "SELF_DEPENDENCY",
  "DEPENDENCY_CYCLE",
  "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
  "MISSING_REQUIRED_EFFECTIVENESS_CHECK",
  "MISSING_EFFECTIVENESS_ACCEPTANCE_CRITERIA",
  "INVALID_EFFECTIVENESS_ACTION_REFERENCE",
] as const;

export type CapaActionPlanReadinessBlockerCode =
  (typeof CAPA_ACTION_PLAN_READINESS_BLOCKER_CODES)[number];

export type CapaActionPlanReadinessResult =
  | { readonly status: "ready_for_review" }
  | {
      readonly status: "blocked";
      readonly blocker_codes:
        readonly CapaActionPlanReadinessBlockerCode[];
    };

const INVALID = Symbol("INVALID");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

const ACTION_ITEM_KEYS = [
  "item_id",
  "action_type",
  "description",
  "linked_targets",
  "owner_user_id",
  "due_date",
  "status",
  "deliverable",
  "implementation_evidence",
  "dependency_item_ids",
  "unintended_consequence_assessment",
  "effectiveness_check_required",
  "draft_provenance",
] as const;

const ACTION_LINK_KEYS = [
  "target_type",
  "target_id",
  "rationale",
] as const;

const EFFECTIVENESS_CHECK_KEYS = [
  "check_id",
  "action_item_ids",
  "acceptance_criteria",
  "evaluation_method",
  "data_source",
  "timing",
  "responsible_role",
  "sample_or_rationale",
  "draft_provenance",
] as const;

const PROVENANCE_KEYS = [
  "source_type",
  "source_reference",
  "adopted_by_user_id",
  "adopted_at",
] as const;

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
}

function isText(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value;
}

function nullableText(
  value: unknown,
): string | null | typeof INVALID {
  return value === null
    ? null
    : isText(value)
      ? value
      : INVALID;
}

function nullableControlledCode(
  value: unknown,
): string | null | typeof INVALID {
  const parsed = nullableText(value);
  return parsed === null || parsed === INVALID
    ? parsed
    : parsed.length <= 64 && CONTROLLED_CODE_PATTERN.test(parsed)
      ? parsed
      : INVALID;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    UUID_PATTERN.test(value);
}

function nullableUuid(
  value: unknown,
): string | null | typeof INVALID {
  return value === null
    ? null
    : isUuid(value)
      ? value
      : INVALID;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function nullableDate(
  value: unknown,
): string | null | typeof INVALID {
  return value === null
    ? null
    : typeof value === "string" && isIsoDate(value)
      ? value
      : INVALID;
}

function isActionStatus(
  value: unknown,
): value is CapaActionStatus {
  return typeof value === "string" &&
    CAPA_ACTION_STATUSES.includes(value as CapaActionStatus);
}

function isTargetType(
  value: unknown,
): value is CapaActionLinkTargetType {
  return typeof value === "string" &&
    CAPA_ACTION_LINK_TARGET_TYPES.includes(value as CapaActionLinkTargetType);
}

function uniqueTextArray(
  value: unknown,
): readonly string[] | "duplicate" | typeof INVALID {
  if (!Array.isArray(value)) return INVALID;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isText(item)) return INVALID;
    if (seen.has(item)) return "duplicate";
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function parseProvenance(
  value: unknown,
): CapaActionPlanDraftProvenance | typeof INVALID {
  if (!isPlainObject(value) || !hasExactKeys(value, PROVENANCE_KEYS)) {
    return INVALID;
  }

  if (value.source_type !== "human" &&
    value.source_type !== "ai_proposal") {
    return INVALID;
  }

  const sourceReference = nullableText(value.source_reference);
  const adoptedBy = nullableUuid(value.adopted_by_user_id);
  const adoptedAt = nullableText(value.adopted_at);

  if (
    sourceReference === INVALID ||
    adoptedBy === INVALID ||
    adoptedAt === INVALID ||
    (adoptedAt !== null && !isIsoDateTime(adoptedAt)) ||
    ((adoptedBy === null) !== (adoptedAt === null)) ||
    (value.source_type === "human" &&
      (adoptedBy !== null || adoptedAt !== null))
  ) {
    return INVALID;
  }

  return Object.freeze({
    source_type: value.source_type,
    source_reference: sourceReference,
    adopted_by_user_id: adoptedBy,
    adopted_at: adoptedAt,
  });
}

function parseActionLink(
  value: unknown,
): CapaActionLink | typeof INVALID {
  if (!isPlainObject(value) || !hasExactKeys(value, ACTION_LINK_KEYS)) {
    return INVALID;
  }

  if (!isTargetType(value.target_type) ||
    !isText(value.target_id) ||
    !isText(value.rationale)) {
    return INVALID;
  }

  return Object.freeze({
    target_type: value.target_type,
    target_id: value.target_id,
    rationale: value.rationale,
  });
}

function parseActionLinks(
  value: unknown,
): readonly CapaActionLink[] | "duplicate" | typeof INVALID {
  if (!Array.isArray(value)) return INVALID;
  const result: CapaActionLink[] = [];
  const seen = new Set<string>();

  for (const source of value) {
    const link = parseActionLink(source);
    if (link === INVALID) return INVALID;
    const identity = `${link.target_type}:${link.target_id}`;
    if (seen.has(identity)) return "duplicate";
    seen.add(identity);
    result.push(link);
  }

  return Object.freeze(result);
}

function invalid(
  reason_code: CapaActionPlanValidationReasonCode,
): CapaActionPlanValidationResult {
  return Object.freeze({ status: "invalid", reason_code });
}

export function validateCapaActionPlan(
  value: unknown,
): CapaActionPlanValidationResult {
  if (!isPlainObject(value)) {
    return invalid("INVALID_ACTION_PLAN_OBJECT");
  }
  if (!hasExactKeys(value, ["items", "effectiveness_checks"])) {
    return invalid("INVALID_ACTION_PLAN_FIELDS");
  }
  if (!Array.isArray(value.items)) {
    return invalid("INVALID_ACTION_PLAN_ITEMS");
  }
  if (!Array.isArray(value.effectiveness_checks)) {
    return invalid("INVALID_ACTION_PLAN_EFFECTIVENESS_CHECKS");
  }

  const items: CapaActionPlanItem[] = [];
  const itemIds = new Set<string>();

  for (const source of value.items) {
    if (!isPlainObject(source) ||
      !hasExactKeys(source, ACTION_ITEM_KEYS) ||
      !isText(source.item_id) ||
      typeof source.effectiveness_check_required !== "boolean") {
      return invalid("INVALID_ACTION_ITEM");
    }
    if (!isActionStatus(source.status)) {
      return invalid("INVALID_ACTION_STATUS");
    }
    if (itemIds.has(source.item_id)) {
      return invalid("DUPLICATE_ACTION_ITEM_ID");
    }

    const actionType = nullableControlledCode(source.action_type);
    const description = nullableText(source.description);
    const links = parseActionLinks(source.linked_targets);
    const owner = nullableUuid(source.owner_user_id);
    const dueDate = nullableDate(source.due_date);
    const deliverable = nullableText(source.deliverable);
    const implementationEvidence =
      nullableText(source.implementation_evidence);
    const dependencies = uniqueTextArray(source.dependency_item_ids);
    const unintendedAssessment =
      nullableText(source.unintended_consequence_assessment);
    const provenance = parseProvenance(source.draft_provenance);

    if (actionType === INVALID) {
      return invalid("INVALID_ACTION_TYPE");
    }
    if (description === INVALID ||
      deliverable === INVALID ||
      implementationEvidence === INVALID ||
      unintendedAssessment === INVALID) {
      return invalid("INVALID_ACTION_ITEM");
    }
    if (links === INVALID) {
      return invalid("INVALID_ACTION_LINK");
    }
    if (links === "duplicate") {
      return invalid("DUPLICATE_ACTION_LINK");
    }
    if (owner === INVALID) {
      return invalid("INVALID_ACTION_OWNER");
    }
    if (dueDate === INVALID) {
      return invalid("INVALID_ACTION_DUE_DATE");
    }
    if (dependencies === INVALID) {
      return invalid("INVALID_ACTION_DEPENDENCIES");
    }
    if (dependencies === "duplicate") {
      return invalid("DUPLICATE_ACTION_DEPENDENCY");
    }
    if (provenance === INVALID) {
      return invalid("INVALID_ACTION_PROVENANCE");
    }

    itemIds.add(source.item_id);
    items.push(Object.freeze({
      item_id: source.item_id,
      action_type: actionType,
      description,
      linked_targets: links,
      owner_user_id: owner,
      due_date: dueDate,
      status: source.status,
      deliverable,
      implementation_evidence: implementationEvidence,
      dependency_item_ids: dependencies,
      unintended_consequence_assessment: unintendedAssessment,
      effectiveness_check_required:
        source.effectiveness_check_required,
      draft_provenance: provenance,
    }));
  }

  const effectivenessChecks: CapaActionPlanEffectivenessCheck[] = [];
  const checkIds = new Set<string>();

  for (const source of value.effectiveness_checks) {
    if (!isPlainObject(source) ||
      !hasExactKeys(source, EFFECTIVENESS_CHECK_KEYS) ||
      !isText(source.check_id)) {
      return invalid("INVALID_EFFECTIVENESS_CHECK");
    }
    if (checkIds.has(source.check_id)) {
      return invalid("DUPLICATE_EFFECTIVENESS_CHECK_ID");
    }

    const actionIds = uniqueTextArray(source.action_item_ids);
    const acceptanceCriteria = nullableText(source.acceptance_criteria);
    const evaluationMethod = nullableText(source.evaluation_method);
    const dataSource = nullableText(source.data_source);
    const timing = nullableText(source.timing);
    const responsibleRole = nullableText(source.responsible_role);
    const sampleOrRationale = nullableText(source.sample_or_rationale);
    const provenance = parseProvenance(source.draft_provenance);

    if (actionIds === INVALID || actionIds === "duplicate") {
      return invalid(actionIds === "duplicate"
        ? "DUPLICATE_EFFECTIVENESS_ACTION_REFERENCE"
        : "INVALID_EFFECTIVENESS_ACTION_REFERENCES");
    }
    if (actionIds.length === 0 ||
      acceptanceCriteria === INVALID ||
      evaluationMethod === INVALID ||
      dataSource === INVALID ||
      timing === INVALID ||
      responsibleRole === INVALID ||
      sampleOrRationale === INVALID) {
      return invalid("INVALID_EFFECTIVENESS_CHECK");
    }
    if (provenance === INVALID) {
      return invalid("INVALID_EFFECTIVENESS_PROVENANCE");
    }

    if (actionIds.some((id) => !itemIds.has(id))) {
      return invalid("INVALID_EFFECTIVENESS_ACTION_REFERENCES");
    }

    checkIds.add(source.check_id);
    effectivenessChecks.push(Object.freeze({
      check_id: source.check_id,
      action_item_ids: actionIds,
      acceptance_criteria: acceptanceCriteria,
      evaluation_method: evaluationMethod,
      data_source: dataSource,
      timing,
      responsible_role: responsibleRole,
      sample_or_rationale: sampleOrRationale,
      draft_provenance: provenance,
    }));
  }

  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      items: Object.freeze(items),
      effectiveness_checks: Object.freeze(effectivenessChecks),
    }),
  });
}

function dependencyCycleExists(
  items: readonly CapaActionPlanItem[],
): boolean {
  const dependencies = new Map(
    items.map((item) => [item.item_id, item.dependency_item_ids] as const),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(itemId: string): boolean {
    if (visiting.has(itemId)) return true;
    if (visited.has(itemId)) return false;
    visiting.add(itemId);
    for (const dependency of dependencies.get(itemId) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(itemId);
    visited.add(itemId);
    return false;
  }

  return items.some((item) => visit(item.item_id));
}

/** Objective S60 prerequisites only; this does not approve or advance a CAPA. */
export function evaluateCapaActionPlanReadiness(
  plan: CapaActionPlanContent,
): CapaActionPlanReadinessResult {
  const blockers = new Set<CapaActionPlanReadinessBlockerCode>();
  const itemIds = new Set(plan.items.map((item) => item.item_id));

  if (plan.items.length === 0) {
    blockers.add("EMPTY_ACTION_PLAN");
  }

  for (const item of plan.items) {
    if (item.linked_targets.length === 0) blockers.add("UNLINKED_ACTION");
    if (item.action_type === null) blockers.add("MISSING_ACTION_TYPE");
    if (item.description === null) blockers.add("MISSING_ACTION_DESCRIPTION");
    if (item.owner_user_id === null) blockers.add("UNASSIGNED_ACTION");
    if (item.due_date === null) blockers.add("MISSING_ACTION_DUE_DATE");
    if (item.deliverable === null) blockers.add("MISSING_ACTION_DELIVERABLE");
    if (item.implementation_evidence === null) {
      blockers.add("MISSING_IMPLEMENTATION_EVIDENCE");
    }
    if (item.unintended_consequence_assessment === null) {
      blockers.add("MISSING_UNINTENDED_CONSEQUENCE_ASSESSMENT");
    }
    if (item.dependency_item_ids.some((id) => !itemIds.has(id))) {
      blockers.add("MISSING_DEPENDENCY_TARGET");
    }
    if (item.dependency_item_ids.includes(item.item_id)) {
      blockers.add("SELF_DEPENDENCY");
    }
    if (
      item.draft_provenance.source_type === "ai_proposal" &&
      item.draft_provenance.adopted_by_user_id === null
    ) {
      blockers.add("AI_PROPOSAL_NOT_HUMAN_ADOPTED");
    }
  }

  if (dependencyCycleExists(plan.items)) {
    blockers.add("DEPENDENCY_CYCLE");
  }

  const coveredActionIds = new Set<string>();
  for (const check of plan.effectiveness_checks) {
    for (const actionId of check.action_item_ids) {
      if (!itemIds.has(actionId)) {
        blockers.add("INVALID_EFFECTIVENESS_ACTION_REFERENCE");
      } else {
        coveredActionIds.add(actionId);
      }
    }
    if (
      check.action_item_ids.some((actionId) =>
        itemIds.has(actionId) &&
        plan.items.find((item) => item.item_id === actionId)
          ?.effectiveness_check_required === true,
      ) &&
      check.acceptance_criteria === null
    ) {
      blockers.add("MISSING_EFFECTIVENESS_ACCEPTANCE_CRITERIA");
    }
    if (
      check.draft_provenance.source_type === "ai_proposal" &&
      check.draft_provenance.adopted_by_user_id === null
    ) {
      blockers.add("AI_PROPOSAL_NOT_HUMAN_ADOPTED");
    }
  }

  if (plan.items.some((item) =>
    item.effectiveness_check_required && !coveredActionIds.has(item.item_id),
  )) {
    blockers.add("MISSING_REQUIRED_EFFECTIVENESS_CHECK");
  }

  const orderedBlockers = CAPA_ACTION_PLAN_READINESS_BLOCKER_CODES.filter(
    (code) => blockers.has(code),
  );

  return orderedBlockers.length === 0
    ? Object.freeze({ status: "ready_for_review" })
    : Object.freeze({
        status: "blocked",
        blocker_codes: Object.freeze(orderedBlockers),
      });
}
