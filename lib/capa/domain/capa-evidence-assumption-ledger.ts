/**
 * Controlled evidence/assumption ledger domain contract.
 * Trace: URS-EVD-001..015, SRS-EVD-001..010.
 * Validation records information; it never verifies evidence or resolves a
 * human decision autonomously.
 */

export const CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE =
  "CAPA.EVIDENCE_ASSUMPTION_LEDGER" as const;
export const CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION =
  "capa-evidence-assumption-ledger-1.0.0" as const;

export const CAPA_LEDGER_INFORMATION_CLASSES = [
  "verified_evidence",
  "user_provided_statement",
  "ai_generated_hypothesis",
  "assumption",
  "missing_information",
  "conflicting_information",
  "retrieved_reference",
  "ai_recommendation",
] as const;
export type CapaLedgerInformationClass =
  (typeof CAPA_LEDGER_INFORMATION_CLASSES)[number];

export const CAPA_EVIDENCE_STATUSES = [
  "current",
  "verified",
  "rejected",
  "superseded",
  "unavailable",
] as const;
export type CapaEvidenceStatus = (typeof CAPA_EVIDENCE_STATUSES)[number];
export const CAPA_ASSUMPTION_STATUSES = [
  "open",
  "resolved",
  "supported",
  "disproven",
  "no_longer_relevant",
] as const;
export type CapaAssumptionStatus = (typeof CAPA_ASSUMPTION_STATUSES)[number];
export const CAPA_GAP_STATUSES = ["open", "resolved"] as const;
export type CapaGapStatus = (typeof CAPA_GAP_STATUSES)[number];
export const CAPA_CONFLICT_STATUSES = ["open", "resolved"] as const;
export type CapaConflictStatus = (typeof CAPA_CONFLICT_STATUSES)[number];
export const CAPA_LEDGER_PROVENANCE_TYPES = [
  "human",
  "ai_proposal",
  "retrieved_reference",
] as const;
export type CapaLedgerProvenanceType =
  (typeof CAPA_LEDGER_PROVENANCE_TYPES)[number];

export interface CapaLedgerHumanDisposition {
  readonly user_id: string;
  readonly disposition_at: string;
  readonly rationale: string;
}
export interface CapaLedgerProvenance {
  readonly source_type: CapaLedgerProvenanceType;
  readonly source_reference: string | null;
  readonly adopted_by_user_id: string | null;
  readonly adopted_at: string | null;
}
export interface CapaEvidenceAssumptionLedgerItem {
  readonly item_id: string;
  readonly information_class: CapaLedgerInformationClass;
  readonly statement: string;
  readonly evidence_status: CapaEvidenceStatus | null;
  readonly assumption_status: CapaAssumptionStatus | null;
  readonly gap_status: CapaGapStatus | null;
  readonly conflict_status: CapaConflictStatus | null;
  readonly provenance: CapaLedgerProvenance;
  readonly owner_user_id: string | null;
  readonly information_date: string | null;
  readonly source_version: string | null;
  readonly context: string | null;
  readonly linked_capa_objects: readonly string[];
  readonly supporting_item_ids: readonly string[];
  readonly contradictory_item_ids: readonly string[];
  readonly conflict_item_ids: readonly string[];
  readonly material_to_conclusion: boolean;
  readonly critical_to_conclusion: boolean;
  readonly recommended_next_step: string | null;
  readonly target_date: string | null;
  readonly human_disposition: CapaLedgerHumanDisposition | null;
}
export interface CapaEvidenceAssumptionLedgerContent {
  readonly items: readonly CapaEvidenceAssumptionLedgerItem[];
}

export const CAPA_EVIDENCE_ASSUMPTION_LEDGER_VALIDATION_REASON_CODES = [
  "INVALID_LEDGER_OBJECT",
  "INVALID_LEDGER_FIELDS",
  "INVALID_LEDGER_ITEM",
  "DUPLICATE_LEDGER_ITEM_ID",
  "INVALID_LEDGER_ITEM_REFERENCE",
  "DUPLICATE_LEDGER_ITEM_REFERENCE",
  "SELF_LEDGER_ITEM_REFERENCE",
  "INVALID_LEDGER_PROVENANCE",
  "INVALID_LEDGER_HUMAN_DISPOSITION",
  "INVALID_LEDGER_CLASS_STATUS",
] as const;
export type CapaEvidenceAssumptionLedgerValidationReasonCode =
  (typeof CAPA_EVIDENCE_ASSUMPTION_LEDGER_VALIDATION_REASON_CODES)[number];
export type CapaEvidenceAssumptionLedgerValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaEvidenceAssumptionLedgerContent;
    }
  | {
      readonly status: "invalid";
      readonly reason_code: CapaEvidenceAssumptionLedgerValidationReasonCode;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_KEYS = [
  "item_id",
  "information_class",
  "statement",
  "evidence_status",
  "assumption_status",
  "gap_status",
  "conflict_status",
  "provenance",
  "owner_user_id",
  "information_date",
  "source_version",
  "context",
  "linked_capa_objects",
  "supporting_item_ids",
  "contradictory_item_ids",
  "conflict_item_ids",
  "material_to_conclusion",
  "critical_to_conclusion",
  "recommended_next_step",
  "target_date",
  "human_disposition",
] as const;
const PROVENANCE_KEYS = [
  "source_type",
  "source_reference",
  "adopted_by_user_id",
  "adopted_at",
] as const;
const DISPOSITION_KEYS = ["user_id", "disposition_at", "rationale"] as const;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.trim() === v;
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  DATE.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)) &&
  new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v;
const isoDateTime = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
  !Number.isNaN(Date.parse(v));
const member = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === "string" && values.includes(v as T);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(text);

function invalid(
  reason_code: CapaEvidenceAssumptionLedgerValidationReasonCode
): CapaEvidenceAssumptionLedgerValidationResult {
  return Object.freeze({ status: "invalid", reason_code });
}
function parseProvenance(v: unknown): CapaLedgerProvenance | null {
  if (
    !isObject(v) ||
    !exact(v, PROVENANCE_KEYS) ||
    !member(v.source_type, CAPA_LEDGER_PROVENANCE_TYPES) ||
    !nullableText(v.source_reference)
  )
    return null;
  const adoptedId = v.adopted_by_user_id;
  const adoptedAt = v.adopted_at;
  if (
    !(
      (adoptedId === null && adoptedAt === null) ||
      (uuid(adoptedId) && isoDateTime(adoptedAt))
    )
  )
    return null;
  if (
    v.source_type !== "ai_proposal" &&
    (adoptedId !== null || adoptedAt !== null)
  )
    return null;
  return Object.freeze({
    source_type: v.source_type,
    source_reference: v.source_reference,
    adopted_by_user_id: adoptedId,
    adopted_at: adoptedAt,
  });
}
function parseDisposition(
  v: unknown
): CapaLedgerHumanDisposition | null | false {
  if (v === null) return null;
  if (
    !isObject(v) ||
    !exact(v, DISPOSITION_KEYS) ||
    !uuid(v.user_id) ||
    !isoDateTime(v.disposition_at) ||
    !text(v.rationale)
  )
    return false;
  return Object.freeze({
    user_id: v.user_id,
    disposition_at: v.disposition_at,
    rationale: v.rationale,
  });
}

