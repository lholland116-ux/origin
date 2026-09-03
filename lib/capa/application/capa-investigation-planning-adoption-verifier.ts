import type {
  CapaInvestigationPlanContent,
  CapaInvestigationPlanItem,
} from "../domain/capa-investigation-plan";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  OrganizationId,
} from "../domain/capa-types";
import type {
  CapaInvestigationPlanningAdoptionRepository,
  PersistedCapaInvestigationPlanningAdoption,
} from "../../database/repositories/capa-investigation-planning-adoption-repository";

export type CapaInvestigationPlanningAdoptionVerificationResult =
  | { readonly status: "verified" }
  | {
      readonly status: "blocked";
      readonly blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED";
    };

export interface CapaInvestigationPlanningAdoptionVerificationInput {
  readonly repository: CapaInvestigationPlanningAdoptionRepository;
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
  readonly plan: CapaInvestigationPlanContent;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blocked(): CapaInvestigationPlanningAdoptionVerificationResult {
  return {
    status: "blocked",
    blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
  };
}

function validAdoptionId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}

function sameBatch(
  left: PersistedCapaInvestigationPlanningAdoption,
  right: PersistedCapaInvestigationPlanningAdoption,
): boolean {
  return left.adoption.organization_id === right.adoption.organization_id &&
    left.adoption.capa_case_id === right.adoption.capa_case_id &&
    left.adoption.case_version_id === right.adoption.case_version_id &&
    left.adoption.record_version === right.adoption.record_version &&
    left.adoption.output_id === right.adoption.output_id &&
    left.adoption.idempotency_key === right.adoption.idempotency_key &&
    left.adoption.adoption_policy_version === right.adoption.adoption_policy_version &&
    left.request_fingerprint === right.request_fingerprint &&
    left.adoption.adopted_by.actor_type === right.adoption.adopted_by.actor_type &&
    left.adoption.adopted_by.actor_id === right.adoption.adopted_by.actor_id &&
    left.adoption.adopted_at === right.adoption.adopted_at;
}

function adoptedFieldsMatch(
  item: CapaInvestigationPlanItem,
  adoption: PersistedCapaInvestigationPlanningAdoption,
): boolean {
  const trusted = adoption.adoption.adopted_item;
  return item.investigation_question === trusted.investigation_question &&
    item.evidence_target === trusted.evidence_target &&
    item.investigation_method === trusted.investigation_method &&
    item.scope_relationship === trusted.scope_relationship &&
    item.owner_user_id === trusted.owner_user_id &&
    item.due_date === trusted.due_date;
}

export async function verifyCapaInvestigationPlanningAdoptionProvenance(
  input: CapaInvestigationPlanningAdoptionVerificationInput,
): Promise<CapaInvestigationPlanningAdoptionVerificationResult> {
  const aiItems = input.plan.items.filter((item) =>
    item.draft_provenance.source_type === "ai_proposal",
  );
  if (aiItems.length === 0) return { status: "verified" };

  const bySourceReference = new Map<string, {
    readonly item: CapaInvestigationPlanItem;
    readonly record: PersistedCapaInvestigationPlanningAdoption;
  }>();
  const byProposalKey = new Map<string, {
    readonly item: CapaInvestigationPlanItem;
    readonly record: PersistedCapaInvestigationPlanningAdoption;
  }>();

  for (const item of aiItems) {
    const provenance = item.draft_provenance;
    if (
      provenance.source_reference === null ||
      !validAdoptionId(provenance.source_reference) ||
      provenance.adopted_by_user_id === null ||
      provenance.adopted_at === null ||
      bySourceReference.has(provenance.source_reference)
    ) return blocked();

    const record = await input.repository.findAdoptionById(
      input.organization_id,
      provenance.source_reference as never,
    );
    if (record === null) return blocked();
    const adoption = record.adoption;
    if (
      adoption.adoption_id !== provenance.source_reference ||
      adoption.organization_id !== input.organization_id ||
      adoption.capa_case_id !== input.capa_case_id ||
      adoption.case_version_id !== input.expected_case_version_id ||
      adoption.record_version !== input.expected_record_version ||
      adoption.adopted_by.actor_type !== "human" ||
      adoption.proposal_key !== adoption.adopted_item.proposal_key ||
      adoption.workflow_mutated !== false ||
      adoption.controlled_record_mutated !== false ||
      adoption.gate_approved !== false ||
      provenance.adopted_by_user_id !== adoption.adopted_by.actor_id ||
      provenance.adopted_at !== adoption.adopted_at ||
      !adoptedFieldsMatch(item, record)
    ) return blocked();

    if (byProposalKey.has(adoption.proposal_key)) return blocked();
    const value = { item, record };
    bySourceReference.set(provenance.source_reference, value);
    byProposalKey.set(adoption.proposal_key, value);
  }

  for (const { item, record } of bySourceReference.values()) {
    const trustedDependencyIds: string[] = [];
    for (const proposalKey of record.adoption.adopted_item.dependency_proposal_keys) {
      const dependency = byProposalKey.get(proposalKey);
      if (dependency === undefined || !sameBatch(record, dependency.record)) return blocked();
      trustedDependencyIds.push(dependency.item.item_id);
    }
    if (!sameSet(item.dependency_item_ids, trustedDependencyIds)) return blocked();
  }

  return { status: "verified" };
}
