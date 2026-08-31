import type { CapaInvestigationPlanContent } from "./capa-investigation-plan";
import type {
  CapaEvidenceAssumptionLedgerContent,
  CapaLedgerProvenance,
} from "./capa-evidence-assumption-ledger";

/** Investigator-authored S40 package; never an approved root-cause conclusion. */
export const CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE =
  "CAPA.ROOT_CAUSE_PACKAGE" as const;
export const CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION =
  "capa-root-cause-package-1.0.0" as const;
export const CAPA_CAUSAL_HYPOTHESIS_STATUSES = [
  "proposed",
  "confirmed",
  "rejected",
  "unresolved",
] as const;
export type CapaCausalHypothesisStatus =
  (typeof CAPA_CAUSAL_HYPOTHESIS_STATUSES)[number];
export const CAPA_CAUSAL_ROLES = [
  "proposed_root_cause",
  "contributing_factor",
  "alternative_hypothesis",
] as const;
export type CapaCausalRole = (typeof CAPA_CAUSAL_ROLES)[number];

export interface CapaCausalHypothesis {
  readonly hypothesis_id: string;
  readonly statement: string;
  readonly status: CapaCausalHypothesisStatus;
  readonly causal_role: CapaCausalRole;
  readonly rationale: string;
  readonly responsible_user_id: string | null;
  readonly supporting_evidence_item_ids: readonly string[];
  readonly contradictory_evidence_item_ids: readonly string[];
  readonly linked_assumption_item_ids: readonly string[];
  readonly linked_gap_item_ids: readonly string[];
  readonly linked_conflict_item_ids: readonly string[];
  readonly material_to_package: boolean;
  readonly provenance: CapaLedgerProvenance;
}
export interface CapaRootCauseNotConfirmedConclusion {
  readonly rationale: string;
  readonly next_steps: readonly string[];
  readonly concluded_by_user_id: string;
  readonly concluded_at: string;
  readonly provenance: CapaLedgerProvenance;
}
export interface CapaRootCausePackageContent {
  readonly hypotheses: readonly CapaCausalHypothesis[];
  readonly root_cause_not_confirmed: CapaRootCauseNotConfirmedConclusion | null;
}

export const CAPA_ROOT_CAUSE_PACKAGE_VALIDATION_REASON_CODES = [
  "INVALID_ROOT_CAUSE_PACKAGE_OBJECT",
  "INVALID_ROOT_CAUSE_PACKAGE_FIELDS",
  "INVALID_CAUSAL_HYPOTHESIS",
  "DUPLICATE_CAUSAL_HYPOTHESIS_ID",
  "DUPLICATE_CAUSAL_REFERENCE",
  "INVALID_CAUSAL_REFERENCE",
  "INVALID_CAUSAL_PROVENANCE",
  "INVALID_ROOT_CAUSE_NOT_CONFIRMED",
  "CONTRADICTORY_ROOT_CAUSE_CONCLUSION",
] as const;
export type CapaRootCausePackageValidationReasonCode =
  (typeof CAPA_ROOT_CAUSE_PACKAGE_VALIDATION_REASON_CODES)[number];
export type CapaRootCausePackageValidationResult =
  | { readonly status: "valid"; readonly value: CapaRootCausePackageContent }
  | {
      readonly status: "invalid";
      readonly reason_code: CapaRootCausePackageValidationReasonCode;
    };

export const CAPA_ROOT_CAUSE_READINESS_REASON_CODES = [
  "OPEN_INVESTIGATION_PLAN_ITEM",
  "UNRESOLVED_CRITICAL_EVIDENCE_GAP",
  "UNRESOLVED_MATERIAL_CONTRADICTION",
  "OPEN_MATERIAL_ASSUMPTION",
  "INVALID_EVIDENCE_RELIED_UPON",
  "UNSUPPORTED_CAUSAL_HYPOTHESIS",
  "UNRESOLVED_MATERIAL_ALTERNATIVE",
  "ROOT_CAUSE_PACKAGE_INCOMPLETE",
  "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
] as const;
export type CapaRootCauseReadinessReasonCode =
  (typeof CAPA_ROOT_CAUSE_READINESS_REASON_CODES)[number];
