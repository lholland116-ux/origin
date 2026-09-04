import type { CapaInvestigationPlanContent } from "@/lib/capa/domain/capa-investigation-plan";
import type { CapaInvestigationPlanDraftProvenance } from "@/lib/capa/domain/capa-investigation-plan";
import type { PersistedCapaInvestigationPlanningAdoption } from "@/lib/database/repositories/capa-investigation-planning-adoption-repository";

const HUMAN_PROVENANCE: CapaInvestigationPlanDraftProvenance = Object.freeze({
  source_type: "human",
  source_reference: null,
  adopted_by_user_id: null,
  adopted_at: null,
});

export interface InvestigationPlanDraftItem {
  readonly itemId: string;
  readonly investigationQuestion: string;
  readonly evidenceTarget: string;
  readonly investigationMethod: string;
  readonly ownerUserId: string;
  readonly dueDate: string;
  readonly scopeRelationship: string;
  readonly dependencyItemIds: readonly string[];
  readonly provenance: CapaInvestigationPlanDraftProvenance;
}

export interface InvestigationPlanDraft { readonly items: readonly InvestigationPlanDraftItem[] }

export function createInvestigationPlanDraftItem(itemId: string): InvestigationPlanDraftItem {
  return Object.freeze({ itemId, investigationQuestion: "", evidenceTarget: "",
    investigationMethod: "", ownerUserId: "", dueDate: "", scopeRelationship: "",
    dependencyItemIds: Object.freeze([]), provenance: HUMAN_PROVENANCE });
}

export function createEmptyInvestigationPlanDraft(): InvestigationPlanDraft {
  return Object.freeze({ items: Object.freeze([]) });
}

export function addInvestigationPlanItem(draft: InvestigationPlanDraft, itemId: string): InvestigationPlanDraft {
  if (!itemId.trim() || draft.items.some((item) => item.itemId === itemId)) return draft;
  return Object.freeze({ items: Object.freeze([...draft.items, createInvestigationPlanDraftItem(itemId)]) });
}

export function updateInvestigationPlanItem(
  draft: InvestigationPlanDraft, itemId: string,
  changes: Partial<Omit<InvestigationPlanDraftItem, "itemId" | "provenance">>,
): InvestigationPlanDraft {
  return Object.freeze({ items: Object.freeze(draft.items.map((item) => {
    if (item.itemId !== itemId) return item;

    return Object.freeze({ ...item, ...changes, itemId,
      dependencyItemIds: Object.prototype.hasOwnProperty.call(changes, "dependencyItemIds")
        ? Object.freeze([...(changes.dependencyItemIds ?? [])]) : item.dependencyItemIds,
      provenance: item.provenance });
  })) });
}

export function removeInvestigationPlanItem(draft: InvestigationPlanDraft, itemId: string): InvestigationPlanDraft {
  return Object.freeze({ items: Object.freeze(draft.items.filter((item) => item.itemId !== itemId)
    .map((item) => {
      if (!item.dependencyItemIds.includes(itemId)) return item;
      return Object.freeze({ ...item,
        dependencyItemIds: Object.freeze(item.dependencyItemIds.filter((id) => id !== itemId)),
      });
    })) });
}