export function validateCapaEvidenceAssumptionLedger(
  value: unknown
): CapaEvidenceAssumptionLedgerValidationResult {
  if (!isObject(value)) return invalid("INVALID_LEDGER_OBJECT");
  if (!exact(value, ["items"]) || !Array.isArray(value.items))
    return invalid("INVALID_LEDGER_FIELDS");
  const ids = new Set<string>();
  const rawItems: Record<string, unknown>[] = [];
  for (const raw of value.items) {
    if (
      !isObject(raw) ||
      !exact(raw, ITEM_KEYS) ||
      !text(raw.item_id) ||
      !member(raw.information_class, CAPA_LEDGER_INFORMATION_CLASSES) ||
      !text(raw.statement)
    )
      return invalid("INVALID_LEDGER_ITEM");
    if (ids.has(raw.item_id)) return invalid("DUPLICATE_LEDGER_ITEM_ID");
    ids.add(raw.item_id);
    if (
      !(
        raw.evidence_status === null ||
        member(raw.evidence_status, CAPA_EVIDENCE_STATUSES)
      ) ||
      !(
        raw.assumption_status === null ||
        member(raw.assumption_status, CAPA_ASSUMPTION_STATUSES)
      ) ||
      !(raw.gap_status === null || member(raw.gap_status, CAPA_GAP_STATUSES)) ||
      !(
        raw.conflict_status === null ||
        member(raw.conflict_status, CAPA_CONFLICT_STATUSES)
      )
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      !(raw.owner_user_id === null || uuid(raw.owner_user_id)) ||
      !(raw.information_date === null || isoDate(raw.information_date)) ||
      !nullableText(raw.source_version) ||
      !nullableText(raw.context) ||
      !(raw.target_date === null || isoDate(raw.target_date)) ||
      !nullableText(raw.recommended_next_step) ||
      typeof raw.material_to_conclusion !== "boolean" ||
      typeof raw.critical_to_conclusion !== "boolean"
    )
      return invalid("INVALID_LEDGER_ITEM");
    if (
      !strings(raw.linked_capa_objects) ||
      !strings(raw.supporting_item_ids) ||
      !strings(raw.contradictory_item_ids) ||
      !strings(raw.conflict_item_ids)
    )
      return invalid("INVALID_LEDGER_ITEM_REFERENCE");
    for (const refs of [
      raw.linked_capa_objects,
      raw.supporting_item_ids,
      raw.contradictory_item_ids,
      raw.conflict_item_ids,
    ] as string[][])
      if (new Set(refs).size !== refs.length)
        return invalid("DUPLICATE_LEDGER_ITEM_REFERENCE");
    const provenance = parseProvenance(raw.provenance);
    if (!provenance) return invalid("INVALID_LEDGER_PROVENANCE");
    const disposition = parseDisposition(raw.human_disposition);
    if (disposition === false)
      return invalid("INVALID_LEDGER_HUMAN_DISPOSITION");
    const c = raw.information_class;
    if (
      (c === "ai_generated_hypothesis" || c === "ai_recommendation") &&
      provenance.source_type !== "ai_proposal"
    )
      return invalid("INVALID_LEDGER_PROVENANCE");
    if (
      c === "retrieved_reference" &&
      provenance.source_type !== "retrieved_reference"
    )
      return invalid("INVALID_LEDGER_PROVENANCE");
    const evidenceClass =
      c === "verified_evidence" ||
      c === "user_provided_statement" ||
      c === "retrieved_reference";
    if (
      evidenceClass !== (raw.evidence_status !== null) ||
      (c === "assumption") !== (raw.assumption_status !== null) ||
      (c === "missing_information") !== (raw.gap_status !== null) ||
      (c === "conflicting_information") !== (raw.conflict_status !== null)
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (c === "verified_evidence" && raw.evidence_status === "current")
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      provenance.source_type === "ai_proposal" &&
      raw.evidence_status === "verified"
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    const hasReferences = (field: string) =>
      (raw[field] as readonly string[]).length > 0;
    const hasGapFields =
      raw.recommended_next_step !== null || raw.target_date !== null;
    if (
      evidenceClass &&
      (hasGapFields ||
        hasReferences("conflict_item_ids") ||
        raw.material_to_conclusion ||
        raw.critical_to_conclusion)
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      (c === "user_provided_statement" || c === "retrieved_reference") &&
      (hasReferences("supporting_item_ids") ||
        hasReferences("contradictory_item_ids"))
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      c === "assumption" &&
      (hasGapFields ||
        hasReferences("conflict_item_ids") ||
        raw.critical_to_conclusion)
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      c === "missing_information" &&
      (hasReferences("contradictory_item_ids") ||
        hasReferences("conflict_item_ids") ||
        raw.material_to_conclusion)
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      c === "conflicting_information" &&
      (hasGapFields || raw.critical_to_conclusion)
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    if (
      (c === "ai_generated_hypothesis" || c === "ai_recommendation") &&
      (hasReferences("supporting_item_ids") ||
        hasReferences("contradictory_item_ids") ||
        hasReferences("conflict_item_ids") ||
        hasGapFields ||
        raw.material_to_conclusion ||
        raw.critical_to_conclusion)
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    const requiresDisposition =
      (raw.evidence_status !== null && raw.evidence_status !== "current") ||
      (raw.assumption_status !== null && raw.assumption_status !== "open") ||
      raw.gap_status === "resolved" ||
      raw.conflict_status === "resolved";
    if (requiresDisposition !== (disposition !== null))
      return invalid("INVALID_LEDGER_HUMAN_DISPOSITION");
    if (
      c === "missing_information" &&
      (!nullableText(raw.recommended_next_step) ||
        !(raw.owner_user_id === null || uuid(raw.owner_user_id)))
    )
      return invalid("INVALID_LEDGER_ITEM");
    if (
      c === "conflicting_information" &&
      (raw.conflict_item_ids as string[]).length < 2
    )
      return invalid("INVALID_LEDGER_CLASS_STATUS");
    rawItems.push({ ...raw, provenance, human_disposition: disposition });
  }
  for (const raw of rawItems)
    for (const field of [
      "supporting_item_ids",
      "contradictory_item_ids",
      "conflict_item_ids",
    ] as const)
      for (const ref of raw[field] as string[]) {
        if (ref === raw.item_id) return invalid("SELF_LEDGER_ITEM_REFERENCE");
        if (!ids.has(ref)) return invalid("INVALID_LEDGER_ITEM_REFERENCE");
      }
  const items = rawItems.map(
    (raw) =>
      Object.freeze({
        ...raw,
        linked_capa_objects: Object.freeze([
          ...(raw.linked_capa_objects as string[]),
        ]),
        supporting_item_ids: Object.freeze([
          ...(raw.supporting_item_ids as string[]),
        ]),
        contradictory_item_ids: Object.freeze([
          ...(raw.contradictory_item_ids as string[]),
        ]),
        conflict_item_ids: Object.freeze([
          ...(raw.conflict_item_ids as string[]),
        ]),
      }) as unknown as CapaEvidenceAssumptionLedgerItem
  );
  return Object.freeze({
    status: "valid",
    value: Object.freeze({ items: Object.freeze(items) }),
  });
}