export const CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING = Object.freeze({
  UNRESOLVED_CRITICAL_EVIDENCE_GAP: "B-02",
  UNRESOLVED_MATERIAL_CONTRADICTION: "B-03",
  OPEN_MATERIAL_ASSUMPTION: "B-04",
  INVALID_EVIDENCE_RELIED_UPON: "B-06",
} as const);
export type CapaRootCauseCanonicalBlockerCode =
  (typeof CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING)[keyof typeof CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING];
export type CapaRootCauseReadinessResult =
  | { readonly status: "ready_for_review" }
  | {
      readonly status: "blocked";
      readonly reason_codes: readonly CapaRootCauseReadinessReasonCode[];
      readonly canonical_blocker_codes: readonly CapaRootCauseCanonicalBlockerCode[];
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const H_KEYS = [
  "hypothesis_id",
  "statement",
  "status",
  "causal_role",
  "rationale",
  "responsible_user_id",
  "supporting_evidence_item_ids",
  "contradictory_evidence_item_ids",
  "linked_assumption_item_ids",
  "linked_gap_item_ids",
  "linked_conflict_item_ids",
  "material_to_package",
  "provenance",
] as const;
const P_KEYS = [
  "source_type",
  "source_reference",
  "adopted_by_user_id",
  "adopted_at",
] as const;
const N_KEYS = [
  "rationale",
  "next_steps",
  "concluded_by_user_id",
  "concluded_at",
  "provenance",
] as const;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.trim() === v;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const dt = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
  !Number.isNaN(Date.parse(v));
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(text);
const member = <T extends string>(v: unknown, xs: readonly T[]): v is T =>
  typeof v === "string" && xs.includes(v as T);
function invalid(
  reason_code: CapaRootCausePackageValidationReasonCode
): CapaRootCausePackageValidationResult {
  return Object.freeze({ status: "invalid", reason_code });
}
function provenance(v: unknown): CapaLedgerProvenance | null {
  if (
    !isObject(v) ||
    !exact(v, P_KEYS) ||
    !member(v.source_type, [
      "human",
      "ai_proposal",
      "retrieved_reference",
    ] as const) ||
    !(v.source_reference === null || text(v.source_reference))
  )
    return null;
  if (
    !(
      (v.adopted_by_user_id === null && v.adopted_at === null) ||
      (uuid(v.adopted_by_user_id) && dt(v.adopted_at))
    )
  )
    return null;
  if (
    v.source_type !== "ai_proposal" &&
    (v.adopted_by_user_id !== null || v.adopted_at !== null)
  )
    return null;
  return Object.freeze({
    source_type: v.source_type,
    source_reference: v.source_reference,
    adopted_by_user_id: v.adopted_by_user_id,
    adopted_at: v.adopted_at,
  });
}

export function validateCapaRootCausePackage(
  value: unknown,
  ledger: CapaEvidenceAssumptionLedgerContent
): CapaRootCausePackageValidationResult {
  if (!isObject(value)) return invalid("INVALID_ROOT_CAUSE_PACKAGE_OBJECT");
  if (
    !exact(value, ["hypotheses", "root_cause_not_confirmed"]) ||
    !Array.isArray(value.hypotheses)
  )
    return invalid("INVALID_ROOT_CAUSE_PACKAGE_FIELDS");
  let notConfirmed: CapaRootCauseNotConfirmedConclusion | null = null;
  if (value.root_cause_not_confirmed !== null) {
    const n = value.root_cause_not_confirmed;
    if (
      !isObject(n) ||
      !exact(n, N_KEYS) ||
      !text(n.rationale) ||
      !strings(n.next_steps) ||
      n.next_steps.length === 0 ||
      !uuid(n.concluded_by_user_id) ||
      !dt(n.concluded_at)
    )
      return invalid("INVALID_ROOT_CAUSE_NOT_CONFIRMED");
    const p = provenance(n.provenance);
    if (!p || p.source_type !== "human")
      return invalid("INVALID_ROOT_CAUSE_NOT_CONFIRMED");
    notConfirmed = Object.freeze({
      rationale: n.rationale,
      next_steps: Object.freeze([...n.next_steps]),
      concluded_by_user_id: n.concluded_by_user_id,
      concluded_at: n.concluded_at,
      provenance: p,
    });
  }
  const ledgerById = new Map(ledger.items.map((i) => [i.item_id, i]));
  const ids = new Set<string>();
  const hypotheses: CapaCausalHypothesis[] = [];
  for (const h of value.hypotheses) {
    if (
      !isObject(h) ||
      !exact(h, H_KEYS) ||
      !text(h.hypothesis_id) ||
      !text(h.statement) ||
      !member(h.status, CAPA_CAUSAL_HYPOTHESIS_STATUSES) ||
      !member(h.causal_role, CAPA_CAUSAL_ROLES) ||
      !text(h.rationale) ||
      !(h.responsible_user_id === null || uuid(h.responsible_user_id)) ||
      typeof h.material_to_package !== "boolean"
    )
      return invalid("INVALID_CAUSAL_HYPOTHESIS");
    if (h.status !== "proposed" && h.responsible_user_id === null)
      return invalid("INVALID_CAUSAL_HYPOTHESIS");
    if (ids.has(h.hypothesis_id))
      return invalid("DUPLICATE_CAUSAL_HYPOTHESIS_ID");
    ids.add(h.hypothesis_id);
    const p = provenance(h.provenance);
    if (!p) return invalid("INVALID_CAUSAL_PROVENANCE");
    const fields = [
      "supporting_evidence_item_ids",
      "contradictory_evidence_item_ids",
      "linked_assumption_item_ids",
      "linked_gap_item_ids",
      "linked_conflict_item_ids",
    ] as const;
    for (const f of fields) {
      if (!strings(h[f])) return invalid("INVALID_CAUSAL_REFERENCE");
      if (new Set(h[f] as string[]).size !== (h[f] as string[]).length)
        return invalid("DUPLICATE_CAUSAL_REFERENCE");
    }
    const expected = {
      supporting_evidence_item_ids: [
        "verified_evidence",
        "user_provided_statement",
        "retrieved_reference",
      ],
      contradictory_evidence_item_ids: [
        "verified_evidence",
        "user_provided_statement",
        "retrieved_reference",
      ],
      linked_assumption_item_ids: ["assumption"],
      linked_gap_item_ids: ["missing_information"],
      linked_conflict_item_ids: ["conflicting_information"],
    } as const;
    for (const f of fields)
      for (const ref of h[f] as string[]) {
        if (ref === h.hypothesis_id) return invalid("INVALID_CAUSAL_REFERENCE");
        if (
          !ledgerById.has(ref) ||
          !(expected[f] as readonly string[]).includes(
            ledgerById.get(ref)!.information_class
          )
        )
          return invalid("INVALID_CAUSAL_REFERENCE");
      }
    hypotheses.push(
      Object.freeze({
        ...h,
        provenance: p,
        ...Object.fromEntries(
          fields.map((f) => [f, Object.freeze([...(h[f] as string[])])])
        ),
      }) as unknown as CapaCausalHypothesis
    );
  }
  if (
    notConfirmed !== null &&
    hypotheses.some(
      (h) => h.causal_role === "proposed_root_cause" && h.status === "confirmed"
    )
  )
    return invalid("CONTRADICTORY_ROOT_CAUSE_CONCLUSION");
  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      hypotheses: Object.freeze(hypotheses),
      root_cause_not_confirmed: notConfirmed,
    }),
  });
}

