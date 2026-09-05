import type { CapaCaseId, CapaCaseVersionId, OrganizationId } from "../domain/capa-types";
import type { CapaAiOutputId } from "../ai/capa-prompt-contract";
import { CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION, type CapaInvestigationActiveAdvisoryProposal } from "../ai/capa-investigation-active-advisory-contract";
import { validateCapaInvestigationActiveAdvisoryModelOutput } from "../ai/capa-investigation-active-advisory-output-validator";
import { CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT, CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION } from "../ai/capa-investigation-active-advisory-agent-gate";
import { CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION } from "../ai/capa-ai-generation-trace";
import { CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION, createCapaInvestigationActiveAdvisoryReferenceManifest, validateCapaInvestigationActiveAdvisoryModelSafeContext, validateCapaInvestigationActiveAdvisoryReferenceManifest } from "../ai/capa-investigation-active-advisory-reference-manifest";
import type { CapaInvestigationActiveAdvisoryOutputRecord } from "../../database/repositories/capa-investigation-active-advisory-output-repository";
import type { CapaInvestigationActiveAdoptionCategory, CapaInvestigationActiveResolvedReferenceBinding } from "../ai/capa-investigation-active-adoption-contract";
import type { CapaInvestigationActiveAdvisoryReferenceManifestEntry } from "../ai/capa-investigation-active-advisory-context";

export type CapaInvestigationActiveAdvisorySourceProposal =
  CapaInvestigationActiveAdvisoryProposal["evidence_gaps"][number] |
  CapaInvestigationActiveAdvisoryProposal["conflicting_information"][number] |
  CapaInvestigationActiveAdvisoryProposal["assumptions"][number] |
  CapaInvestigationActiveAdvisoryProposal["causal_hypotheses"][number] |
  CapaInvestigationActiveAdvisoryProposal["alternative_hypotheses"][number] |
  CapaInvestigationActiveAdvisoryProposal["investigation_recommendations"][number];

export interface CapaInvestigationActiveAdoptionSourceResolution {
  readonly status: "resolved";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly output_id: CapaAiOutputId;
  readonly selected_proposals: readonly {
    readonly proposal_key: string;
    readonly proposal_category: CapaInvestigationActiveAdoptionCategory;
    readonly source_proposal: CapaInvestigationActiveAdvisorySourceProposal;
    readonly resolved_reference_bindings: readonly CapaInvestigationActiveResolvedReferenceBinding[];
  }[];
  readonly reference_manifest_schema_version: string;
  readonly reference_manifest_fingerprint_algorithm: string;
  readonly reference_manifest_sha256: string;
}
export type CapaInvestigationActiveAdoptionSourceResolutionResult = CapaInvestigationActiveAdoptionSourceResolution | { readonly status: "output_not_found_or_not_authorized" } | { readonly status: "output_not_adoptable" };
export interface CapaInvestigationActiveAdoptionSourceResolver {
  resolve(input: { readonly organization_id: OrganizationId; readonly capa_case_id: CapaCaseId; readonly expected_case_version_id: CapaCaseVersionId; readonly expected_record_version: number; readonly output_id: CapaAiOutputId; readonly proposal_keys: readonly string[] }): Promise<CapaInvestigationActiveAdoptionSourceResolutionResult>;
}
export type CapaInvestigationActiveAdoptionSourceManifestEntry = CapaInvestigationActiveAdvisoryReferenceManifestEntry;
export interface CapaInvestigationActiveAdvisoryOutputReader { findById(organizationId: string, outputId: string): Promise<CapaInvestigationActiveAdvisoryOutputRecord | null>; }

