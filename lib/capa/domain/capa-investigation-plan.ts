/**
 * Controlled S30 CAPA investigation-plan contract and pilot G-03 readiness.
 *
 * Structural validity does not establish workflow readiness. Only an
 * authorized human Investigator may release a plan through a separately
 * authorized application service. AI provenance never carries release or
 * disposition authority.
 */

export const CAPA_INVESTIGATION_PLAN_SECTION_TYPE =
  "CAPA.INVESTIGATION_PLAN" as const;

export const CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION =
  "capa-investigation-plan-1.0.0" as const;

export const CAPA_INVESTIGATION_PLAN_ITEM_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "dispositioned",
  "cancelled",
] as const;

export type CapaInvestigationPlanItemStatus =
  (typeof CAPA_INVESTIGATION_PLAN_ITEM_STATUSES)[number];

export interface CapaInvestigationPlanDraftProvenance {
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

export interface CapaInvestigationPlanItem {
  readonly item_id: string;
  readonly investigation_question:
    string | null;
  readonly evidence_target:
    string | null;
  readonly investigation_method:
    string | null;
  readonly owner_user_id:
    string | null;
  readonly due_date:
    string | null;
  readonly sme_user_ids:
    readonly string[];
  readonly dependency_item_ids:
    readonly string[];
  readonly scope_relationship:
    string | null;
  readonly status:
    CapaInvestigationPlanItemStatus;
  readonly disposition:
    string | null;
  readonly disposition_rationale:
    string | null;
  readonly draft_provenance:
    CapaInvestigationPlanDraftProvenance;
}

export interface CapaInvestigationPlanContent {
  readonly items:
    readonly CapaInvestigationPlanItem[];
}

export const CAPA_INVESTIGATION_PLAN_VALIDATION_REASON_CODES = [
  "INVALID_INVESTIGATION_PLAN_OBJECT",
  "INVALID_INVESTIGATION_PLAN_FIELDS",
  "INVALID_INVESTIGATION_PLAN_ITEMS",
  "DUPLICATE_INVESTIGATION_PLAN_ITEM_ID",
  "INVALID_INVESTIGATION_PLAN_ITEM",
  "INVALID_PLAN_ITEM_OWNER",
  "INVALID_PLAN_ITEM_DUE_DATE",
  "INVALID_PLAN_ITEM_SME_REFERENCES",
  "DUPLICATE_PLAN_ITEM_SME_REFERENCE",
  "INVALID_PLAN_ITEM_DEPENDENCIES",
  "DUPLICATE_PLAN_ITEM_DEPENDENCY",
  "INVALID_PLAN_ITEM_STATUS_DISPOSITION",
  "INVALID_PLAN_ITEM_PROVENANCE",
] as const;

export type CapaInvestigationPlanValidationReasonCode =
  (typeof CAPA_INVESTIGATION_PLAN_VALIDATION_REASON_CODES)[number];

export type CapaInvestigationPlanValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaInvestigationPlanContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        CapaInvestigationPlanValidationReasonCode;
    };

export const CAPA_INVESTIGATION_PLAN_GATE_BLOCKER_CODES = [
  "EMPTY_INVESTIGATION_PLAN",
  "MISSING_INVESTIGATION_QUESTION",
  "MISSING_EVIDENCE_TARGET",
  "MISSING_INVESTIGATION_METHOD",
  "UNASSIGNED_INVESTIGATION_PLAN_ITEM",
  "MISSING_INVESTIGATION_DUE_DATE",
  "MISSING_SCOPE_RELATIONSHIP",
  "MISSING_DEPENDENCY_TARGET",
  "SELF_DEPENDENCY",
  "DEPENDENCY_CYCLE",
  "INVESTIGATION_EXECUTION_ALREADY_STARTED",
  "INVESTIGATION_EXECUTION_COMPLETED_BEFORE_RELEASE",
  "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
] as const;

export type CapaInvestigationPlanGateBlockerCode =
  (typeof CAPA_INVESTIGATION_PLAN_GATE_BLOCKER_CODES)[number];

