import {
  CAPA_LEDGER_INFORMATION_CLASSES,
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
  type CapaEvidenceAssumptionLedgerItem,
  type CapaLedgerProvenance,
  type CapaLedgerInformationClass,
} from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import {
  evaluateCapaRootCauseReadiness,
  validateCapaRootCausePackage,
  type CapaCausalHypothesis,
  type CapaRootCauseNotConfirmedConclusion,
  type CapaRootCausePackageContent,
} from "../../lib/capa/domain/capa-root-cause-package";
import type { CapaInvestigationPlanContent } from "../../lib/capa/domain/capa-investigation-plan";
import type {
  CapaInvestigationActiveAdoptionCategory,
  CapaInvestigationActiveAdoptedContent,
} from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
import { validateCapaInvestigationActiveAdoptedContent } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import type { CapaInvestigationActiveAdoptionSafeRecord } from "./capa-investigation-active-adoption-client";

const humanProvenance = Object.freeze({
  source_type: "human" as const, source_reference: null,
  adopted_by_user_id: null, adopted_at: null,
});
const aiProvenance = Object.freeze({
  source_type: "ai_proposal" as const, source_reference: null,
  adopted_by_user_id: null, adopted_at: null,
});
const retrievedProvenance = Object.freeze({
  source_type: "retrieved_reference" as const, source_reference: null,
  adopted_by_user_id: null, adopted_at: null,
});

export type RootCauseLedgerDraft = CapaEvidenceAssumptionLedgerContent;
export type RootCausePackageDraft = CapaRootCausePackageContent;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isValidCurrentUserId = (value: string): boolean => UUID.test(value);
export const capaRootCauseWorkspaceKey = (caseId: string, mode: "S40" | "S50"): string => `${caseId}:${mode}`;
export function applyRootCauseDraftMutation<TDraft>(
  draft: TDraft,
  mutation: (value: TDraft) => TDraft,
): Readonly<{ readonly attempt: null; readonly draft: TDraft }> {
  return Object.freeze({ attempt: null, draft: mutation(draft) });
}

export const createInitialLedgerDraft = (): RootCauseLedgerDraft =>
  Object.freeze({ items: Object.freeze([]) });
export const createInitialRootCausePackageDraft = (): RootCausePackageDraft =>
  Object.freeze({ hypotheses: Object.freeze([]), root_cause_not_confirmed: null });

function freezeItem(item: CapaEvidenceAssumptionLedgerItem): CapaEvidenceAssumptionLedgerItem {
  return Object.freeze({ ...item,
    linked_capa_objects: Object.freeze([...item.linked_capa_objects]),
    supporting_item_ids: Object.freeze([...item.supporting_item_ids]),
    contradictory_item_ids: Object.freeze([...item.contradictory_item_ids]),
    conflict_item_ids: Object.freeze([...item.conflict_item_ids]),
    provenance: Object.freeze({ ...item.provenance }),
    human_disposition: item.human_disposition === null ? null : Object.freeze({ ...item.human_disposition }),
  });
}

export function createLedgerItem(
  informationClass: CapaLedgerInformationClass,
  itemId: string,
): CapaEvidenceAssumptionLedgerItem {
  const evidenceClass = informationClass === "verified_evidence" ||
    informationClass === "user_provided_statement" || informationClass === "retrieved_reference";
  return freezeItem({
    item_id: itemId, information_class: informationClass, statement: "",
    evidence_status: evidenceClass ? "current" : null,
    assumption_status: informationClass === "assumption" ? "open" : null,
    gap_status: informationClass === "missing_information" ? "open" : null,
    conflict_status: informationClass === "conflicting_information" ? "open" : null,
    provenance: informationClass === "ai_generated_hypothesis" || informationClass === "ai_recommendation"
      ? aiProvenance : informationClass === "retrieved_reference" ? retrievedProvenance : humanProvenance,
    owner_user_id: null, information_date: null, source_version: null, context: null,
    linked_capa_objects: Object.freeze([]), supporting_item_ids: Object.freeze([]),
    contradictory_item_ids: Object.freeze([]), conflict_item_ids: Object.freeze([]),
    material_to_conclusion: false, critical_to_conclusion: false,
    recommended_next_step: null, target_date: null, human_disposition: null,
  });
}