function refs(response: ReturnType<typeof validateCapaInvestigationActiveAdvisoryModelOutput>): readonly { readonly key: string; readonly relationship: "related" | "conflicting" | "supporting" | "contradictory" }[] {
  const result: { key: string; relationship: "related" | "conflicting" | "supporting" | "contradictory" }[] = [];
  for (const item of response.proposal.evidence_gaps) result.push(...item.related_reference_keys.map((key) => ({ key, relationship: "related" as const })));
  for (const item of response.proposal.conflicting_information) result.push(...item.conflicting_reference_keys.map((key) => ({ key, relationship: "conflicting" as const })));
  for (const item of response.proposal.assumptions) result.push(...item.related_reference_keys.map((key) => ({ key, relationship: "related" as const })));
  for (const item of response.proposal.causal_hypotheses) result.push(...item.supporting_reference_keys.map((key) => ({ key, relationship: "supporting" as const })), ...item.contradictory_reference_keys.map((key) => ({ key, relationship: "contradictory" as const })));
  for (const item of response.proposal.alternative_hypotheses) result.push(...item.supporting_reference_keys.map((key) => ({ key, relationship: "supporting" as const })), ...item.contradictory_reference_keys.map((key) => ({ key, relationship: "contradictory" as const })));
  for (const item of response.proposal.investigation_recommendations) result.push(...item.related_reference_keys.map((key) => ({ key, relationship: "related" as const })));
  return result;
}
function candidates(response: ReturnType<typeof validateCapaInvestigationActiveAdvisoryModelOutput>): readonly { readonly key: string; readonly category: CapaInvestigationActiveAdoptionCategory; readonly proposal: CapaInvestigationActiveAdvisorySourceProposal; readonly references: readonly { readonly key: string; readonly relationship: "related" | "conflicting" | "supporting" | "contradictory" }[] }[] {
  const result: { key: string; category: CapaInvestigationActiveAdoptionCategory; proposal: CapaInvestigationActiveAdvisorySourceProposal; references: readonly { key: string; relationship: "related" | "conflicting" | "supporting" | "contradictory" }[] }[] = [];
  for (const proposal of response.proposal.evidence_gaps) result.push({ key: proposal.proposal_key, category: "evidence_gap", proposal, references: proposal.related_reference_keys.map((key) => ({ key, relationship: "related" as const })) });
  for (const proposal of response.proposal.conflicting_information) result.push({ key: proposal.proposal_key, category: "conflicting_information", proposal, references: proposal.conflicting_reference_keys.map((key) => ({ key, relationship: "conflicting" as const })) });
  for (const proposal of response.proposal.assumptions) result.push({ key: proposal.proposal_key, category: "assumption", proposal, references: proposal.related_reference_keys.map((key) => ({ key, relationship: "related" as const })) });
  for (const proposal of response.proposal.causal_hypotheses) result.push({ key: proposal.proposal_key, category: "causal_hypothesis", proposal, references: [...proposal.supporting_reference_keys.map((key) => ({ key, relationship: "supporting" as const })), ...proposal.contradictory_reference_keys.map((key) => ({ key, relationship: "contradictory" as const }))] });
  for (const proposal of response.proposal.alternative_hypotheses) result.push({ key: proposal.proposal_key, category: "alternative_hypothesis", proposal, references: [...proposal.supporting_reference_keys.map((key) => ({ key, relationship: "supporting" as const })), ...proposal.contradictory_reference_keys.map((key) => ({ key, relationship: "contradictory" as const }))] });
  for (const proposal of response.proposal.investigation_recommendations) result.push({ key: proposal.proposal_key, category: "investigation_recommendation", proposal, references: proposal.related_reference_keys.map((key) => ({ key, relationship: "related" as const })) });
  return result;
}

