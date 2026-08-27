import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CAPA_INTAKE_ADVISORY_AGENT,
  CAPA_INTAKE_ADVISORY_OPERATION,
  CapaIntakeAdvisoryServiceError,
  createCapaIntakeAdvisoryService,
  type CapaIntakeAdvisoryCaseContext,
  type CapaIntakeAdvisoryInvocation,
  type CapaIntakeAdvisoryServiceDependencies,
} from "../../lib/capa/ai/capa-intake-advisory-service";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

const invocation = {
  organization_id: "org-1",
  capa_case_id:
    "10000000-0000-4000-8000-000000000001",
  user_id:
    "20000000-0000-4000-8000-000000000001",
  request_id:
    "30000000-0000-4000-8000-000000000001",
  correlation_id:
    "40000000-0000-4000-8000-000000000001",
  request: {
    requested_output:
      "intake_analysis" as const,
    focus: "Clarify containment risk.",
  },
} as const as CapaIntakeAdvisoryInvocation;

const context = {
  organization_id:
    invocation.organization_id,
  capa_case_id:
    invocation.capa_case_id,
  case_version_id:
    "50000000-0000-4000-8000-000000000001",
  record_version: 2,
  workflow_state: "S10" as const,
  user_id: invocation.user_id,
  active_role_ids: ["CAPA_OWNER"],
  minimum_case_context: [],
} as const as unknown as CapaIntakeAdvisoryCaseContext;

const response = {
  run_id:
    "60000000-0000-4000-8000-000000000001",
  output_id:
    "70000000-0000-4000-8000-000000000001",
  output_schema_version:
    "capa-intake-draft-output-1.0.0",
  status: "completed_draft",
  proposal: {
    problem_statement_draft:
      "A controlled intake draft.",
    scope_dimensions: ["training record"],
    missing_dimensions: ["extent"],
    containment_risk_questions: [
      "Is immediate containment required?",
    ],
    investigation_questions: [
      "How was the discrepancy detected?",
    ],
  },
  citations: [],
  assumptions: [],
  missing_information: ["extent"],
  conflicts_and_alternatives: [],
  uncertainty_and_limitations: [],
  human_action_required: [
    "Review and edit the advisory draft.",
  ],
  warnings: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
} as const as unknown as CapaIntakeAdvisoryResponse;

function dependencies():
  CapaIntakeAdvisoryServiceDependencies {
  return {
    context_resolver: {
      resolve: vi.fn().mockResolvedValue(
        context,
      ),
    },
    authorizer: {
      authorize: vi.fn().mockResolvedValue(
        true,
      ),
    },
    agent_gate: {
      evaluate: vi.fn().mockReturnValue(
        true,
      ),
    },
    evidence_provider: {
      retrieve: vi.fn().mockResolvedValue({
        prompt_context: [],
        citations: [],
        warnings: [],
      }),
    },
    generator: {
      generate: vi.fn().mockResolvedValue(
        response,
      ),
    },
    output_repository: {
      save: vi.fn().mockResolvedValue(
        "saved",
      ),
    },
    transaction_manager: {
      runInTransaction: vi.fn(
        async (
          requestTrace,
          work,
        ) =>
          work(
            Object.freeze({
              transaction_id:
                "80000000-0000-4000-8000-000000000001",
              started_at:
                "2026-08-25T12:00:00.000Z",
              request_trace:
                Object.freeze({
                  request_id:
                    requestTrace.request_id,
                  correlation_id:
                    requestTrace.correlation_id,
                  ...(requestTrace
                    .idempotency_key ===
                  undefined
                    ? {}
                    : {
                        idempotency_key:
                          requestTrace
                            .idempotency_key,
                      }),
                }),
            }) as never,
          ),
      ),
    },
    integrity_guard: {
      assertCaseUnchanged:
        vi.fn().mockResolvedValue(true),
    },
  };
}