function normalizeClass(item: CapaEvidenceAssumptionLedgerItem): CapaEvidenceAssumptionLedgerItem {
  const c = item.information_class;
  const evidence = c === "verified_evidence" || c === "user_provided_statement" || c === "retrieved_reference";
  const adoptedAiProvenance = item.provenance.source_type === "ai_proposal" &&
    item.provenance.source_reference !== null && item.provenance.adopted_by_user_id !== null &&
    item.provenance.adopted_at !== null ? Object.freeze({ ...item.provenance }) : null;
  return freezeItem({ ...item,
    evidence_status: evidence ? (item.evidence_status ?? "current") : null,
    assumption_status: c === "assumption" ? (item.assumption_status ?? "open") : null,
    gap_status: c === "missing_information" ? (item.gap_status ?? "open") : null,
    conflict_status: c === "conflicting_information" ? (item.conflict_status ?? "open") : null,
    provenance: c === "ai_generated_hypothesis" || c === "ai_recommendation" ?
      (item.provenance.source_type === "ai_proposal" && item.provenance.source_reference !== null &&
        item.provenance.adopted_by_user_id !== null && item.provenance.adopted_at !== null
        ? Object.freeze({ ...item.provenance }) : aiProvenance)
      : c === "retrieved_reference" ? Object.freeze({ ...item.provenance, source_type: "retrieved_reference" as const,
        source_reference: item.provenance.source_reference?.trim() || null,
        adopted_by_user_id: null, adopted_at: null }) : (adoptedAiProvenance ?? humanProvenance),
    recommended_next_step: c === "missing_information" ? item.recommended_next_step : null,
    target_date: c === "missing_information" ? item.target_date : null,
    material_to_conclusion: c === "assumption" || c === "conflicting_information" ? item.material_to_conclusion : false,
    critical_to_conclusion: c === "missing_information" ? item.critical_to_conclusion : false,
    supporting_item_ids: c === "verified_evidence" || c === "assumption" || c === "missing_information" || c === "conflicting_information"
      ? item.supporting_item_ids : Object.freeze([]),
    contradictory_item_ids: c === "verified_evidence" || c === "assumption" || c === "conflicting_information"
      ? item.contradictory_item_ids : Object.freeze([]),
    conflict_item_ids: c === "conflicting_information" ? item.conflict_item_ids : Object.freeze([]),
  });
}

export function addLedgerItem(draft: RootCauseLedgerDraft, item: CapaEvidenceAssumptionLedgerItem): RootCauseLedgerDraft {
  return Object.freeze({ items: Object.freeze([...draft.items, normalizeClass(item)]) });
}
export function removeLedgerItem(draft: RootCauseLedgerDraft, itemId: string): RootCauseLedgerDraft {
  return Object.freeze({ items: Object.freeze(draft.items.filter((item) => item.item_id !== itemId).map((item) =>
    freezeItem({ ...item,
      supporting_item_ids: item.supporting_item_ids.filter((id) => id !== itemId),
      contradictory_item_ids: item.contradictory_item_ids.filter((id) => id !== itemId),
      conflict_item_ids: item.conflict_item_ids.filter((id) => id !== itemId),
    }))) });
}
export function updateLedgerItem(
  draft: RootCauseLedgerDraft, itemId: string,
  patch: Partial<CapaEvidenceAssumptionLedgerItem>, currentUserId: string, now = new Date().toISOString(),
): RootCauseLedgerDraft {
  return Object.freeze({ items: Object.freeze(draft.items.map((item) => {
    if (item.item_id !== itemId) return item;
    const next = normalizeClass({ ...item, ...patch, item_id: item.item_id,
      provenance: item.provenance.source_type === "ai_proposal" && item.provenance.source_reference !== null &&
        item.provenance.adopted_by_user_id !== null && item.provenance.adopted_at !== null
        ? item.provenance : patch.provenance ?? item.provenance });
    const resolved = (next.evidence_status !== null && next.evidence_status !== "current") ||
      (next.assumption_status !== null && next.assumption_status !== "open") || next.gap_status === "resolved" || next.conflict_status === "resolved";
    return freezeItem({ ...next, human_disposition: resolved ? Object.freeze({
      user_id: currentUserId, disposition_at: now,
      rationale: next.human_disposition?.rationale ?? "",
    }) : null });
  })) });
}

