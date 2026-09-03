import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-profile";
import {
  CapaInvestigationPlanningAdvisoryModelGenerator,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-generator";
import type {
  CapaAiOutputId,
  CapaAiRunId,
  CapaPromptPackageId,
} from "../../lib/capa/ai/capa-prompt-contract";
import type {
  CorrelationId,
  IsoDateTime,
  RequestId,
} from "../../lib/capa/domain/capa-types";

const runId = "run-1" as CapaAiRunId;
const promptPackageId = "prompt-package-1" as CapaPromptPackageId;
const outputId = "output-1" as CapaAiOutputId;
const requestId = "request-1" as RequestId;
const correlationId = "correlation-1" as CorrelationId;
const assembledAt = "2026-09-01T00:00:00.000Z" as IsoDateTime;

const context: any = {
  authoritative: {
    trust: "authoritative_server_context",
    organization_id: "organization-1",
    capa_case_id: "case-1",
    case_version_id: "version-1",
    record_version: 2,
    workflow_state: "S30",
    actor: "user-1",
    active_roles: [],
    intake_scope: {
      initiating_event: "event",
      source: { source_type: "NCR", source_reference: null },
      organization_reference: "ORG-1",
    },
    accepted_scope: {},
    accepted_containment_risk: {},
  },
  untrusted_human_draft: null,
};

const validOutput = JSON.stringify({
  proposal: {
    investigation_questions: [],
    evidence_requests: [],
    method_suggestions: [],
    dependencies: [],
    proposed_owner_role: [],
    gaps: [],
  },
  assumptions: [],
  uncertainty_and_limitations: [],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
});

function fixture(output = validOutput) {
  const events: string[] = [];
  const model_client = {
    generateStructured: vi.fn(async (input) => {
      events.push("provider");
      return { output_text: input.prompt.length > 0 ? output : output };
    }),
  };
  const createRunId = vi.fn(() => {
    events.push("run-id");
    return runId;
  });
  const createPromptPackageId = vi.fn(() => {
    events.push("prompt-package-id");
    return promptPackageId;
  });
  const now = vi.fn(() => {
    events.push("clock");
    return assembledAt;
  });
  const createOutputId = vi.fn(() => {
    events.push("output-id");
    return outputId;
  });
  const generator = new CapaInvestigationPlanningAdvisoryModelGenerator({
    model_client: model_client as any,
    createRunId,
    createPromptPackageId,
    now,
    createOutputId,
  });

  return {
    generator,
    model_client,
    createRunId,
    createPromptPackageId,
    now,
    createOutputId,
    events,
  };
}

function generate(subject: ReturnType<typeof fixture>, focus: string | null = null) {
  return subject.generator.generate({
    context,
    focus,
    request_id: requestId,
    correlation_id: correlationId,
  });
}

describe("S30 investigation-planning advisory model generator", () => {
  it("returns a frozen completed draft and invokes the exact CS3A boundary", async () => {
    const subject = fixture();
    const result = await generate(subject, "Review the accepted scope");

    expect(result.response).toMatchObject({
      run_id: runId,
      output_id: outputId,
      output_schema_version: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      proposal: {
        investigation_questions: [],
        evidence_requests: [],
        method_suggestions: [],
        dependencies: [],
        proposed_owner_role: [],
        gaps: [],
      },
      assumptions: [],
      uncertainty_and_limitations: [],
      citations: [],
      warnings: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    });
    expect(subject.model_client.generateStructured).toHaveBeenCalledWith({
      prompt: expect.any(String),
      model_profile_version:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      store: false,
    });
    expect(result.trace.package.trace.run_id).toBe(runId);
    expect(Object.isFrozen(result.response)).toBe(true);
    expect(Object.isFrozen(result.response.proposal)).toBe(true);
    expect(Object.isFrozen(result.response.assumptions)).toBe(true);
    expect(Object.isFrozen(result.response.citations)).toBe(true);
    expect(Object.isFrozen(result.response.warnings)).toBe(true);
    expect(subject.createRunId).toHaveBeenCalledTimes(1);
    expect(subject.createPromptPackageId).toHaveBeenCalledTimes(1);
    expect(subject.now).toHaveBeenCalledTimes(1);
    expect(subject.createOutputId).toHaveBeenCalledTimes(1);
    expect(subject.events).toEqual([
      "run-id",
      "prompt-package-id",
      "clock",
      "provider",
      "output-id",
    ]);
  });

  it("does not create output identity when setup, trace, provider, or validation fails", async () => {
    for (const factory of ["createRunId", "createPromptPackageId", "now"] as const) {
      const subject = fixture();
      subject[factory].mockImplementation(() => {
        throw new Error("setup failure");
      });
      await expect(generate(subject)).rejects.toThrow("setup failure");
      expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
      expect(subject.createOutputId).not.toHaveBeenCalled();
    }

    const oversizedPrompt = fixture();
    await expect(generate(oversizedPrompt, "x".repeat(121_000))).rejects.toThrow(
      "CONTROLLED_CAPA_PROMPT_INVALID",
    );
    expect(oversizedPrompt.model_client.generateStructured).not.toHaveBeenCalled();
    expect(oversizedPrompt.createOutputId).not.toHaveBeenCalled();

    const traceFailure = fixture();
    const malformedContext = {
      ...context,
      authoritative: { ...context.authoritative, actor: undefined },
    };
    await expect(
      traceFailure.generator.generate({
        context: malformedContext,
        request_id: requestId,
        correlation_id: correlationId,
      }),
    ).rejects.toThrow();
    expect(traceFailure.model_client.generateStructured).not.toHaveBeenCalled();
    expect(traceFailure.createOutputId).not.toHaveBeenCalled();

    const providerFailure = fixture();
    providerFailure.model_client.generateStructured.mockRejectedValue(
      new Error("provider failure"),
    );
    await expect(generate(providerFailure)).rejects.toThrow("provider failure");
    expect(providerFailure.createOutputId).not.toHaveBeenCalled();

    const invalidOutput = fixture("{}");
    await expect(generate(invalidOutput)).rejects.toThrow();
    expect(invalidOutput.model_client.generateStructured).toHaveBeenCalledTimes(1);
    expect(invalidOutput.createOutputId).not.toHaveBeenCalled();
  });
});
