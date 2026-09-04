import type {
  CapaInvestigationPlanAdvisoryDependency,
  CapaInvestigationPlanAdvisoryProposal,
  CapaInvestigationPlanAdvisoryProposalKey,
} from "@/lib/capa/ai/capa-investigation-planning-advisory-contract";
import type { CapaInvestigationPlanningAdoptionItemIntent } from "@/lib/capa/ai/capa-investigation-planning-adoption-contract";

export interface CapaInvestigationPlanningAdvisoryReviewCard {
  readonly proposalKey: CapaInvestigationPlanAdvisoryProposalKey;
  readonly investigationQuestion: string;
  readonly evidenceTarget: string;
  readonly investigationMethod: string;
  readonly scopeRelationship: string;
  readonly ownerUserId: string;
  readonly dueDate: string;
  readonly dependencyProposalKeys: readonly CapaInvestigationPlanAdvisoryProposalKey[];
  readonly selected: boolean;
  readonly dueDateConsideration: string;
  readonly proposedOwnerRole: string;
  readonly suggestedSmeFunction: string;
  readonly humanReviewQuestions: readonly string[];
}

export type AdvisoryReviewBuildResult =
  | { readonly valid: true; readonly cards: readonly CapaInvestigationPlanningAdvisoryReviewCard[] }
  | { readonly valid: false; readonly message: string };

export type AdvisoryReviewAdoptionValidation =
  | { readonly valid: true; readonly selectedItems: readonly CapaInvestigationPlanningAdoptionItemIntent[] }
  | { readonly valid: false; readonly message: string };

const unique = <T extends string>(values: readonly T[]): readonly T[] =>
  Object.freeze([...new Set(values)]);

function duplicateKey<T extends { readonly proposal_key: string }>(values: readonly T[]): boolean {
  const keys = new Set<string>();
  for (const value of values) {
    if (keys.has(value.proposal_key)) return true;
    keys.add(value.proposal_key);
  }
  return false;
}