function freezeHypothesis(h: CapaCausalHypothesis): CapaCausalHypothesis {
  return Object.freeze({ ...h, provenance: Object.freeze({ ...h.provenance }),
    supporting_evidence_item_ids: Object.freeze([...h.supporting_evidence_item_ids]),
    contradictory_evidence_item_ids: Object.freeze([...h.contradictory_evidence_item_ids]),
    linked_assumption_item_ids: Object.freeze([...h.linked_assumption_item_ids]),
    linked_gap_item_ids: Object.freeze([...h.linked_gap_item_ids]),
    linked_conflict_item_ids: Object.freeze([...h.linked_conflict_item_ids]),
  });
}
export function createHypothesis(hypothesisId: string): CapaCausalHypothesis {
  return freezeHypothesis({ hypothesis_id: hypothesisId, statement: "", status: "proposed",
    causal_role: "proposed_root_cause", rationale: "", responsible_user_id: null,
    supporting_evidence_item_ids: [], contradictory_evidence_item_ids: [], linked_assumption_item_ids: [],
    linked_gap_item_ids: [], linked_conflict_item_ids: [], material_to_package: true, provenance: humanProvenance });
}
export function addHypothesis(draft: RootCausePackageDraft, hypothesis: CapaCausalHypothesis): RootCausePackageDraft {
  return Object.freeze({ hypotheses: Object.freeze([...draft.hypotheses, freezeHypothesis(hypothesis)]), root_cause_not_confirmed: null });
}
export function removeHypothesis(draft: RootCausePackageDraft, hypothesisId: string): RootCausePackageDraft {
  return Object.freeze({ ...draft, hypotheses: Object.freeze(draft.hypotheses.filter((h) => h.hypothesis_id !== hypothesisId)) });
}
export function updateHypothesis(
  draft: RootCausePackageDraft, hypothesisId: string, patch: Partial<CapaCausalHypothesis>, currentUserId: string,
): RootCausePackageDraft {
  const hypotheses = draft.hypotheses.map((h) => h.hypothesis_id !== hypothesisId ? h : freezeHypothesis({
    ...h, ...patch, hypothesis_id: h.hypothesis_id,
    provenance: h.provenance.source_type === "ai_proposal" && h.provenance.source_reference !== null &&
      h.provenance.adopted_by_user_id !== null && h.provenance.adopted_at !== null
      ? h.provenance : patch.provenance ?? h.provenance,
    responsible_user_id: (patch.status ?? h.status) === "proposed" ? null : currentUserId,
  }));
  const hasConfirmedRoot = hypotheses.some((h) => h.causal_role === "proposed_root_cause" && h.status === "confirmed");
  return Object.freeze({ hypotheses: Object.freeze(hypotheses),
    root_cause_not_confirmed: hasConfirmedRoot ? null : draft.root_cause_not_confirmed });
}

function adoptedProvenance(record: CapaInvestigationActiveAdoptionSafeRecord): CapaLedgerProvenance {
  return Object.freeze({ source_type: "ai_proposal" as const, source_reference: record.adoption_id,
    adopted_by_user_id: record.adopted_by_user_id, adopted_at: record.adopted_at });
}

function validAdoptionRecord(record: CapaInvestigationActiveAdoptionSafeRecord): CapaInvestigationActiveAdoptedContent | null {
  if (!record || record.adopted_item.proposal_key !== record.proposal_key) return null;
  try { return validateCapaInvestigationActiveAdoptedContent(record.proposal_category, record.adopted_item.adopted_content); } catch { return null; }
}

export function applyAdoptedCapaInvestigationActiveProposal(
  ledger: RootCauseLedgerDraft,
  pkg: RootCausePackageDraft,
  record: CapaInvestigationActiveAdoptionSafeRecord,
  causalRole?: "proposed_root_cause" | "contributing_factor",
  createLedgerId: () => string = () => `LED-${crypto.randomUUID()}`,
  createHypothesisId: () => string = () => `HYP-${crypto.randomUUID()}`,
): Readonly<{ readonly ledger: RootCauseLedgerDraft; readonly rootCausePackage: RootCausePackageDraft }> | null {
  const content = validAdoptionRecord(record); if (content === null) return null;
  const provenance = adoptedProvenance(record);
  const c = record.proposal_category;
  if (c === "causal_hypothesis" || c === "alternative_hypothesis") {
    if (c === "causal_hypothesis" && causalRole === undefined) return null;
    const value = content as { readonly hypothesis: string; readonly rationale: string };
    const hypothesis: CapaCausalHypothesis = freezeHypothesis({ hypothesis_id: createHypothesisId(), statement: value.hypothesis,
      status: "proposed", causal_role: c === "alternative_hypothesis" ? "alternative_hypothesis" : causalRole!, rationale: value.rationale,
      responsible_user_id: null, supporting_evidence_item_ids: [], contradictory_evidence_item_ids: [], linked_assumption_item_ids: [],
      linked_gap_item_ids: [], linked_conflict_item_ids: [], material_to_package: false, provenance });
    // AI adoption is advisory-local: unlike an explicit human addHypothesis
    // action, it must not alter a human root-cause-not-confirmed conclusion.
    return Object.freeze({ ledger, rootCausePackage: Object.freeze({
      hypotheses: Object.freeze([...pkg.hypotheses, hypothesis]),
      root_cause_not_confirmed: pkg.root_cause_not_confirmed,
    }) });
  }
  const value = content as unknown as Record<string, string>;
  const itemClass: CapaLedgerInformationClass = c === "evidence_gap" ? "missing_information" : c === "conflicting_information" ? "conflicting_information" : c === "assumption" ? "assumption" : "ai_recommendation";
  const item = createLedgerItem(itemClass, createLedgerId());
  const next = normalizeClass({ ...item, statement: value.gap ?? value.conflict ?? value.assumption ?? value.recommendation,
    context: value.why_it_matters ?? value.verification_question ?? value.rationale,
    recommended_next_step: value.recommended_next_step ?? null, provenance });
  return Object.freeze({ ledger: addLedgerItem(ledger, next), rootCausePackage: pkg });
}

