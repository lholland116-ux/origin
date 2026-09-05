import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-investigation-active-advisory-contract";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-active-advisory-model-profile";
import {
  CapaInvestigationActiveAdvisoryModelGenerator,
  CapaInvestigationActiveAdvisoryReferenceMembershipError,
} from "../../lib/capa/ai/capa-investigation-active-advisory-model-generator";
import {
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_PROMPT_PACKAGE_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-ai-generation-trace";

const validOutput = {
  proposal: {
    evidence_gaps: [],
    conflicting_information: [],
    assumptions: [],
    causal_hypotheses: [],
    alternative_hypotheses: [],
    investigation_recommendations: [],
  },
  uncertainty_and_limitations: [],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
};

function outputWithReference(referenceKey: string) {
  return {
    ...validOutput,
    proposal: {
      ...validOutput.proposal,
      evidence_gaps: [
        {
          proposal_key: "P1",
          gap: "The retained record is incomplete",
          why_it_matters: "The causal analysis remains incomplete",
          related_reference_keys: [referenceKey],
          recommended_next_step: "Obtain the retained record",
          human_review_question: "What record should the team obtain?",
        },
      ],
    },
  };
}

const context: any = {
  authoritative: {
    organization_id: "organization-secret",
    capa_case_id: "case-secret",
    case_version_id: "version-secret",
    record_version: 4,
  },
  reference_manifest: [
    {
      reference_key: "R1",
      source_id: "INV-SECRET-ITEM-ID",
      source_kind: "investigation_plan_item",
      trust: "authoritative_server_context",
    },
  ],
  model_safe_context: {
    trust: "model_safe_context",
    workflow_state: "S40",
    references: [
      {
        reference_key: "R1",
        trust: "authoritative_server_context",
        source_kind: "investigation_plan_item",
        investigation_question: "What caused the deviation?",
        evidence_target: "Batch record",
        investigation_method: "Record review",
        scope_relationship: "Accepted scope",
        status: "in_progress",
        disposition: null,
        disposition_rationale: null,
      },
    ],
  },
};

function fixture(rawOutput: unknown = validOutput) {
  const model_client = {
    generateStructured: vi.fn().mockResolvedValue({
      output_text:
        typeof rawOutput === "string"
          ? rawOutput
          : JSON.stringify(rawOutput),
    }),
  };
  const createOutputId = vi.fn(() => "output-1" as never);
  const generator = new CapaInvestigationActiveAdvisoryModelGenerator({
    model_client: model_client as never,
    createRunId: () => "run-1" as never,
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

describe("S40 investigation-active advisory model generator", () => {
  it("generates an advisory-only response using only model-safe context", async () => {
    const subject = fixture(outputWithReference("R1"));
    const result = await generate(subject);

    expect(result.response).toMatchObject({
      run_id: "run-1",
      output_id: "output-1",
      output_schema_version:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    });
    expect(subject.createOutputId).toHaveBeenCalledTimes(1);
    expect(subject.model_client.generateStructured).toHaveBeenCalledWith({
      prompt: expect.any(String),
      model_profile_version:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      store: false,
    });
    const prompt = subject.model_client.generateStructured.mock.calls[0]![0]
      .prompt;
    expect(prompt).toContain("R1");
    expect(prompt).not.toContain("INV-SECRET-ITEM-ID");
    expect(prompt).not.toContain("organization-secret");
    expect(prompt).not.toContain("case-secret");
    expect(result.trace.rendered_prompt).toBe(prompt);
    expect(result.trace.rendered_prompt).not.toContain("INV-SECRET-ITEM-ID");
    expect(result.trace.rendered_prompt).not.toContain("organization-secret");
    expect(result.trace.rendered_prompt).not.toContain("case-secret");
    expect(JSON.stringify(result.trace.package.context_provenance)).not.toContain(
      "INV-SECRET-ITEM-ID",
    );
    expect(result.trace.trace_schema_version).toBe(
      CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
    );
    expect(result.trace.package.package_schema_version).toBe(
      CAPA_INVESTIGATION_ACTIVE_PROMPT_PACKAGE_SCHEMA_VERSION,
    );
    expect(result.trace.package.generation_contract).toMatchObject({
      operation: "facilitate_root_cause",
      requested_output: "investigation_analysis_draft",
    });
  });

  it("fails closed when the model invents an R# reference", async () => {
    const subject = fixture(outputWithReference("R9"));

    await expect(generate(subject)).rejects.toBeInstanceOf(
      CapaInvestigationActiveAdvisoryReferenceMembershipError,
    );
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "wrong advisory flags",
      { ...validOutput, workflow_mutated: true },
    ],
    ["model-generated citations", { ...validOutput, citations: ["R1"] }],
    [
      "root-cause confirmation language",
      {
        ...outputWithReference("R1"),
        proposal: {
          ...outputWithReference("R1").proposal,
          evidence_gaps: [
            {
              ...outputWithReference("R1").proposal.evidence_gaps[0],
              gap: "The root cause is confirmed",
            },
          ],
        },
      },
    ],
  ])("fails closed for %s", async (_name, rawOutput) => {
    const subject = fixture(rawOutput);

    await expect(generate(subject)).rejects.toThrow();
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });
});
