import {
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
  type CapaEvidenceAssumptionLedgerItem,
} from "../domain/capa-evidence-assumption-ledger";
import {
  validateCapaRootCausePackage,
  type CapaCausalHypothesis,
  type CapaRootCausePackageContent,
} from "../domain/capa-root-cause-package";
import {
  validateCapaInvestigationActiveAdoptionRecord,
} from "../ai/capa-investigation-active-adoption-validator";
import type { CapaInvestigationActiveAdoptionRecord } from "../ai/capa-investigation-active-adoption-contract";
import type { PersistedCapaInvestigationActiveAdoption } from "../../database/repositories/capa-investigation-active-adoption-repository";

export class CapaInvestigationActiveAdoptionWorkspaceMaterializationError extends Error {
  constructor(message = "The S40 adoption cannot be materialized into the workspace.") {
    super(message);
    this.name = "CapaInvestigationActiveAdoptionWorkspaceMaterializationError";
  }
}

function provenance(record: CapaInvestigationActiveAdoptionRecord) {
  return Object.freeze({
    source_type: "ai_proposal" as const,
    source_reference: record.adoption_id,
    adopted_by_user_id: record.adopted_by.actor_id,
    adopted_at: record.adopted_at,
  });
}

function ledgerItem(record: CapaInvestigationActiveAdoptionRecord, existingLedger: CapaEvidenceAssumptionLedgerContent): CapaEvidenceAssumptionLedgerItem {
  const content = record.adopted_item.adopted_content as unknown as Record<string, string>;
  const category = record.proposal_category;
  const information_class = category === "evidence_gap" ? "missing_information" as const
    : category === "conflicting_information" ? "conflicting_information" as const
    : category === "assumption" ? "assumption" as const
    : "ai_recommendation" as const;
  const conflict_item_ids = category === "conflicting_information"
    ? record.resolved_reference_bindings.filter((binding) => binding.source_kind === "ledger_item" && existingLedger.items.some((item) => item.item_id === binding.source_id)).map((binding) => binding.source_id).slice(0, 2)
    : [];
  if (category === "conflicting_information" && conflict_item_ids.length < 2) throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError("A conflict adoption has fewer than two ledger references.");
  return Object.freeze({
    item_id: `LED-${record.adoption_id}`,
    information_class,
    statement: content.gap ?? content.conflict ?? content.assumption ?? content.recommendation,
    evidence_status: null,
    assumption_status: category === "assumption" ? "open" as const : null,
    gap_status: category === "evidence_gap" ? "open" as const : null,
    conflict_status: category === "conflicting_information" ? "open" as const : null,
    provenance: provenance(record),
    owner_user_id: null,
    information_date: null,
    source_version: null,
    context: content.why_it_matters ?? content.verification_question ?? content.rationale,
    linked_capa_objects: Object.freeze([]),
    supporting_item_ids: Object.freeze([]),
    contradictory_item_ids: Object.freeze([]),
    conflict_item_ids: Object.freeze(conflict_item_ids),
    material_to_conclusion: false,
    critical_to_conclusion: false,
    recommended_next_step: content.recommended_next_step ?? null,
    target_date: null,
    human_disposition: null,
  });
}

function hypothesis(record: CapaInvestigationActiveAdoptionRecord): CapaCausalHypothesis {
  const content = record.adopted_item.adopted_content as { readonly hypothesis: string; readonly rationale: string };
  const causalRole = record.proposal_category === "alternative_hypothesis"
    ? "alternative_hypothesis" as const
    : record.adopted_item.human_causal_role;
  if (causalRole === undefined) throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError("A causal adoption has no recorded human causal role.");
  return Object.freeze({
    hypothesis_id: `HYP-${record.adoption_id}`,
    statement: content.hypothesis,
    status: "proposed" as const,
    causal_role: causalRole,
    rationale: content.rationale,
    responsible_user_id: null,
    supporting_evidence_item_ids: Object.freeze([]),
    contradictory_evidence_item_ids: Object.freeze([]),
    linked_assumption_item_ids: Object.freeze([]),
    linked_gap_item_ids: Object.freeze([]),
    linked_conflict_item_ids: Object.freeze([]),
    material_to_package: false,
    provenance: provenance(record),
  });
}

function hasAdoptionProvenance(value: { readonly provenance: { readonly source_type: string; readonly source_reference: string | null } }, adoptionId: string): boolean {
  return value.provenance.source_type === "ai_proposal" && value.provenance.source_reference === adoptionId;
}

function ledgerRepresentations(ledger: CapaEvidenceAssumptionLedgerContent, adoptionId: string): readonly CapaEvidenceAssumptionLedgerItem[] {
  return ledger.items.filter((item) => item.item_id === `LED-${adoptionId}` || hasAdoptionProvenance(item, adoptionId));
}

function hypothesisRepresentations(pkg: CapaRootCausePackageContent, adoptionId: string): readonly CapaCausalHypothesis[] {
  return pkg.hypotheses.filter((item) => item.hypothesis_id === `HYP-${adoptionId}` || hasAdoptionProvenance(item, adoptionId));
}

