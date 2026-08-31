import type { CapaInvestigationPlanContent } from "@/lib/capa/domain/capa-investigation-plan";

export interface InvestigationPlanDraftItem {
  readonly itemId: string;
  readonly investigationQuestion: string;
  readonly evidenceTarget: string;
  readonly investigationMethod: string;
  readonly ownerUserId: string;
  readonly dueDate: string;
  readonly scopeRelationship: string;
  readonly dependencyItemIds: readonly string[];
}

export interface InvestigationPlanDraft { readonly items: readonly InvestigationPlanDraftItem[] }

export function createInvestigationPlanDraftItem(itemId: string): InvestigationPlanDraftItem {
  return Object.freeze({ itemId, investigationQuestion: "", evidenceTarget: "",
    investigationMethod: "", ownerUserId: "", dueDate: "", scopeRelationship: "",
    dependencyItemIds: Object.freeze([]) });
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
  changes: Partial<Omit<InvestigationPlanDraftItem, "itemId">>,
): InvestigationPlanDraft {
  return Object.freeze({ items: Object.freeze(draft.items.map((item) => item.itemId === itemId
    ? Object.freeze({ ...item, ...changes, itemId }) : item)) });
}

export function removeInvestigationPlanItem(draft: InvestigationPlanDraft, itemId: string): InvestigationPlanDraft {
  return Object.freeze({ items: Object.freeze(draft.items.filter((item) => item.itemId !== itemId)
    .map((item) => item.dependencyItemIds.includes(itemId)
      ? Object.freeze({ ...item, dependencyItemIds: Object.freeze(item.dependencyItemIds.filter((id) => id !== itemId)) })
      : item)) });
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
    draft_provenance: Object.freeze({ source_type: "human" as const, source_reference: null,
      adopted_by_user_id: null, adopted_at: null }),
  }))) });
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
