import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CAPA_INTAKE_ADVISORY_AGENT,
  type CapaIntakeAdvisoryGenerationInput,
} from "../../lib/capa/ai/capa-intake-advisory-service";

import {
  CAPA_INTAKE_ADVISORY_JSON_SCHEMA,
  CAPA_INTAKE_ADVISORY_MODEL_PROFILE,
  createCapaIntakeAdvisoryModelGenerator,
  type CapaIntakeAdvisoryModelGeneratorDependencies,
} from "../../lib/capa/ai/capa-intake-advisory-model-generator";

function modelOutput(): string {
  return JSON.stringify({
    proposal: {
      problem_statement_draft:
        "A controlled discrepancy requires human review.",
      scope_dimensions: ["training"],
      missing_dimensions: ["extent"],
      containment_risk_questions: [
        "Is containment needed?",
      ],
      investigation_questions: [
        "What evidence is available?",
      ],
    },
    assumptions: [],
    missing_information: ["extent"],
    conflicts_and_alternatives: [],
    uncertainty_and_limitations: [],
    human_action_required: [
      "Review and edit the draft.",
    ],
    warnings: ["Model warning"],
  });
}

const input = {
  context: {
    organization_id: "org-1",
    capa_case_id: "case-1",
    case_version_id: "version-1",
    record_version: 2,
    workflow_state: "S10",
    user_id: "user-1",
    active_role_ids: ["CAPA_OWNER"],
    minimum_case_context: [],
  },
  request: {
    requested_output:
      "intake_analysis",
    focus: null,
  },
  evidence: {
    prompt_context: [],
    citations: [],
    warnings: ["Evidence warning"],
  },
  request_id: "request-1",
  correlation_id: "correlation-1",
  agent: CAPA_INTAKE_ADVISORY_AGENT,
} as unknown as CapaIntakeAdvisoryGenerationInput;

function promptPackage(
  runId = "run-1",
): import("../../lib/capa/ai/capa-prompt-contract").CapaControlledPromptPackage {
  return {
    scope: {
      organization_id:
        "org-1",
      capa_case_id:
        "case-1",
      case_version_id:
        "version-1",
      record_version: 2,
      workflow_state: "S10",
    },

    trace: {
      run_id:
        runId,
      prompt_package_id:
        "prompt-package-1",
      request_id:
        "request-1",
      correlation_id:
        "correlation-1",
      assembled_at:
        "2026-08-27T12:00:00.000Z",
    },

    agent: {
      agent_id:
        CAPA_INTAKE_ADVISORY_AGENT
          .agent_id,
      agent_version:
        CAPA_INTAKE_ADVISORY_AGENT
          .agent_version,
      output_type:
        CAPA_INTAKE_ADVISORY_AGENT
          .output_schema_version,
    },

    component_versions: {
      model_profile_version:
        "capa-model-profile-1.0.0",
      output_schema_version:
        CAPA_INTAKE_ADVISORY_AGENT
          .output_schema_version,
    },

    layers: [],
    reduction_applied: false,
  } as unknown as
    import("../../lib/capa/ai/capa-prompt-contract")
      .CapaControlledPromptPackage;
}

function dependencies():
  CapaIntakeAdvisoryModelGeneratorDependencies {
  return {
    prompt_renderer: {
      build: vi.fn().mockReturnValue({
        prompt_package:
          promptPackage(),

        rendered_prompt:
          "controlled rendered prompt",
      }),
    },
    model_client: {
      generateStructured:
        vi.fn().mockResolvedValue({
          output_text: modelOutput(),
        }),
    },
    id_factory: {
      createRunId: vi.fn().mockReturnValue(
        "run-1",
      ),
      createOutputId:
        vi.fn().mockReturnValue("output-1"),
    },
  } as unknown as
    CapaIntakeAdvisoryModelGeneratorDependencies;
}