function cycle(items: readonly InvestigationPlanDraftItem[]): boolean {
  const graph = new Map(items.map((item) => [item.itemId, item.dependencyItemIds]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true; if (visited.has(id)) return false;
    visiting.add(id); for (const dependency of graph.get(id) ?? []) if (visit(dependency)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  return items.some((item) => visit(item.itemId));
}

export function setInvestigationPlanDependency(
  draft: InvestigationPlanDraft, itemId: string, dependencyId: string, selected: boolean,
): InvestigationPlanDraft | null {
  if (itemId === dependencyId || !draft.items.some((item) => item.itemId === itemId) ||
    !draft.items.some((item) => item.itemId === dependencyId)) return null;
  const item = draft.items.find((candidate) => candidate.itemId === itemId)!;
  const dependencies = selected
    ? [...new Set([...item.dependencyItemIds, dependencyId])]
    : item.dependencyItemIds.filter((id) => id !== dependencyId);
  const next = updateInvestigationPlanItem(draft, itemId, { dependencyItemIds: Object.freeze(dependencies) });
  return cycle(next.items) ? null : next;
}

const nullable = (value: string) => value.trim().length === 0 ? null : value.trim();

export function composeInvestigationPlan(draft: InvestigationPlanDraft): CapaInvestigationPlanContent {
  return Object.freeze({ items: Object.freeze(draft.items.map((item) => Object.freeze({
    item_id: item.itemId, investigation_question: nullable(item.investigationQuestion),
    evidence_target: nullable(item.evidenceTarget), investigation_method: nullable(item.investigationMethod),
    owner_user_id: nullable(item.ownerUserId), due_date: nullable(item.dueDate), sme_user_ids: Object.freeze([]),
    dependency_item_ids: Object.freeze([...item.dependencyItemIds]), scope_relationship: nullable(item.scopeRelationship),
    status: "planned" as const, disposition: null, disposition_rationale: null,
    draft_provenance: item.provenance,
  }))) });
}

function trustedRecordIsUsable(record: PersistedCapaInvestigationPlanningAdoption): boolean {
  const adoption = record.adoption;
  const item = adoption.adopted_item;
  return adoption.adopted_by.actor_type === "human" &&
    adoption.workflow_mutated === false &&
    adoption.controlled_record_mutated === false &&
    adoption.gate_approved === false &&
    typeof item.investigation_question === "string" && item.investigation_question.trim().length > 0 &&
    typeof item.evidence_target === "string" && item.evidence_target.trim().length > 0 &&
    typeof item.investigation_method === "string" && item.investigation_method.trim().length > 0 &&
    typeof item.scope_relationship === "string" && item.scope_relationship.trim().length > 0 &&
    typeof item.owner_user_id === "string" && item.owner_user_id.trim().length > 0 &&
    typeof item.due_date === "string" && item.due_date.trim().length > 0;
}

function sameAdoptionResponse(left: PersistedCapaInvestigationPlanningAdoption,
  right: PersistedCapaInvestigationPlanningAdoption): boolean {
  return left.adoption.organization_id === right.adoption.organization_id &&
    left.adoption.capa_case_id === right.adoption.capa_case_id &&
    left.adoption.case_version_id === right.adoption.case_version_id &&
    left.adoption.record_version === right.adoption.record_version &&
    left.adoption.output_id === right.adoption.output_id &&
    left.adoption.idempotency_key === right.adoption.idempotency_key &&
    left.adoption.adoption_policy_version === right.adoption.adoption_policy_version &&
    left.adoption.adopted_by.actor_type === right.adoption.adopted_by.actor_type &&
    left.adoption.adopted_by.actor_id === right.adoption.adopted_by.actor_id &&
    left.adoption.adopted_at === right.adoption.adopted_at &&
    left.request_fingerprint === right.request_fingerprint;
}

/** Atomically integrates one trusted server adoption response into the draft. */
export function integrateAdoptedInvestigationPlanItems(
  draft: InvestigationPlanDraft,
  records: readonly PersistedCapaInvestigationPlanningAdoption[],
  generateItemId: () => string,
): InvestigationPlanDraft | null {
  if (records.length === 0) return draft;

  const adoptionIds = new Set<string>();
  const proposalKeys = new Set<string>();
  const byProposalKey = new Map<string, PersistedCapaInvestigationPlanningAdoption>();
  for (const record of records) {
    const adoption = record.adoption;
    if (!trustedRecordIsUsable(record) || adoption.adoption_id.trim().length === 0 ||
      adoption.proposal_key !== adoption.adopted_item.proposal_key || adoptionIds.has(adoption.adoption_id) ||
      proposalKeys.has(adoption.proposal_key)) return null;
    if (records[0] !== record && !sameAdoptionResponse(records[0]!, record)) return null;
    adoptionIds.add(adoption.adoption_id);
    proposalKeys.add(adoption.proposal_key);
    byProposalKey.set(adoption.proposal_key, record);
  }

  const existingBySource = new Map<string, number>();
  for (const item of draft.items) {
    if (item.provenance.source_reference !== null) {
      existingBySource.set(item.provenance.source_reference,
        (existingBySource.get(item.provenance.source_reference) ?? 0) + 1);
    }
  }
  const integratedCount = records.filter((record) =>
    (existingBySource.get(record.adoption.adoption_id) ?? 0) > 0,
  ).length;
  if (integratedCount === records.length) return draft;
  if (integratedCount !== 0) return null;

  for (const record of records) {
    for (const dependency of record.adoption.adopted_item.dependency_proposal_keys) {
      if (!byProposalKey.has(dependency)) return null;
    }
  }

  const generatedIds = new Set<string>();
  const itemIds = new Map<string, string>();
  for (const record of records) {
    const itemId = generateItemId();
    if (typeof itemId !== "string" || !itemId.trim() || generatedIds.has(itemId) ||
      draft.items.some((item) => item.itemId === itemId)) return null;
    generatedIds.add(itemId);
    itemIds.set(record.adoption.proposal_key, itemId);
  }

  const additions = records.map((record) => {
    const adoption = record.adoption;
    const adoptedItem = adoption.adopted_item;
    return Object.freeze({
      itemId: itemIds.get(adoption.proposal_key)!,
      investigationQuestion: adoptedItem.investigation_question!,
      evidenceTarget: adoptedItem.evidence_target!,
      investigationMethod: adoptedItem.investigation_method!,
      ownerUserId: adoptedItem.owner_user_id!,
      dueDate: adoptedItem.due_date!,
      scopeRelationship: adoptedItem.scope_relationship!,
      dependencyItemIds: Object.freeze(adoptedItem.dependency_proposal_keys.map((key) => itemIds.get(key)!)),
      provenance: Object.freeze({
        source_type: "ai_proposal" as const,
        source_reference: adoption.adoption_id,
        adopted_by_user_id: adoption.adopted_by.actor_id,
        adopted_at: adoption.adopted_at,
      }),
    });
  });
  return Object.freeze({ items: Object.freeze([...draft.items, ...additions]) });
}

export function validateInvestigationPlanDraft(draft: InvestigationPlanDraft): readonly string[] {
  const errors: string[] = [];
  if (draft.items.length === 0) errors.push("Add at least one investigation item.");
  for (const [index, item] of draft.items.entries()) {
    const missing = [item.investigationQuestion, item.evidenceTarget, item.investigationMethod,
      item.ownerUserId, item.dueDate, item.scopeRelationship].some((value) => !value.trim());
    if (missing) errors.push(`Investigation item ${index + 1} is missing a required field.`);
  }
  if (cycle(draft.items)) errors.push("Investigation dependencies contain a cycle.");
  return Object.freeze(errors);
}

export function normalizedReleaseComment(value: string): string | null {
  const normalized = value.trim(); return normalized.length === 0 ? null : normalized;
}