export class RepositoryCapaInvestigationActiveAdoptionSourceResolver implements CapaInvestigationActiveAdoptionSourceResolver {
  constructor(private readonly reader: CapaInvestigationActiveAdvisoryOutputReader) {}
  async resolve(input: Parameters<CapaInvestigationActiveAdoptionSourceResolver["resolve"]>[0]): Promise<CapaInvestigationActiveAdoptionSourceResolutionResult> {
    if (new Set(input.proposal_keys).size !== input.proposal_keys.length) return { status: "output_not_adoptable" };
    const output = await this.reader.findById(input.organization_id, input.output_id);
    if (output === null) return { status: "output_not_found_or_not_authorized" };
    const response = output.response;
    if (output.organization_id !== input.organization_id || output.capa_case_id !== input.capa_case_id || output.case_version_id !== input.expected_case_version_id || output.record_version !== input.expected_record_version || response.output_id !== input.output_id || response.status !== "completed_draft" || response.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || response.advisory_only !== true || response.workflow_mutated !== false || response.human_acceptance_required !== true) return { status: "output_not_adoptable" };
    let validated: ReturnType<typeof validateCapaInvestigationActiveAdvisoryModelOutput>;
    try { validated = validateCapaInvestigationActiveAdvisoryModelOutput(JSON.stringify({ proposal: response.proposal, uncertainty_and_limitations: response.uncertainty_and_limitations, citations: response.citations, advisory_only: response.advisory_only, workflow_mutated: response.workflow_mutated, human_acceptance_required: response.human_acceptance_required })); } catch { return { status: "output_not_adoptable" }; }
    try {
      const trace = output.generation_trace;
      const packageValue = trace.package;
      if (trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION || trace.store !== false || packageValue.package_schema_version !== "capa-investigation-active-prompt-package-1.0.0" || packageValue.agent.agent_id !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id || packageValue.agent.agent_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version || packageValue.generation_contract.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION || packageValue.generation_contract.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || packageValue.scope.organization_id !== input.organization_id || packageValue.scope.capa_case_id !== input.capa_case_id || packageValue.scope.case_version_id !== input.expected_case_version_id || packageValue.scope.record_version !== input.expected_record_version || packageValue.scope.workflow_state !== "S40") return { status: "output_not_adoptable" };
      const modelSafe = validateCapaInvestigationActiveAdvisoryModelSafeContext(packageValue.context_provenance.model_safe_context);
      const manifest = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest: output.reference_manifest.document.entries, model_safe_context: modelSafe });
      validateCapaInvestigationActiveAdvisoryReferenceManifest(output.reference_manifest.document, modelSafe);
      if (manifest.reference_manifest_sha256 !== output.reference_manifest.reference_manifest_sha256 || output.reference_manifest.fingerprint_algorithm !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM || output.reference_manifest.document.manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION) return { status: "output_not_adoptable" };
      const byKey = new Map(manifest.document.entries.map((entry) => [entry.reference_key, entry]));
      if (refs(validated).some((reference) => !byKey.has(reference.key as never))) return { status: "output_not_adoptable" };
      const allCandidates = candidates(validated);
      const selected = input.proposal_keys.map((key) => {
        const matches = allCandidates.filter((candidate) => candidate.key === key);
        if (matches.length !== 1) return null;
        const candidate = matches[0]!;
        const bindings = candidate.references.map((reference) => {
          const entry = byKey.get(reference.key as never);
          return entry === undefined ? null : { reference_key: entry.reference_key, relationship: reference.relationship, trust: entry.trust, source_kind: entry.source_kind, source_id: entry.source_id };
        });
        return bindings.some((binding) => binding === null) ? null : { proposal_key: candidate.key, proposal_category: candidate.category, source_proposal: candidate.proposal, resolved_reference_bindings: bindings as CapaInvestigationActiveAdoptionSourceResolution["selected_proposals"][number]["resolved_reference_bindings"] };
      });
      return selected.some((item) => item === null) ? { status: "output_not_adoptable" } : { status: "resolved", organization_id: input.organization_id, capa_case_id: input.capa_case_id, case_version_id: input.expected_case_version_id, record_version: input.expected_record_version, output_id: input.output_id, selected_proposals: selected as NonNullable<typeof selected[number]>[], reference_manifest_schema_version: manifest.document.manifest_schema_version, reference_manifest_fingerprint_algorithm: manifest.fingerprint_algorithm, reference_manifest_sha256: manifest.reference_manifest_sha256 };
    } catch { return { status: "output_not_adoptable" }; }
  }
}