function expectReason(
  operation: Promise<unknown>,
  reasonCode: string,
): Promise<void> {
  return expect(operation).rejects.toEqual(
    expect.objectContaining({
      name:
        "CapaIntakeAdvisoryServiceError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "CAPA intake advisory service",
  () => {
    it("publishes the exact controlled agent boundary", () => {
      expect(
        CAPA_INTAKE_ADVISORY_OPERATION,
      ).toBe("draft_intake_analysis");
      expect(
        CAPA_INTAKE_ADVISORY_AGENT,
      ).toEqual({
        agent_id: "AG-INTAKE",
        agent_version:
          "ag-intake-1.0.0",
        output_schema_version:
          "capa-intake-draft-output-1.0.0",
        requested_tool_ids: [
          "TOOL-CASE-READ",
          "TOOL-RETRIEVE",
          "TOOL-STRUCTURED-DRAFT",
        ],
      });
    });

    it("orchestrates a governed advisory without mutating workflow", async () => {
      const ports = dependencies();
      const result =
        await createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation);

      expect(
        result.advisory,
      ).toBe(
        response,
      );

      expect(
        result.snapshot,
      ).toEqual({
        capa_case_id:
          context.capa_case_id,

        case_version_id:
          context.case_version_id,

        record_version:
          context.record_version,
      });

      expect(
        Object.isFrozen(
          result,
        ),
      ).toBe(true);

      expect(
        Object.isFrozen(
          result.snapshot,
        ),
      ).toBe(true);

      expect(
        ports.transaction_manager
          .runInTransaction,
      ).toHaveBeenCalledWith(
        {
          request_id:
            invocation.request_id,
          correlation_id:
            invocation.correlation_id,
        },
        expect.any(Function),
      );

      expect(
        ports.output_repository.save,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_id:
            "80000000-0000-4000-8000-000000000001",
          started_at:
            "2026-08-25T12:00:00.000Z",
          request_trace:
            expect.objectContaining({
              request_id:
                invocation.request_id,
              correlation_id:
                invocation.correlation_id,
            }),
        }),
        {
          context,
          response,
          request_id:
            invocation.request_id,
          correlation_id:
            invocation.correlation_id,
        },
      );

      expect(
        ports.authorizer.authorize,
      ).toHaveBeenCalledWith({
        context,
        operation:
          "draft_intake_analysis",
      });
      expect(
        ports.agent_gate.evaluate,
      ).toHaveBeenCalledWith({
        context,
        agent:
          CAPA_INTAKE_ADVISORY_AGENT,
        operation:
          "draft_intake_analysis",
      });
      expect(
        ports.output_repository.save,
      ).toHaveBeenCalledOnce();
      expect(
        ports.integrity_guard
          .assertCaseUnchanged,
      ).toHaveBeenCalledWith(context);
    });

    it("passes only resolved context into generation", async () => {
      const ports = dependencies();
      await createCapaIntakeAdvisoryService(
        ports,
      ).advise(invocation);

      expect(
        ports.generator.generate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          request: invocation.request,
          request_id:
            invocation.request_id,
          correlation_id:
            invocation.correlation_id,
          agent:
            CAPA_INTAKE_ADVISORY_AGENT,
        }),
      );
    });

    it("fails closed when the case is unavailable", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.context_resolver.resolve,
      ).mockResolvedValue(null);

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      );
      expect(
        ports.generator.generate,
      ).not.toHaveBeenCalled();
    });

    for (const mismatch of [
      {
        organization_id: "other-org",
      },
      {
        capa_case_id:
          "80000000-0000-4000-8000-000000000001",
      },
      {
        user_id:
          "90000000-0000-4000-8000-000000000001",
      },
    ]) {
      it(`rejects resolved authority mismatch ${Object.keys(mismatch)[0]}`, async () => {
        const ports = dependencies();
        vi.mocked(
          ports.context_resolver.resolve,
        ).mockResolvedValue({
          ...context,
          ...mismatch,
        } as CapaIntakeAdvisoryCaseContext);

        await expectReason(
          createCapaIntakeAdvisoryService(
            ports,
          ).advise(invocation),
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
        );
      });
    }

    for (const invalid of [
      { workflow_state: "S00" },
      { workflow_state: "S20" },
      { record_version: 0 },
    ]) {
      it(`requires submitted intake context ${JSON.stringify(invalid)}`, async () => {
        const ports = dependencies();
        vi.mocked(
          ports.context_resolver.resolve,
        ).mockResolvedValue({
          ...context,
          ...invalid,
        } as CapaIntakeAdvisoryCaseContext);

        await expectReason(
          createCapaIntakeAdvisoryService(
            ports,
          ).advise(invocation),
          "CASE_NOT_IN_SUBMITTED_INTAKE",
        );
      });
    }

    it("stops before agent activation when authorization is denied", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.authorizer.authorize,
      ).mockResolvedValue(false);

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "ADVISORY_ACCESS_DENIED",
      );
      expect(
        ports.agent_gate.evaluate,
      ).not.toHaveBeenCalled();
    });

    it("stops before retrieval when the agent is ineligible", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.agent_gate.evaluate,
      ).mockReturnValue(false);

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "AGENT_NOT_ELIGIBLE",
      );
      expect(
        ports.evidence_provider.retrieve,
      ).not.toHaveBeenCalled();
    });

    it("reports governed retrieval failure", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.evidence_provider.retrieve,
      ).mockRejectedValue(
        new Error("provider detail"),
      );

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "EVIDENCE_RETRIEVAL_FAILED",
      );
    });

    it("reports governed generation failure", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.generator.generate,
      ).mockRejectedValue(
        new Error("provider detail"),
      );

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "ADVISORY_GENERATION_FAILED",
      );
    });

    for (const invalid of [
      { advisory_only: false },
      { workflow_mutated: true },
      { human_acceptance_required: false },
      {
        output_schema_version:
          "uncontrolled-schema",
      },
    ]) {
      it(`rejects invalid generator invariant ${Object.keys(invalid)[0]}`, async () => {
        const ports = dependencies();
        vi.mocked(
          ports.generator.generate,
        ).mockResolvedValue({
          ...response,
          ...invalid,
        } as CapaIntakeAdvisoryResponse);

        await expectReason(
          createCapaIntakeAdvisoryService(
            ports,
          ).advise(invocation),
          "INVALID_ADVISORY_RESULT",
        );
        expect(
          ports.output_repository.save,
        ).not.toHaveBeenCalled();
      });
    }

    it("maps atomic stale-case persistence detection to workflow mutation", async () => {
      const ports = dependencies();

      vi.mocked(
        ports.output_repository.save,
      ).mockResolvedValue(
        "case_changed",
      );

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "WORKFLOW_MUTATION_DETECTED",
      );

      expect(
        ports.integrity_guard
          .assertCaseUnchanged,
      ).not.toHaveBeenCalled();
    });

    it("reports transaction failure as output persistence failure", async () => {
      const ports = dependencies();

      vi.mocked(
        ports.transaction_manager
          .runInTransaction,
      ).mockRejectedValue(
        new Error("transaction detail"),
      );

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "ADVISORY_PERSISTENCE_FAILED",
      );

      expect(
        ports.output_repository.save,
      ).not.toHaveBeenCalled();
    });

    it("reports output persistence failure", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.output_repository.save,
      ).mockRejectedValue(
        new Error("database detail"),
      );

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "ADVISORY_PERSISTENCE_FAILED",
      );
    });

    it("detects any workflow mutation after advisory persistence", async () => {
      const ports = dependencies();
      vi.mocked(
        ports.integrity_guard
          .assertCaseUnchanged,
      ).mockResolvedValue(false);

      await expectReason(
        createCapaIntakeAdvisoryService(
          ports,
        ).advise(invocation),
        "WORKFLOW_MUTATION_DETECTED",
      );
    });

    it("publishes stable controlled failures", () => {
      expect(
        new CapaIntakeAdvisoryServiceError(
          "AGENT_NOT_ELIGIBLE",
        ),
      ).toMatchObject({
        name:
          "CapaIntakeAdvisoryServiceError",
        reason_code:
          "AGENT_NOT_ELIGIBLE",
        message:
          "The governed CAPA intake advisory operation failed.",
      });
    });
  },
);