function dependencyGraphIsValid(
  keys: ReadonlySet<string>,
  dependencies: readonly CapaInvestigationPlanAdvisoryDependency[],
): boolean {
  const graph = new Map<string, string[]>();
  const edges = new Set<string>();
  for (const dependency of dependencies) {
    if (!keys.has(dependency.dependent_proposal_key) ||
      !keys.has(dependency.prerequisite_proposal_key) ||
      dependency.dependent_proposal_key === dependency.prerequisite_proposal_key) return false;
    const edge = `${dependency.dependent_proposal_key}\u0000${dependency.prerequisite_proposal_key}`;
    if (edges.has(edge)) return false;
    edges.add(edge);
    const current = graph.get(dependency.dependent_proposal_key) ?? [];
    graph.set(dependency.dependent_proposal_key, [...current, dependency.prerequisite_proposal_key]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): boolean {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    visiting.add(key);
    for (const prerequisite of graph.get(key) ?? []) {
      if (!visit(prerequisite)) return false;
    }
    visiting.delete(key);
    visited.add(key);
    return true;
  }
  return [...keys].every(visit);
}

function guidanceQuestions(...questions: readonly (string | undefined)[]): readonly string[] {
  return unique(questions.filter((question): question is string =>
    typeof question === "string" && question.length > 0,
  ));
}

/** Joins advisory components by proposal_key without treating that key as an item ID. */
export function buildCapaInvestigationPlanningAdvisoryReview(
  proposal: CapaInvestigationPlanAdvisoryProposal,
): AdvisoryReviewBuildResult {
  const questions = proposal.investigation_questions;
  if (questions.length === 0 || duplicateKey(questions) ||
    duplicateKey(proposal.evidence_requests) ||
    duplicateKey(proposal.method_suggestions) ||
    duplicateKey(proposal.proposed_owner_role)) {
    return { valid: false, message: "The advisory proposal components could not be joined deterministically." };
  }

  const keys = new Set(questions.map((question) => question.proposal_key));
  if (!dependencyGraphIsValid(keys, proposal.dependencies)) {
    return { valid: false, message: "The advisory dependency graph is invalid." };
  }

  const evidence = new Map(proposal.evidence_requests.map((item) => [item.proposal_key, item]));
  const methods = new Map(proposal.method_suggestions.map((item) => [item.proposal_key, item]));
  const ownerRoles = new Map(proposal.proposed_owner_role.map((item) => [item.proposal_key, item]));
  const dependencyKeys = new Map<string, CapaInvestigationPlanAdvisoryProposalKey[]>();
  for (const dependency of proposal.dependencies) {
    const current = dependencyKeys.get(dependency.dependent_proposal_key) ?? [];
    dependencyKeys.set(dependency.dependent_proposal_key, [...current, dependency.prerequisite_proposal_key]);
  }

  const cards = questions.map((question) => {
    const evidenceItem = evidence.get(question.proposal_key);
    const methodItem = methods.get(question.proposal_key);
    const ownerRole = ownerRoles.get(question.proposal_key);
    const dependencyGuidance = proposal.dependencies.filter((dependency) =>
      dependency.dependent_proposal_key === question.proposal_key,
    );
    return Object.freeze({
      proposalKey: question.proposal_key,
      investigationQuestion: question.investigation_question,
      evidenceTarget: evidenceItem?.evidence_target ?? "",
      investigationMethod: methodItem?.investigation_method ?? "",
      scopeRelationship: question.scope_relationship,
      ownerUserId: "",
      dueDate: "",
      dependencyProposalKeys: Object.freeze(dependencyKeys.get(question.proposal_key) ?? []),
      selected: false,
      dueDateConsideration: question.due_date_consideration,
      proposedOwnerRole: ownerRole?.proposed_owner_role ?? "",
      suggestedSmeFunction: ownerRole?.suggested_sme_function ?? "",
      humanReviewQuestions: guidanceQuestions(
        question.human_review_question,
        evidenceItem?.human_review_question,
        methodItem?.human_review_question,
        ownerRole?.human_review_question,
        ...dependencyGuidance.map((dependency) => dependency.human_review_question),
      ),
    });
  });
  return { valid: true, cards: Object.freeze(cards) };
}

export function updateCapaInvestigationPlanningAdvisoryReviewCard(
  cards: readonly CapaInvestigationPlanningAdvisoryReviewCard[],
  proposalKey: CapaInvestigationPlanAdvisoryProposalKey,
  changes: Partial<Pick<CapaInvestigationPlanningAdvisoryReviewCard,
    "investigationQuestion" | "evidenceTarget" | "investigationMethod" | "scopeRelationship" |
    "ownerUserId" | "dueDate" | "dependencyProposalKeys" | "selected">>,
): readonly CapaInvestigationPlanningAdvisoryReviewCard[] {
  return Object.freeze(cards.map((card) => card.proposalKey === proposalKey
    ? Object.freeze({ ...card, ...changes })
    : card));
}

export function setCapaInvestigationPlanningAdvisoryReviewDependency(
  cards: readonly CapaInvestigationPlanningAdvisoryReviewCard[],
  dependentProposalKey: CapaInvestigationPlanAdvisoryProposalKey,
  prerequisiteProposalKey: CapaInvestigationPlanAdvisoryProposalKey,
  selected: boolean,
): readonly CapaInvestigationPlanningAdvisoryReviewCard[] | null {
  const dependent = cards.find((card) => card.proposalKey === dependentProposalKey);
  if (dependent === undefined || dependentProposalKey === prerequisiteProposalKey ||
    !cards.some((card) => card.proposalKey === prerequisiteProposalKey)) return null;
  const dependencies = selected
    ? unique([...dependent.dependencyProposalKeys, prerequisiteProposalKey])
    : dependent.dependencyProposalKeys.filter((key) => key !== prerequisiteProposalKey);
  const next = updateCapaInvestigationPlanningAdvisoryReviewCard(cards, dependentProposalKey, {
    dependencyProposalKeys: dependencies,
  });
  const graph = next.flatMap((card) => card.dependencyProposalKeys.map((key) => ({
    dependent_proposal_key: card.proposalKey,
    prerequisite_proposal_key: key,
  }))) as CapaInvestigationPlanAdvisoryDependency[];
  return dependencyGraphIsValid(new Set(next.map((card) => card.proposalKey)), graph) ? next : null;
}

/** Validates the human-controlled adoption selection and creates the exact item intent. */
export function validateCapaInvestigationPlanningAdvisorySelection(
  cards: readonly CapaInvestigationPlanningAdvisoryReviewCard[],
): AdvisoryReviewAdoptionValidation {
  const selected = cards.filter((card) => card.selected);
  if (selected.length === 0) return { valid: false, message: "Select at least one proposal to adopt." };
  const allEdges = cards.flatMap((card) => card.dependencyProposalKeys.map((key) => ({
    dependent_proposal_key: card.proposalKey,
    prerequisite_proposal_key: key,
  }))) as CapaInvestigationPlanAdvisoryDependency[];
  if (!dependencyGraphIsValid(new Set(cards.map((card) => card.proposalKey)), allEdges)) {
    return { valid: false, message: "The selected proposal dependencies are invalid." };
  }
  const selectedKeys = new Set(selected.map((card) => card.proposalKey));
  for (const card of selected) {
    if (!card.investigationQuestion.trim() || !card.evidenceTarget.trim() ||
      !card.investigationMethod.trim() || !card.scopeRelationship.trim() ||
      !card.ownerUserId.trim() || !card.dueDate.trim()) {
      return { valid: false, message: `${card.proposalKey} needs a question, evidence target, method, scope, owner, and due date.` };
    }
    if (card.dependencyProposalKeys.some((key) => !cards.some((candidate) => candidate.proposalKey === key))) {
      return { valid: false, message: `${card.proposalKey} contains an unknown dependency.` };
    }
    if (card.dependencyProposalKeys.some((key) => !selectedKeys.has(key))) {
      return { valid: false, message: `${card.proposalKey} depends on a proposal that is not selected. Include it or deliberately remove the dependency.` };
    }
  }
  const selectedItems = selected.map((card) => Object.freeze({
    proposal_key: card.proposalKey,
    investigation_question: card.investigationQuestion.trim(),
    evidence_target: card.evidenceTarget.trim(),
    investigation_method: card.investigationMethod.trim(),
    scope_relationship: card.scopeRelationship.trim(),
    owner_user_id: card.ownerUserId.trim() as never,
    due_date: card.dueDate.trim(),
    dependency_proposal_keys: Object.freeze([...card.dependencyProposalKeys]),
  }));
  return { valid: true, selectedItems: Object.freeze(selectedItems) };
}