export const CAPA_INVESTIGATION_PLAN_CANONICAL_BLOCKER_MAPPING = {
  EMPTY_INVESTIGATION_PLAN: "B-01",
  MISSING_INVESTIGATION_QUESTION: "B-01",
  MISSING_EVIDENCE_TARGET: "B-01",
  MISSING_INVESTIGATION_METHOD: "B-01",
  UNASSIGNED_INVESTIGATION_PLAN_ITEM: "B-01",
  MISSING_INVESTIGATION_DUE_DATE: "B-01",
  MISSING_SCOPE_RELATIONSHIP: "B-01",
  MISSING_DEPENDENCY_TARGET: "B-01",
} as const satisfies Partial<Record<
  CapaInvestigationPlanGateBlockerCode,
  "B-01"
>>;

export type CapaInvestigationPlanGateReadinessResult =
  | {
      readonly status: "ready_for_release";
    }
  | {
      readonly status: "blocked";
      readonly blocker_codes:
        readonly CapaInvestigationPlanGateBlockerCode[];
    };

const INVALID = Symbol("INVALID");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

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
  return typeof value === "string" && UUID_PATTERN.test(value);
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

function uniqueUuidArray(
  value: unknown,
): readonly string[] | "duplicate" | typeof INVALID {
  if (!Array.isArray(value)) return INVALID;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isUuid(item)) return INVALID;
    if (seen.has(item)) return "duplicate";
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function uniqueItemIdArray(
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

function isItemStatus(
  value: unknown,
): value is CapaInvestigationPlanItemStatus {
  return value === "planned" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "dispositioned" ||
    value === "cancelled";
}

function parseProvenance(
  value: unknown,
): CapaInvestigationPlanDraftProvenance | typeof INVALID {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "source_type",
    "source_reference",
    "adopted_by_user_id",
    "adopted_at",
  ])) return INVALID;

  if (value.source_type !== "human" && value.source_type !== "ai_proposal") {
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
  ) return INVALID;

  return Object.freeze({
    source_type: value.source_type,
    source_reference: sourceReference,
    adopted_by_user_id: adoptedBy,
    adopted_at: adoptedAt,
  });
}

function invalid(
  reason_code: CapaInvestigationPlanValidationReasonCode,
): CapaInvestigationPlanValidationResult {
  return { status: "invalid", reason_code };
}

export function validateCapaInvestigationPlan(
  value: unknown,
): CapaInvestigationPlanValidationResult {
  if (!isPlainObject(value)) {
    return invalid("INVALID_INVESTIGATION_PLAN_OBJECT");
  }
  if (!hasExactKeys(value, ["items"])) {
    return invalid("INVALID_INVESTIGATION_PLAN_FIELDS");
  }
  if (!Array.isArray(value.items)) {
    return invalid("INVALID_INVESTIGATION_PLAN_ITEMS");
  }

  const items: CapaInvestigationPlanItem[] = [];
  const ids = new Set<string>();
  for (const source of value.items) {
    if (!isPlainObject(source) || !hasExactKeys(source, [
      "item_id",
      "investigation_question",
      "evidence_target",
      "investigation_method",
      "owner_user_id",
      "due_date",
      "sme_user_ids",
      "dependency_item_ids",
      "scope_relationship",
      "status",
      "disposition",
      "disposition_rationale",
      "draft_provenance",
    ]) || !isText(source.item_id) || !isItemStatus(source.status)) {
      return invalid("INVALID_INVESTIGATION_PLAN_ITEM");
    }
    if (ids.has(source.item_id)) {
      return invalid("DUPLICATE_INVESTIGATION_PLAN_ITEM_ID");
    }

    const question = nullableText(source.investigation_question);
    const target = nullableText(source.evidence_target);
    const method = nullableText(source.investigation_method);
    const owner = nullableUuid(source.owner_user_id);
    const dueDate = nullableDate(source.due_date);
    const scope = nullableText(source.scope_relationship);
    const disposition = nullableControlledCode(source.disposition);
    const rationale = nullableText(source.disposition_rationale);
    const smes = uniqueUuidArray(source.sme_user_ids);
    const dependencies = uniqueItemIdArray(source.dependency_item_ids);
    const provenance = parseProvenance(source.draft_provenance);

    if (question === INVALID || target === INVALID || method === INVALID ||
      scope === INVALID) return invalid("INVALID_INVESTIGATION_PLAN_ITEM");
    if (owner === INVALID) return invalid("INVALID_PLAN_ITEM_OWNER");
    if (dueDate === INVALID) return invalid("INVALID_PLAN_ITEM_DUE_DATE");
    if (smes === INVALID) return invalid("INVALID_PLAN_ITEM_SME_REFERENCES");
    if (smes === "duplicate") return invalid("DUPLICATE_PLAN_ITEM_SME_REFERENCE");
    if (dependencies === INVALID) return invalid("INVALID_PLAN_ITEM_DEPENDENCIES");
    if (dependencies === "duplicate") return invalid("DUPLICATE_PLAN_ITEM_DEPENDENCY");
    if (disposition === INVALID || rationale === INVALID) {
      return invalid("INVALID_PLAN_ITEM_STATUS_DISPOSITION");
    }
    const requiresDisposition =
      source.status === "dispositioned" || source.status === "cancelled";
    if (
      requiresDisposition !== (disposition !== null && rationale !== null)
    ) return invalid("INVALID_PLAN_ITEM_STATUS_DISPOSITION");
    if (provenance === INVALID) return invalid("INVALID_PLAN_ITEM_PROVENANCE");

    ids.add(source.item_id);
    items.push(Object.freeze({
      item_id: source.item_id,
      investigation_question: question,
      evidence_target: target,
      investigation_method: method,
      owner_user_id: owner,
      due_date: dueDate,
      sme_user_ids: smes,
      dependency_item_ids: dependencies,
      scope_relationship: scope,
      status: source.status,
      disposition,
      disposition_rationale: rationale,
      draft_provenance: provenance,
    }));
  }

  return {
    status: "valid",
    value: Object.freeze({ items: Object.freeze(items) }),
  };
}

