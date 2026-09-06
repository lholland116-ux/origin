import type { CapaInvestigationActiveAdvisoryProposal } from "../../lib/capa/ai/capa-investigation-active-advisory-contract";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_ITEMS,
  type CapaInvestigationActiveAdoptionCategory,
  type CapaInvestigationActiveAdoptedContent,
  type CapaInvestigationActiveAdoptionItemIntent,
  type CapaInvestigationActiveHumanCausalRole,
} from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
export type { CapaInvestigationActiveHumanCausalRole } from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
import { validateCapaInvestigationActiveAdoptedContent } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";

export interface CapaInvestigationActiveAdvisoryReviewCard {
  readonly proposalKey: string;
  readonly category: CapaInvestigationActiveAdoptionCategory;
  readonly title: string;
  readonly humanReviewQuestion: string;
  readonly referenceKeys: readonly string[];
  readonly suggestedRole?: string;
  readonly adoptedContent: CapaInvestigationActiveAdoptedContent;
  readonly selected: boolean;
  readonly humanCausalRole?: CapaInvestigationActiveHumanCausalRole;
}
export type CapaInvestigationActiveAdvisoryReviewBuildResult =
  | { readonly valid: true; readonly cards: readonly CapaInvestigationActiveAdvisoryReviewCard[] }
  | { readonly valid: false; readonly message: string };
export type CapaInvestigationActiveAdvisorySelection =
  | { readonly valid: true; readonly selectedItems: readonly CapaInvestigationActiveAdoptionItemIntent[]; readonly causalRoles: Readonly<Record<string, CapaInvestigationActiveHumanCausalRole>> }
  | { readonly valid: false; readonly message: string };

const groups: readonly { readonly category: CapaInvestigationActiveAdoptionCategory; readonly title: string }[] = [
  { category: "evidence_gap", title: "Evidence gaps" },
  { category: "conflicting_information", title: "Conflicting information" },
  { category: "assumption", title: "Assumptions" },
  { category: "causal_hypothesis", title: "Causal hypotheses" },
  { category: "alternative_hypothesis", title: "Alternative hypotheses" },
  { category: "investigation_recommendation", title: "Investigation recommendations" },
];
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function card(category: CapaInvestigationActiveAdoptionCategory, source: Record<string, unknown>): CapaInvestigationActiveAdvisoryReviewCard | null {
  if (!text(source.proposal_key) || !text(source.human_review_question)) return null;
  let adoptedContent: CapaInvestigationActiveAdoptedContent;
  try {
    const content = category === "evidence_gap" ? { gap: source.gap, why_it_matters: source.why_it_matters, recommended_next_step: source.recommended_next_step } :
      category === "conflicting_information" ? { conflict: source.conflict, why_it_matters: source.why_it_matters } :
      category === "assumption" ? { assumption: source.assumption, verification_question: source.verification_question } :
      category === "investigation_recommendation" ? { recommendation: source.recommendation, rationale: source.rationale } :
      { hypothesis: source.hypothesis, rationale: source.rationale };
    adoptedContent = validateCapaInvestigationActiveAdoptedContent(category, content);
  } catch { return null; }
  const refs = source.related_reference_keys ?? source.conflicting_reference_keys ?? (Array.isArray(source.supporting_reference_keys) || Array.isArray(source.contradictory_reference_keys) ? [...(source.supporting_reference_keys as unknown[] ?? []), ...(source.contradictory_reference_keys as unknown[] ?? [])] : []);
  return Object.freeze({ proposalKey: source.proposal_key, category, title: groups.find((group) => group.category === category)?.title ?? category, humanReviewQuestion: source.human_review_question, referenceKeys: Array.isArray(refs) ? Object.freeze(refs.filter((value): value is string => typeof value === "string")) : Object.freeze([]), ...(category === "causal_hypothesis" && text(source.suggested_role) ? { suggestedRole: source.suggested_role } : {}), adoptedContent, selected: false });
}

export function buildCapaInvestigationActiveAdvisoryReview(proposal: CapaInvestigationActiveAdvisoryProposal): CapaInvestigationActiveAdvisoryReviewBuildResult {
  const sourceGroups: readonly [CapaInvestigationActiveAdoptionCategory, readonly unknown[]][] = [
    ["evidence_gap", proposal.evidence_gaps], ["conflicting_information", proposal.conflicting_information], ["assumption", proposal.assumptions], ["causal_hypothesis", proposal.causal_hypotheses], ["alternative_hypothesis", proposal.alternative_hypotheses], ["investigation_recommendation", proposal.investigation_recommendations],
  ];
  const keys = new Set<string>(); const cards: CapaInvestigationActiveAdvisoryReviewCard[] = [];
  for (const [category, sources] of sourceGroups) for (const source of sources) {
    if (!object(source)) return { valid: false, message: "The advisory proposal could not be prepared for human review." };
    const next = card(category, source); if (next === null || keys.has(next.proposalKey)) return { valid: false, message: "The advisory proposal contains an invalid or duplicate proposal key." };
    keys.add(next.proposalKey); cards.push(next);
  }
  return { valid: true, cards: Object.freeze(cards) };
}

export function updateCapaInvestigationActiveAdvisoryReviewCard(cards: readonly CapaInvestigationActiveAdvisoryReviewCard[], proposalKey: string, changes: Partial<Pick<CapaInvestigationActiveAdvisoryReviewCard, "selected" | "humanCausalRole" | "adoptedContent">>): readonly CapaInvestigationActiveAdvisoryReviewCard[] {
  return Object.freeze(cards.map((item) => item.proposalKey === proposalKey ? Object.freeze({ ...item, ...changes }) : item));
}

export function validateCapaInvestigationActiveAdvisorySelection(cards: readonly CapaInvestigationActiveAdvisoryReviewCard[]): CapaInvestigationActiveAdvisorySelection {
  const selected = cards.filter((card) => card.selected);
  if (selected.length === 0) return { valid: false, message: "Select at least one proposal to adopt." };
  if (selected.length > CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_ITEMS) return { valid: false, message: "Too many proposals were selected." };
  const causalRoles: Record<string, CapaInvestigationActiveHumanCausalRole> = {};
  for (const item of selected) if (item.category === "causal_hypothesis") {
    if (item.humanCausalRole === undefined) return { valid: false, message: `${item.proposalKey} requires a human causal role.` };
    causalRoles[item.proposalKey] = item.humanCausalRole;
  }
  const selectedItems = selected.map((item) => Object.freeze({ proposal_key: item.proposalKey, adopted_content: item.adoptedContent, ...(item.humanCausalRole === undefined ? {} : { human_causal_role: item.humanCausalRole }) }));
  try { for (const item of selectedItems) { const source = cards.find((card) => card.proposalKey === item.proposal_key); if (source === undefined) return { valid: false, message: "The selected proposal is not available." }; validateCapaInvestigationActiveAdoptedContent(source.category, item.adopted_content); } } catch { return { valid: false, message: "A selected proposal contains invalid adopted content." }; }
  return { valid: true, selectedItems: Object.freeze(selectedItems), causalRoles: Object.freeze(causalRoles) };
}

export { groups as CAPA_INVESTIGATION_ACTIVE_ADVISORY_REVIEW_GROUPS };
