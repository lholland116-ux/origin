import type {
  CapaEvidenceAssumptionLedgerContent,
  CapaEvidenceAssumptionLedgerItem,
} from "../domain/capa-evidence-assumption-ledger";
import type {
  CapaRootCausePackageContent,
  CapaCausalHypothesis,
} from "../domain/capa-root-cause-package";
import type { CapaCaseId, CapaCaseVersion, CapaCaseVersionId, OrganizationId } from "../domain/capa-types";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
  type CapaInvestigationActiveAdoptionCategory,
  type CapaInvestigationActiveAdoptionRecord,
} from "../ai/capa-investigation-active-adoption-contract";
import type { CapaInvestigationActiveAdoptionRepository } from "../../database/repositories/capa-investigation-active-adoption-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";

const MAX_LINEAGE_DEPTH = 1_000;

export type VerifyCapaInvestigationActiveAdoptionProvenanceResult =
  | { readonly status: "verified" }
  | { readonly status: "blocked"; readonly blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED" };

export interface VerifyCapaInvestigationActiveAdoptionProvenanceInput {
  readonly adoption_repository: CapaInvestigationActiveAdoptionRepository;
  readonly capa_repository: CapaRepository;
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blocked(): VerifyCapaInvestigationActiveAdoptionProvenanceResult {
  return { status: "blocked", blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED" };
}

function isAiProvenance(value: { readonly source_type: string }): boolean {
  return value.source_type === "ai_proposal";
}

function validReference(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function sameAdoptionIdentity(
  adoption: CapaInvestigationActiveAdoptionRecord,
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
  provenance: { readonly source_reference: string | null; readonly adopted_by_user_id: string | null; readonly adopted_at: string | null },
): boolean {
  return validReference(provenance.source_reference) &&
    provenance.adopted_by_user_id !== null &&
    provenance.adopted_at !== null &&
    adoption.adoption_id === provenance.source_reference &&
    adoption.organization_id === input.organization_id &&
    adoption.capa_case_id === input.capa_case_id &&
    validReference(adoption.case_version_id) &&
    Number.isSafeInteger(adoption.record_version) &&
    adoption.record_version > 0 &&
    adoption.adopted_by.actor_type === "human" &&
    adoption.adopted_by.actor_id === provenance.adopted_by_user_id &&
    adoption.adopted_at === provenance.adopted_at &&
    adoption.adoption_policy_version === CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION &&
    adoption.workflow_mutated === false &&
    adoption.controlled_record_mutated === false &&
    adoption.gate_approved === false;
}

function structurallyConsistentVersion(
  version: CapaCaseVersion,
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
): boolean {
  return version.organization_id === input.organization_id &&
    version.capa_case_id === input.capa_case_id &&
    validReference(version.case_version_id) &&
    Number.isSafeInteger(version.version_number) &&
    version.version_number > 0;
}

async function sourceVersionIsInCurrentLineage(
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
  adoption: CapaInvestigationActiveAdoptionRecord,
  currentVersion: CapaCaseVersion,
): Promise<boolean> {
  let cursor = currentVersion;
  const visited = new Set<string>();

  for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
    if (!structurallyConsistentVersion(cursor, input) || visited.has(cursor.case_version_id)) return false;
    visited.add(cursor.case_version_id);
    if (cursor.case_version_id === adoption.case_version_id) {
      return cursor.version_number === adoption.record_version && cursor.status === "S40";
    }
    if (cursor.version_number <= adoption.record_version || cursor.parent_version_id === undefined || !validReference(cursor.parent_version_id)) return false;
    let parent: CapaCaseVersion | null | undefined;
    try {
      parent = await input.capa_repository.findCaseVersionById(
        input.organization_id,
        input.capa_case_id,
        cursor.parent_version_id,
      );
    } catch {
      return false;
    }
    if (parent === null || parent === undefined || !structurallyConsistentVersion(parent, input) ||
        parent.case_version_id !== cursor.parent_version_id ||
        parent.version_number >= cursor.version_number) return false;
    cursor = parent;
  }
  return false;
}

async function validHistoricalAdoption(
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
  adoption: CapaInvestigationActiveAdoptionRecord,
): Promise<boolean> {
  let sourceVersion: CapaCaseVersion | null | undefined;
  let currentVersion: CapaCaseVersion | null | undefined;
  try {
    [sourceVersion, currentVersion] = await Promise.all([
      input.capa_repository.findCaseVersionById(
        input.organization_id,
        input.capa_case_id,
        adoption.case_version_id,
      ),
      input.capa_repository.findCaseVersionById(
        input.organization_id,
        input.capa_case_id,
        input.expected_case_version_id,
      ),
    ]);
  } catch {
    return false;
  }
  if (sourceVersion === null || sourceVersion === undefined || currentVersion === null || currentVersion === undefined ||
      !structurallyConsistentVersion(sourceVersion, input) ||
      sourceVersion.case_version_id !== adoption.case_version_id ||
      sourceVersion.version_number !== adoption.record_version ||
      sourceVersion.status !== "S40" ||
      !structurallyConsistentVersion(currentVersion, input) ||
      currentVersion.case_version_id !== input.expected_case_version_id ||
      currentVersion.version_number !== input.expected_record_version ||
      currentVersion.status !== "S40" ||
      adoption.record_version > currentVersion.version_number) return false;
  return sourceVersionIsInCurrentLineage(input, adoption, currentVersion);
}

async function findAndValidate(
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
  provenance: { readonly source_reference: string | null; readonly adopted_by_user_id: string | null; readonly adopted_at: string | null },
  used: Set<string>,
  category: CapaInvestigationActiveAdoptionCategory,
  matches: (adoption: CapaInvestigationActiveAdoptionRecord) => boolean,
): Promise<boolean> {
  if (!validReference(provenance.source_reference) || used.has(provenance.source_reference)) return false;
  let persisted;
  try {
    persisted = await input.adoption_repository.findAdoptionById(
      input.organization_id,
      provenance.source_reference as never,
    );
  } catch {
    return false;
  }
  if (persisted === null) return false;
  const adoption = persisted.adoption;
  if (!sameAdoptionIdentity(adoption, input, provenance) ||
      adoption.proposal_category !== category ||
      !await validHistoricalAdoption(input, adoption) ||
      !matches(adoption)) return false;
  used.add(provenance.source_reference);
  return true;
}

async function verifyLedgerItem(
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
  item: CapaEvidenceAssumptionLedgerItem,
  used: Set<string>,
): Promise<boolean> {
  if (!isAiProvenance(item.provenance)) return true;
  switch (item.information_class) {
    case "missing_information":
      return findAndValidate(input, item.provenance, used, "evidence_gap", (adoption) => {
        const content = adoption.adopted_item.adopted_content;
        return "gap" in content && "why_it_matters" in content && "recommended_next_step" in content &&
          item.statement === content.gap && item.context === content.why_it_matters &&
          item.recommended_next_step === content.recommended_next_step;
      });
    case "conflicting_information":
      return findAndValidate(input, item.provenance, used, "conflicting_information", (adoption) => {
        const content = adoption.adopted_item.adopted_content;
        return "conflict" in content && "why_it_matters" in content &&
          item.statement === content.conflict && item.context === content.why_it_matters;
      });
    case "assumption":
      return findAndValidate(input, item.provenance, used, "assumption", (adoption) => {
        const content = adoption.adopted_item.adopted_content;
        return "assumption" in content && "verification_question" in content &&
          item.statement === content.assumption && item.context === content.verification_question;
      });
    case "ai_recommendation":
      return findAndValidate(input, item.provenance, used, "investigation_recommendation", (adoption) => {
        const content = adoption.adopted_item.adopted_content;
        return "recommendation" in content && "rationale" in content &&
          item.statement === content.recommendation && item.context === content.rationale;
      });
    case "ai_generated_hypothesis":
      return false;
    default:
      return false;
  }
}

async function verifyHypothesis(
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
  hypothesis: CapaCausalHypothesis,
  used: Set<string>,
): Promise<boolean> {
  if (!isAiProvenance(hypothesis.provenance)) return true;
  if (hypothesis.causal_role === "alternative_hypothesis") {
    return findAndValidate(input, hypothesis.provenance, used, "alternative_hypothesis", (adoption) => {
      const content = adoption.adopted_item.adopted_content;
      return "hypothesis" in content && "rationale" in content &&
        hypothesis.statement === content.hypothesis && hypothesis.rationale === content.rationale;
    });
  }
  if (hypothesis.causal_role !== "proposed_root_cause" && hypothesis.causal_role !== "contributing_factor") return false;
  return findAndValidate(input, hypothesis.provenance, used, "causal_hypothesis", (adoption) => {
    const content = adoption.adopted_item.adopted_content;
    return "hypothesis" in content && "rationale" in content &&
      hypothesis.statement === content.hypothesis && hypothesis.rationale === content.rationale;
  });
}

export async function verifyCapaInvestigationActiveAdoptionProvenance(
  input: VerifyCapaInvestigationActiveAdoptionProvenanceInput,
): Promise<VerifyCapaInvestigationActiveAdoptionProvenanceResult> {
  const used = new Set<string>();
  for (const item of input.evidence_assumption_ledger.items) {
    if (!await verifyLedgerItem(input, item, used)) return blocked();
  }
  for (const hypothesis of input.root_cause_package.hypotheses) {
    if (!await verifyHypothesis(input, hypothesis, used)) return blocked();
  }
  if (input.root_cause_package.root_cause_not_confirmed !== null &&
      isAiProvenance(input.root_cause_package.root_cause_not_confirmed.provenance)) return blocked();
  return { status: "verified" };
}