function dependencyCycleExists(
  items: readonly CapaInvestigationPlanItem[],
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

/**
 * Evaluates objective pilot G-03 prerequisites only. It cannot authorize or
 * release the plan and deliberately exposes no override input.
 */
export function evaluateCapaInvestigationPlanGateReadiness(
  plan: CapaInvestigationPlanContent,
): CapaInvestigationPlanGateReadinessResult {
  const blockers: CapaInvestigationPlanGateBlockerCode[] = [];
  const add = (code: CapaInvestigationPlanGateBlockerCode) => {
    if (!blockers.includes(code)) blockers.push(code);
  };

  if (plan.items.length === 0) add("EMPTY_INVESTIGATION_PLAN");
  const ids = new Set(plan.items.map((item) => item.item_id));

  for (const item of plan.items) {
    if (item.investigation_question === null) add("MISSING_INVESTIGATION_QUESTION");
    if (item.evidence_target === null) add("MISSING_EVIDENCE_TARGET");
    if (item.investigation_method === null) add("MISSING_INVESTIGATION_METHOD");
    if (item.owner_user_id === null) add("UNASSIGNED_INVESTIGATION_PLAN_ITEM");
    if (item.due_date === null) add("MISSING_INVESTIGATION_DUE_DATE");
    if (item.scope_relationship === null) add("MISSING_SCOPE_RELATIONSHIP");
    if (item.dependency_item_ids.some((id) => !ids.has(id))) {
      add("MISSING_DEPENDENCY_TARGET");
    }
    if (item.dependency_item_ids.includes(item.item_id)) add("SELF_DEPENDENCY");
    if (item.status === "in_progress") {
      add("INVESTIGATION_EXECUTION_ALREADY_STARTED");
    }
    if (item.status === "completed") {
      add("INVESTIGATION_EXECUTION_COMPLETED_BEFORE_RELEASE");
    }
    if (
      item.draft_provenance.source_type === "ai_proposal" &&
      item.draft_provenance.adopted_by_user_id === null
    ) add("AI_PROPOSAL_NOT_HUMAN_ADOPTED");
  }

  if (dependencyCycleExists(plan.items)) add("DEPENDENCY_CYCLE");

  return blockers.length === 0
    ? { status: "ready_for_release" }
    : { status: "blocked", blocker_codes: Object.freeze(blockers) };
}