function matchingProvenance(value: { readonly source_type: string; readonly source_reference: string | null; readonly adopted_by_user_id: string | null; readonly adopted_at: string | null }, record: CapaInvestigationActiveAdoptionRecord): boolean {
  return value.source_type === "ai_proposal" && value.source_reference === record.adoption_id && value.adopted_by_user_id === record.adopted_by.actor_id && value.adopted_at === record.adopted_at;
}

function verifyExistingLedgerItem(item: CapaEvidenceAssumptionLedgerItem, record: CapaInvestigationActiveAdoptionRecord): boolean {
  const content = record.adopted_item.adopted_content as unknown as Record<string, string>;
  const expectedClass = record.proposal_category === "evidence_gap" ? "missing_information"
    : record.proposal_category === "conflicting_information" ? "conflicting_information"
    : record.proposal_category === "assumption" ? "assumption" : "ai_recommendation";
  const expectedContext = content.why_it_matters ?? content.verification_question ?? content.rationale;
  const expectedNextStep = record.proposal_category === "evidence_gap" ? content.recommended_next_step : null;
  return item.item_id === `LED-${record.adoption_id}` && item.information_class === expectedClass &&
    item.statement === (content.gap ?? content.conflict ?? content.assumption ?? content.recommendation) &&
    item.context === expectedContext && item.recommended_next_step === expectedNextStep &&
    matchingProvenance(item.provenance, record);
}

function verifyExistingHypothesis(item: CapaCausalHypothesis, record: CapaInvestigationActiveAdoptionRecord): boolean {
  const content = record.adopted_item.adopted_content as { readonly hypothesis: string; readonly rationale: string };
  const expectedRole = record.proposal_category === "alternative_hypothesis" ? "alternative_hypothesis" : record.adopted_item.human_causal_role;
  return item.hypothesis_id === `HYP-${record.adoption_id}` && item.statement === content.hypothesis && item.rationale === content.rationale && item.causal_role === expectedRole && matchingProvenance(item.provenance, record);
}

export function materializeCapaInvestigationActiveAdoptions(input: {
  readonly ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
  readonly adoptions: readonly PersistedCapaInvestigationActiveAdoption[];
}): { readonly ledger: CapaEvidenceAssumptionLedgerContent; readonly root_cause_package: CapaRootCausePackageContent; readonly changed: boolean } {
  const ledgerResult = validateCapaEvidenceAssumptionLedger(input.ledger);
  if (ledgerResult.status !== "valid") throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError();
  const packageResult = validateCapaRootCausePackage(input.root_cause_package, ledgerResult.value);
  if (packageResult.status !== "valid") throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError();
  let ledger = ledgerResult.value;
  let root = packageResult.value;
  let changed = false;
  const seenAdoptionIds = new Set<string>();
  for (const persisted of input.adoptions) {
    let record: CapaInvestigationActiveAdoptionRecord;
    try { record = validateCapaInvestigationActiveAdoptionRecord(persisted.adoption); } catch { throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError(); }
    if (seenAdoptionIds.has(record.adoption_id)) throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError("An adoption batch contains a duplicate adoption.");
    seenAdoptionIds.add(record.adoption_id);
    const ledgerMatches = ledgerRepresentations(ledger, record.adoption_id);
    const hypothesisMatches = hypothesisRepresentations(root, record.adoption_id);
    const matches = [...ledgerMatches, ...hypothesisMatches];
    if (matches.length > 1) throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError("An adoption is represented more than once in the workspace.");
    if (matches.length === 1) {
      const isHypothesisAdoption = record.proposal_category === "causal_hypothesis" || record.proposal_category === "alternative_hypothesis";
      const isHypothesisRepresentation = hypothesisMatches.length === 1;
      if (isHypothesisAdoption !== isHypothesisRepresentation) throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError("An adoption is represented in the wrong workspace collection.");
      const valid = isHypothesisRepresentation
        ? verifyExistingHypothesis(hypothesisMatches[0]!, record)
        : verifyExistingLedgerItem(ledgerMatches[0]!, record);
      if (!valid) throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError("An adoption workspace representation is inconsistent.");
      continue;
    }
    if (record.proposal_category === "causal_hypothesis" || record.proposal_category === "alternative_hypothesis") {
      root = Object.freeze({ ...root, hypotheses: Object.freeze([...root.hypotheses, hypothesis(record)]) });
    } else {
      ledger = Object.freeze({ items: Object.freeze([...ledger.items, ledgerItem(record, ledger)]) });
    }
    changed = true;
  }
  const finalLedger = validateCapaEvidenceAssumptionLedger(ledger);
  if (finalLedger.status !== "valid") throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError();
  const finalPackage = validateCapaRootCausePackage(root, finalLedger.value);
  if (finalPackage.status !== "valid") throw new CapaInvestigationActiveAdoptionWorkspaceMaterializationError();
  return Object.freeze({ ledger: finalLedger.value, root_cause_package: finalPackage.value, changed });
}