/** Objective S40 submission prerequisites only. Trace: URS-PLAN-004/007, URS-RCA-001..013, B-02/03/04/06. */
export function evaluateCapaRootCauseReadiness(
  plan: CapaInvestigationPlanContent,
  ledger: CapaEvidenceAssumptionLedgerContent,
  pkg: CapaRootCausePackageContent
): CapaRootCauseReadinessResult {
  const reasons: CapaRootCauseReadinessReasonCode[] = [];
  const add = (r: CapaRootCauseReadinessReasonCode) => {
    if (!reasons.includes(r)) reasons.push(r);
  };
  if (
    plan.items.some((i) => i.status === "planned" || i.status === "in_progress")
  )
    add("OPEN_INVESTIGATION_PLAN_ITEM");
  if (
    ledger.items.some(
      (i) =>
        i.information_class === "missing_information" &&
        i.gap_status === "open" &&
        i.critical_to_conclusion
    )
  )
    add("UNRESOLVED_CRITICAL_EVIDENCE_GAP");
  if (
    ledger.items.some(
      (i) =>
        i.information_class === "conflicting_information" &&
        i.conflict_status === "open" &&
        i.material_to_conclusion
    )
  )
    add("UNRESOLVED_MATERIAL_CONTRADICTION");
  if (
    ledger.items.some(
      (i) =>
        i.information_class === "assumption" &&
        i.assumption_status === "open" &&
        i.material_to_conclusion
    )
  )
    add("OPEN_MATERIAL_ASSUMPTION");
  const byId = new Map(ledger.items.map((i) => [i.item_id, i]));
  const relied = pkg.hypotheses
    .filter(
      (h) =>
        (h.status === "proposed" || h.status === "confirmed") &&
        (h.causal_role === "proposed_root_cause" || h.material_to_package)
    )
    .flatMap((h) => [...h.supporting_evidence_item_ids]);
  if (
    relied.some((id) =>
      ["rejected", "superseded", "unavailable"].includes(
        byId.get(id)?.evidence_status ?? ""
      )
    )
  )
    add("INVALID_EVIDENCE_RELIED_UPON");
  if (
    pkg.hypotheses.some(
      (h) =>
        (h.causal_role === "proposed_root_cause" ||
          h.causal_role === "contributing_factor") &&
        h.status !== "rejected" &&
        h.supporting_evidence_item_ids.length === 0
    )
  )
    add("UNSUPPORTED_CAUSAL_HYPOTHESIS");
  if (
    pkg.hypotheses.some(
      (h) =>
        h.causal_role === "alternative_hypothesis" &&
        h.status === "unresolved" &&
        h.material_to_package
    )
  )
    add("UNRESOLVED_MATERIAL_ALTERNATIVE");
  if (
    pkg.root_cause_not_confirmed === null &&
    !pkg.hypotheses.some(
      (h) => h.causal_role === "proposed_root_cause" && h.status === "confirmed"
    )
  )
    add("ROOT_CAUSE_PACKAGE_INCOMPLETE");
  if (
    pkg.hypotheses.some(
      (h) =>
        h.provenance.source_type === "ai_proposal" &&
        (h.provenance.adopted_by_user_id === null ||
          h.provenance.adopted_at === null)
    )
  )
    add("AI_PROPOSAL_NOT_HUMAN_ADOPTED");
  if (reasons.length === 0)
    return Object.freeze({ status: "ready_for_review" });
  const canonical = reasons
    .map(
      (r) =>
        CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING[
          r as keyof typeof CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING
        ]
    )
    .filter((v): v is CapaRootCauseCanonicalBlockerCode => v !== undefined);
  return Object.freeze({
    status: "blocked",
    reason_codes: Object.freeze(reasons),
    canonical_blocker_codes: Object.freeze([...new Set(canonical)]),
  });
}
