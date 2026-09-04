import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-profile";
import {
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION,
  fingerprintCanonicalJson,
} from "../../lib/capa/ai/capa-ai-generation-trace";
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

const secondValidOutput = JSON.stringify({
  proposal: {
    investigation_questions: [],
    evidence_requests: [],
    method_suggestions: [],
    dependencies: [],
    proposed_owner_role: [],
    gaps: [
      {
        gap: "The approved scope does not identify an evidence custodian.",
        human_review_question:
          "Should the team identify an evidence custodian?",
      },
    ],
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
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.trace.package.trace.run_id).toBe(runId);
    expect(result.trace.trace_schema_version).toBe(
      CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
    );
    expect(result.trace.package.package_schema_version).toBe(
      CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION,
    );
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

  it("retries one controlled validation failure with the exact same governed input", async () => {
    const subject = fixture();
    subject.model_client.generateStructured
      .mockResolvedValueOnce({ output_text: "{}" })
      .mockResolvedValueOnce({ output_text: secondValidOutput });

    const result = await generate(subject, "Review the accepted scope");

    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(2);
    const firstInput = subject.model_client.generateStructured.mock.calls[0]?.[0];
    const secondInput = subject.model_client.generateStructured.mock.calls[1]?.[0];
    expect(secondInput).toBe(firstInput);
    expect(secondInput).toEqual(firstInput);
    expect(result.response.proposal).toMatchObject({
      gaps: [
        {
          gap: "The approved scope does not identify an evidence custodian.",
          human_review_question:
            "Should the team identify an evidence custodian?",
        },
      ],
    });
    expect(result.trace.package.trace).toMatchObject({
      run_id: runId,
      prompt_package_id: promptPackageId,
      request_id: requestId,
      correlation_id: correlationId,
      assembled_at: assembledAt,
    });
    expect(result.trace.trace_schema_version).toBe(
      CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
    );
    expect(result.trace.package.package_schema_version).toBe(
      CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION,
    );
    expect(result.trace.fingerprints.prompt_package_sha256).toBe(
      fingerprintCanonicalJson(result.trace.package),
    );
    expect(result.trace.fingerprints.rendered_prompt_sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result.trace).not.toHaveProperty("attempt");
    expect(result.trace.package).not.toHaveProperty("attempt");
    expect(subject.createRunId).toHaveBeenCalledTimes(1);
    expect(subject.createPromptPackageId).toHaveBeenCalledTimes(1);
    expect(subject.now).toHaveBeenCalledTimes(1);
    expect(subject.createOutputId).toHaveBeenCalledTimes(1);
    expect(subject.createOutputId.mock.invocationCallOrder[0]).toBeGreaterThan(
      subject.model_client.generateStructured.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it("rethrows the second controlled validation failure without a third model call", async () => {
    const subject = fixture("{}");

    await expect(generate(subject)).rejects.toMatchObject({
      name: "CapaInvestigationPlanAdvisoryOutputValidationError",
      reason_code: "MISSING_MODEL_OUTPUT_FIELD",
    });
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(2);
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it("does not retry model-client failures", async () => {
    const subject = fixture();
    const transportError = new Error("provider failure");
    subject.model_client.generateStructured.mockRejectedValueOnce(transportError);

    await expect(generate(subject)).rejects.toBe(transportError);
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(1);
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it("propagates a second model-client failure after one controlled validation retry", async () => {
    const subject = fixture();
    const transportError = new Error("second provider failure");
    subject.model_client.generateStructured
      .mockResolvedValueOnce({ output_text: "{}" })
      .mockRejectedValueOnce(transportError);

    await expect(generate(subject)).rejects.toBe(transportError);
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(2);
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it("does not create output identity when setup, trace, or provider fails", async () => {
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
    expect(providerFailure.model_client.generateStructured).toHaveBeenCalledTimes(1);
    expect(providerFailure.createOutputId).not.toHaveBeenCalled();
  });
});