export function applyAdoptedCapaInvestigationActiveProposals(
  ledger: RootCauseLedgerDraft, pkg: RootCausePackageDraft, records: readonly CapaInvestigationActiveAdoptionSafeRecord[],
  causalRoles: Readonly<Record<string, "proposed_root_cause" | "contributing_factor">>,
): Readonly<{ readonly ledger: RootCauseLedgerDraft; readonly rootCausePackage: RootCausePackageDraft }> | null {
  let nextLedger = ledger; let nextPackage = pkg;
  for (const record of records) {
    const applied = applyAdoptedCapaInvestigationActiveProposal(nextLedger, nextPackage, record, causalRoles[record.proposal_key]);
    if (applied === null) return null;
    nextLedger = applied.ledger; nextPackage = applied.rootCausePackage;
  }
  return Object.freeze({ ledger: nextLedger, rootCausePackage: nextPackage });
}
export function setRootCauseNotConfirmed(
  draft: RootCausePackageDraft, input: { readonly rationale: string; readonly nextSteps: readonly string[] },
  currentUserId: string, now = new Date().toISOString(),
): RootCausePackageDraft {
  const conclusion: CapaRootCauseNotConfirmedConclusion = Object.freeze({
    rationale: input.rationale, next_steps: Object.freeze([...input.nextSteps]), concluded_by_user_id: currentUserId,
    concluded_at: now, provenance: humanProvenance,
  });
  return Object.freeze({
    hypotheses: Object.freeze(draft.hypotheses.map((h) => h.causal_role === "proposed_root_cause" && h.status === "confirmed"
      ? freezeHypothesis({ ...h, status: "unresolved", responsible_user_id: currentUserId }) : h)),
    root_cause_not_confirmed: conclusion,
  });
}
export function clearRootCauseNotConfirmed(draft: RootCausePackageDraft): RootCausePackageDraft {
  return Object.freeze({ ...draft, root_cause_not_confirmed: null });
}

export function validateRootCauseDrafts(
  plan: CapaInvestigationPlanContent, ledger: RootCauseLedgerDraft, pkg: RootCausePackageDraft,
) {
  const ledgerResult = validateCapaEvidenceAssumptionLedger(ledger);
  if (ledgerResult.status === "invalid") return Object.freeze({ status: "invalid" as const,
    scope: "ledger" as const, reasonCode: ledgerResult.reason_code });
  const missingRetrievedSourceIndex = ledgerResult.value.items.findIndex((item) =>
    item.information_class === "retrieved_reference" &&
    (item.provenance.source_reference === null || item.provenance.source_reference.trim().length === 0));
  if (missingRetrievedSourceIndex >= 0) return Object.freeze({
    status: "invalid" as const,
    scope: "ledger" as const,
    reasonCode: "MISSING_RETRIEVED_SOURCE_REFERENCE" as const,
    path: `items.${missingRetrievedSourceIndex}.provenance.source_reference`,
  });
  const packageResult = validateCapaRootCausePackage(pkg, ledgerResult.value);
  if (packageResult.status === "invalid") return Object.freeze({ status: "invalid" as const,
    scope: "package" as const, reasonCode: packageResult.reason_code });
  return Object.freeze({ status: "valid" as const, ledger: ledgerResult.value, rootCausePackage: packageResult.value,
    readiness: evaluateCapaRootCauseReadiness(plan, ledgerResult.value, packageResult.value) });
}

export { CAPA_LEDGER_INFORMATION_CLASSES };
