import { describe, expect, it, vi } from "vitest";

import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-contract";
import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_POLICY_MANIFEST_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_PROMPT_PACKAGE_SCHEMA_VERSION,
  fingerprintCanonicalJson,
  sha256Utf8,
} from "../../lib/capa/ai/capa-ai-generation-trace";
import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE,
  CapaRootCauseReviewAdvisoryModelGenerator,
  CapaRootCauseReviewAdvisoryReferenceMembershipError,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-model-generator";

const validOutput = {
  schema_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  status: "completed_draft",
  proposal: {
    neutral_review_summary:
      "The submitted package is available for human review.",
    version_changes: [],
    blockers_warnings: [],
    evidence_map: [],
  },
  uncertainty_and_limitations: [],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  controlled_record_mutated: false,
  review_disposition: null,
  workflow_transition: null,
  human_acceptance_required: true,
};

const context: any = {
  authoritative: {
    organization_id: "organization-secret",
    capa_case_id: "case-secret",
    case_version_id: "version-secret",
    record_version: 4,
    workflow_state: "S50",
    case_version: {
      version_number: 4,
      parent_version_id: null,
      change_reason: "Root cause review",
    },
  },
  reference_manifest: [
    {
      reference_key: "R1",
      source_id: "E-1",
      source_kind: "ledger_item",
      trust: "authoritative_server_context",
      version_scope: "current",
    },
  ],
  model_safe_context: {
    trust: "model_safe_context",
    workflow_state: "S50",
    current_version_number: 4,
    comparison_version_number: null,
    current_section_versions: {
      investigation_ledger: "capa-evidence-assumption-ledger-1.0.0",
      root_cause_package: "capa-root-cause-package-1.0.0",
      investigation_plan: null,
    },
    comparison_section_versions: null,
    references: [
      {
        reference_key: "R1",
        trust: "authoritative_server_context",
        source_kind: "ledger_item",
        version_scope: "current",
        information_class: "verified_evidence",
        statement: "The controlled record reports parameter A.",
        evidence_status: "verified",
        assumption_status: null,
        gap_status: null,
        conflict_status: null,
        source_version: "source-v1",
        context: null,
        material_to_conclusion: true,
        critical_to_conclusion: false,
        recommended_next_step: null,
      },
    ],
  },
};

function fixture(rawOutput: unknown = validOutput, runId = "run-1") {
  const model_client = {
    generateStructured: vi.fn().mockResolvedValue({
      output_text:
        typeof rawOutput === "string"
          ? rawOutput
          : JSON.stringify(rawOutput),
    }),
  };
  const createOutputId = vi.fn(() => "output-1" as never);
  const generator = new CapaRootCauseReviewAdvisoryModelGenerator({
    model_client: model_client as never,
    createRunId: () => runId as never,
    createPromptPackageId: () => "package-1" as never,
    now: () => "2026-09-05T12:00:00.000Z" as never,
    createOutputId,
  });
  return { generator, model_client, createOutputId };
}

function generate(subject: ReturnType<typeof fixture>) {
  return subject.generator.generate({
    context,
    request_id: "request-1" as never,
    correlation_id: "correlation-1" as never,
  });
}