describe(
  "CAPA intake advisory model generator",
  () => {
    it("publishes a fixed controlled model profile", () => {
      expect(
        CAPA_INTAKE_ADVISORY_MODEL_PROFILE,
      ).toEqual({
        profile_version:
          "capa-model-profile-1.0.0",
        output_schema_name:
          "capa_intake_advisory_1_0_0",
        maximum_output_characters:
          30_000,
        store_provider_response: false,
      });
    });

    it("invokes only the strict structured model boundary", async () => {
      const ports = dependencies();
      await createCapaIntakeAdvisoryModelGenerator(
        ports,
      ).generate(input);

      expect(
        ports.model_client
          .generateStructured,
      ).toHaveBeenCalledWith({
        model_profile_version:
          "capa-model-profile-1.0.0",
        prompt: "controlled rendered prompt",
        output_schema_name:
          "capa_intake_advisory_1_0_0",
        output_schema:
          CAPA_INTAKE_ADVISORY_JSON_SCHEMA,
        maximum_output_characters:
          30_000,
        store: false,
      });
    });

    it("uses one server-controlled run identity for the prompt trace and response", async () => {
      const ports = dependencies();

      const result =
        await createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input);

      expect(
        ports.id_factory.createRunId,
      ).toHaveBeenCalledTimes(1);

      expect(
        ports.prompt_renderer.build,
      ).toHaveBeenCalledTimes(1);

      expect(
        ports.prompt_renderer.build,
      ).toHaveBeenCalledWith({
        generation_input: input,
        run_id: "run-1",
      });

      expect(
        result.response.run_id,
      ).toBe(
        "run-1",
      );

      expect(
        result.trace.prompt_package
          .trace.run_id,
      ).toBe(
        "run-1",
      );

      expect(
        result.trace.rendered_prompt,
      ).toBe(
        "controlled rendered prompt",
      );

      expect(
        result.trace
          .model_profile_version,
      ).toBe(
        "capa-model-profile-1.0.0",
      );
    });

    it("fails closed when the prompt package is bound to a different run", async () => {
      const ports = dependencies();

      vi.mocked(
        ports.prompt_renderer.build,
      ).mockReturnValue({
        prompt_package:
          promptPackage(
            "different-run",
          ),

        rendered_prompt:
          "controlled rendered prompt",
      });

      await expect(
        createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input),
      ).rejects.toThrow(
        "CONTROLLED_CAPA_PROMPT_TRACE_INVALID",
      );

      expect(
        ports.model_client
          .generateStructured,
      ).not.toHaveBeenCalled();
    });

    it("constructs an advisory-only response", async () => {
      const ports = dependencies();
      const result =
        await createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input);

      expect(
        result.response,
      ).toMatchObject({
        run_id: "run-1",
        output_id: "output-1",
        output_schema_version:
          "capa-intake-draft-output-1.0.0",
        status: "completed_draft",
        advisory_only: true,
        workflow_mutated: false,
        human_acceptance_required: true,
        warnings: [
          "Evidence warning",
          "Model warning",
        ],
      });
    });

    it("does not allow the model to create citation identities", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.model_client
          .generateStructured,
      ).mockResolvedValue({
        output_text: JSON.stringify({
          ...JSON.parse(modelOutput()),
          citations: ["fabricated"],
        }),
      });

      await expect(
        createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input),
      ).rejects.toMatchObject({
        reason_code:
          "UNSUPPORTED_MODEL_OUTPUT_FIELD",
      });
    });

    it("rejects an empty controlled prompt", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.prompt_renderer.build,
      ).mockReturnValue({
        prompt_package:
          promptPackage(),

        rendered_prompt:
          "   ",
      });

      await expect(
        createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input),
      ).rejects.toThrow(
        "CONTROLLED_CAPA_PROMPT_INVALID",
      );
      expect(
        ports.model_client
          .generateStructured,
      ).not.toHaveBeenCalled();
    });

    it("rejects an oversized controlled prompt", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.prompt_renderer.build,
      ).mockReturnValue({
        prompt_package:
          promptPackage(),

        rendered_prompt:
          "x".repeat(120_001),
      });

      await expect(
        createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input),
      ).rejects.toThrow(
        "CONTROLLED_CAPA_PROMPT_INVALID",
      );
    });

    it("propagates fail-closed structured-output validation", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.model_client
          .generateStructured,
      ).mockResolvedValue({
        output_text: "not-json",
      });

      await expect(
        createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input),
      ).rejects.toMatchObject({
        reason_code:
          "MODEL_OUTPUT_NOT_JSON",
      });
    });

    it("does not call the provider when prompt rendering fails", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.prompt_renderer.build,
      ).mockImplementation(() => {
        throw new Error("render failure");
      });

      await expect(
        createCapaIntakeAdvisoryModelGenerator(
          ports,
        ).generate(input),
      ).rejects.toThrow("render failure");
      expect(
        ports.model_client
          .generateStructured,
      ).not.toHaveBeenCalled();
    });
  },
);