describe("S50 root-cause review advisory model generator", () => {
  it("uses the governed prompt/schema and returns the validated advisory output", async () => {
    const subject = fixture();
    const result = await generate(subject);

    expect(result.response).toMatchObject({
      run_id: "run-1",
      output_id: "output-1",
      output_schema_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      review_disposition: null,
      workflow_transition: null,
      human_acceptance_required: true,
    });
    expect(subject.model_client.generateStructured).toHaveBeenCalledWith({
      prompt: expect.any(String),
      model_profile_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
      maximum_output_characters: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
      store: false,
    });
    const prompt = subject.model_client.generateStructured.mock.calls[0]![0].prompt;
    expect(prompt).toContain("AG-REVIEW");
    expect(prompt).toContain("R1");
    expect(prompt).not.toContain("E-1");
    expect(prompt).not.toContain("organization-secret");
    expect(result.trace.rendered_prompt).toBe(prompt);
    expect(result.trace.package.agent).toEqual({
      agent_id: "AG-REVIEW",
      agent_version: "ag-review-1.0.0",
    });
    expect(result.trace.trace_schema_version).toBe(
      CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
    );
    expect(result.trace.package.package_schema_version).toBe(
      CAPA_ROOT_CAUSE_REVIEW_PROMPT_PACKAGE_SCHEMA_VERSION,
    );
    expect(result.trace.package.scope.workflow_state).toBe("S50");
    expect(result.trace.package.generation_contract).toMatchObject({
      operation: "assemble_review_packet",
      requested_output: "review_packet_draft",
      output_schema_version: "capa_review_packet_draft-1.0.0",
      model_profile_version:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
      store: false,
      maximum_output_characters:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
    });
    expect(result.trace.package.generation_contract.output_schema_sha256).toBe(
      fingerprintCanonicalJson(result.trace.output_schema),
    );
    expect(result.trace.package.context_provenance).toEqual({
      model_safe_context: context.model_safe_context,
    });
    expect(result.trace.package.governance).toEqual({
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      human_acceptance_required: true,
    });
    expect(result.trace.evidence_manifest).toEqual({
      evidence_manifest_schema_version:
        CAPA_ROOT_CAUSE_REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION,
      retrieval_performed: false,
      item_count: 0,
      items: [],
    });
    expect(result.trace.policy_manifest).toMatchObject({
      policy_manifest_schema_version:
        CAPA_ROOT_CAUSE_REVIEW_POLICY_MANIFEST_SCHEMA_VERSION,
      agent: { agent_id: "AG-REVIEW", agent_version: "ag-review-1.0.0" },
      workflow_state: "S50",
      operation: "assemble_review_packet",
      requested_output: "review_packet_draft",
      output_schema_version: "capa_review_packet_draft-1.0.0",
      authority: {
        advisory_only: true,
        workflow_mutated: false,
        controlled_record_mutated: false,
        human_acceptance_required: true,
      },
    });
    expect(result.trace.policy_manifest.prohibitions).toEqual(
      expect.arrayContaining([
        "root-cause approval",
        "root-cause rejection",
        "authoritative root-cause confirmation",
        "G-04 approval",
        "review disposition",
        "workflow advancement",
        "S50 to S60 transition",
        "controlled-record mutation",
        "controlled-record signing",
        "reviewer impersonation",
        "approver impersonation",
        "authoritative evidence verification",
      ]),
    );
    expect(result.trace.fingerprints).toMatchObject({
      algorithm: CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
      rendered_prompt_sha256: sha256Utf8(result.trace.rendered_prompt),
      evidence_manifest_sha256: fingerprintCanonicalJson(
        result.trace.evidence_manifest,
      ),
      policy_manifest_sha256: fingerprintCanonicalJson(
        result.trace.policy_manifest,
      ),
      output_schema_sha256: fingerprintCanonicalJson(
        result.trace.output_schema,
      ),
      prompt_package_sha256: fingerprintCanonicalJson(result.trace.package),
    });
    expect(JSON.stringify(result.trace.package.context_provenance)).not.toContain(
      "E-1",
    );
    expect(subject.createOutputId).toHaveBeenCalledTimes(1);
  });

  it("binds the prompt-package fingerprint to governed package identity", async () => {
    const baseline = await generate(fixture());
    const changed = await generate(fixture(validOutput, "run-2"));

    expect(changed.trace.fingerprints.prompt_package_sha256).not.toBe(
      baseline.trace.fingerprints.prompt_package_sha256,
    );
  });

  it("fails closed for an invented reference or identifier", async () => {
    const unknownReference = {
      ...validOutput,
      proposal: {
        ...validOutput.proposal,
        evidence_map: [
          {
            mapping_key: "E1",
            subject: "Evidence",
            relationship: "supports",
            description: "The supplied reference supports the statement.",
            evidence_reference_keys: ["R9"],
            source_status: "not_established",
            authoritative_identifier: null,
            human_review_question: "Which reviewer should assess this evidence?",
          },
        ],
      },
    };
    const referenceSubject = fixture(unknownReference);
    await expect(generate(referenceSubject)).rejects.toBeInstanceOf(
      CapaRootCauseReviewAdvisoryReferenceMembershipError,
    );
    expect(referenceSubject.createOutputId).not.toHaveBeenCalled();

    const unknownIdentifier = {
      ...validOutput,
      proposal: {
        ...validOutput.proposal,
        version_changes: [
          {
            change_key: "V1",
            subject: "Package version",
            change_type: "modified",
            previous_value: "one",
            current_value: "two",
            authoritative_identifier: "invented-id",
            reference_keys: [],
            human_review_question: "Which version should a reviewer compare?",
          },
        ],
      },
    };
    const identifierSubject = fixture(unknownIdentifier);
    await expect(generate(identifierSubject)).rejects.toBeInstanceOf(
      CapaRootCauseReviewAdvisoryReferenceMembershipError,
    );
    expect(identifierSubject.createOutputId).not.toHaveBeenCalled();
  });

  it("propagates provider failure and deterministic output validation failure", async () => {
    const provider = fixture();
    provider.model_client.generateStructured.mockRejectedValue(new Error("provider-failure"));
    await expect(generate(provider)).rejects.toThrow("provider-failure");
    expect(provider.createOutputId).not.toHaveBeenCalled();

    const invalid = fixture({ ...validOutput, workflow_mutated: true });
    await expect(generate(invalid)).rejects.toThrow();
    expect(invalid.createOutputId).not.toHaveBeenCalled();
  });
});
