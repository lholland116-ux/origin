import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-agent-gate";
import {
  CapaInvestigationPlanningAdvisoryService,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-service";

const response: any = {
  run_id: "run-1",
  output_id: "output-1",
  output_schema_version: "capa_investigation_plan_draft-1.0.0",
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
};

const context: any = {
  authoritative: {
    trust: "authoritative_server_context",
    organization_id: "organization-1",
    capa_case_id: "case-1",
    case_version_id: "version-1",
    record_version: 2,
    workflow_state: "S30",
    actor: "user-1",
    active_roles: [{ role_id: "CAPA_OWNER" }],
    intake_scope: {},
    accepted_scope: {},
    accepted_containment_risk: {},
  },
  untrusted_human_draft: null,
};

const trace: any = {
  trace_schema_version: "capa-ai-generation-trace-1.0.0",
  package: {
    package_schema_version: "capa-investigation-planning-prompt-package-1.0.0",
    agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" },
    trace: {
      run_id: "run-1",
      prompt_package_id: "prompt-package-1",
      request_id: "request-1",
      correlation_id: "correlation-1",
      assembled_at: "2026-09-01T00:00:00.000Z",
    },
    scope: {
      organization_id: "organization-1",
      capa_case_id: "case-1",
      case_version_id: "version-1",
      record_version: 2,
      workflow_state: "S30",
    },
    generation_contract: {
      operation: "draft_investigation_plan",
      requested_output: "investigation_plan_draft",
      output_schema_version: "capa_investigation_plan_draft-1.0.0",
    },
  },
};

const invocation: any = {
  organization_id: "organization-1",
  capa_case_id: "case-1",
  user_id: "user-1",
  request_id: "request-1",
  correlation_id: "correlation-1",
  request: {
    requested_output: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
    focus: "Review the accepted scope",
    untrusted_human_draft: { trust: "untrusted_human_draft", content: {} },
  },
};

function fixture() {
  const context_resolver = {
    resolve: vi.fn().mockResolvedValue(context),
    assertCaseUnchanged: vi.fn().mockResolvedValue(true),
  };
  const authorizer = { authorize: vi.fn().mockResolvedValue(true) };
  const agent_gate = { evaluate: vi.fn().mockReturnValue(true) };
  const generator = {
    generate: vi.fn().mockResolvedValue({ response, trace }),
  };
  const service = new CapaInvestigationPlanningAdvisoryService({
    context_resolver,
    authorizer,
    agent_gate,
    generator,
  });
  return { context_resolver, authorizer, agent_gate, generator, service };
}

function traceWith(change: {
  responseRunId?: string;
  runId?: string;
  requestId?: string;
  correlationId?: string;
  organizationId?: string;
  caseId?: string;
  versionId?: string;
  recordVersion?: number;
  workflowState?: string;
  agentId?: string;
  agentVersion?: string;
  operation?: string;
  outputSchemaVersion?: string;
  missing?: "trace" | "package" | "package.trace" | "package.scope";
}) {
  if (change.missing === "trace") return {};
  if (change.missing === "package") return { trace: {} };
  if (change.missing === "package.trace") {
    return { package: { scope: trace.package.scope } };
  }
  if (change.missing === "package.scope") {
    return { package: { trace: trace.package.trace } };
  }

  return {
    package: {
      ...trace.package,
      trace: {
        ...trace.package.trace,
        run_id: change.runId ?? trace.package.trace.run_id,
        request_id: change.requestId ?? trace.package.trace.request_id,
        correlation_id:
          change.correlationId ?? trace.package.trace.correlation_id,
      },
      scope: {
        ...trace.package.scope,
        organization_id:
          change.organizationId ?? trace.package.scope.organization_id,
        capa_case_id: change.caseId ?? trace.package.scope.capa_case_id,
        case_version_id:
          change.versionId ?? trace.package.scope.case_version_id,
        record_version:
          change.recordVersion ?? trace.package.scope.record_version,
        workflow_state:
          change.workflowState ?? trace.package.scope.workflow_state,
      },
      agent: {
        ...trace.package.agent,
        agent_id: change.agentId ?? trace.package.agent.agent_id,
        agent_version:
          change.agentVersion ?? trace.package.agent.agent_version,
      },
      generation_contract: {
        ...trace.package.generation_contract,
        operation:
          change.operation ?? trace.package.generation_contract.operation,
        output_schema_version:
          change.outputSchemaVersion ??
          trace.package.generation_contract.output_schema_version,
      },
    },
  };
}

describe("S30 investigation-planning advisory service", () => {
  it("orchestrates the trusted boundaries and returns the frozen snapshot", async () => {
    const test = fixture();
    const result = await test.service.execute(invocation);

    expect(test.context_resolver.resolve).toHaveBeenCalledWith({
      organization_id: invocation.organization_id,
      capa_case_id: invocation.capa_case_id,
      untrusted_human_draft: invocation.request.untrusted_human_draft,
    });
    expect(test.authorizer.authorize).toHaveBeenCalledWith({
      context: context.authoritative,
      operation: CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
    });
    expect(test.agent_gate.evaluate).toHaveBeenCalledWith({
      context: context.authoritative,
      agent: CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
      operation: CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
    });
    expect(test.generator.generate).toHaveBeenCalledWith({
      context,
      focus: invocation.request.focus,
      request_id: invocation.request_id,
      correlation_id: invocation.correlation_id,
    });
    expect(test.context_resolver.assertCaseUnchanged).toHaveBeenCalledWith(
      context.authoritative,
    );
    expect(result.advisory).toBe(response);
    expect(result.snapshot).toEqual({
      capa_case_id: "case-1",
      case_version_id: "version-1",
      record_version: 2,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it("stops safely at context, authorization, gate, or generation failures", async () => {
    const contextFailure = fixture();
    contextFailure.context_resolver.resolve.mockRejectedValue(new Error("context"));
    await expect(contextFailure.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
    });

    const unauthorized = fixture();
    unauthorized.authorizer.authorize.mockResolvedValue(false);
    await expect(unauthorized.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "ADVISORY_ACCESS_DENIED",
    });
    expect(unauthorized.agent_gate.evaluate).not.toHaveBeenCalled();

    const ineligible = fixture();
    ineligible.agent_gate.evaluate.mockReturnValue(false);
    await expect(ineligible.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "AGENT_NOT_ELIGIBLE",
    });
    expect(ineligible.generator.generate).not.toHaveBeenCalled();

    const generationFailure = fixture();
    generationFailure.generator.generate.mockRejectedValue(new Error("generation"));
    await expect(generationFailure.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "ADVISORY_GENERATION_FAILED",
    });
  });

  it.each([
    ["schema", { output_schema_version: "wrong" }],
    ["status", { status: "service_failed" }],
    ["proposal", { proposal: null }],
    ["citations", { citations: [{ source: "unexpected" }] }],
    ["warnings", { warnings: ["unexpected"] }],
    ["authority flags", { workflow_mutated: true }],
  ] as const)("rejects malformed generated %s before stale assertion", async (_name, change) => {
    const test = fixture();
    test.generator.generate.mockResolvedValue({
      response: { ...response, ...change },
      trace,
    });

    await expect(test.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "INVALID_ADVISORY_RESULT",
    });
    expect(test.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });

  it("rejects semantic and identity mismatches before stale assertion", async () => {
    const semantic = fixture();
    semantic.generator.generate.mockResolvedValue({
      response: {
        ...response,
        proposal: { ...response.proposal, gaps: [{ gap: "missing" }] },
      },
      trace,
    });
    await expect(semantic.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "INVALID_ADVISORY_RESULT",
    });

    const identity = fixture();
    identity.generator.generate.mockResolvedValue({
      response: { ...response, run_id: "different" },
      trace,
    });
    await expect(identity.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "INVALID_ADVISORY_RESULT",
    });
    expect(identity.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });

  it.each([
    ["response run ID", { responseRunId: "different" }],
    ["trace run ID", { runId: "different" }],
    ["request ID", { requestId: "different" }],
    ["correlation ID", { correlationId: "different" }],
    ["organization", { organizationId: "different" }],
    ["case", { caseId: "different" }],
    ["case version", { versionId: "different" }],
    ["record version", { recordVersion: 3 }],
    ["workflow state", { workflowState: "S20" }],
    ["agent", { agentId: "AG-INTAKE" }],
    ["agent version", { agentVersion: "ag-plan-2.0.0" }],
    ["operation", { operation: "release_investigation" }],
    ["schema version", { outputSchemaVersion: "wrong" }],
  ] as const)("rejects generated %s identity mismatch before stale assertion", async (_name, change) => {
    const test = fixture();
    const changedResponse = "responseRunId" in change
      ? { ...response, run_id: change.responseRunId }
      : response;
    test.generator.generate.mockResolvedValue({
      response: changedResponse,
      trace: traceWith(change),
    });

    await expect(test.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "INVALID_ADVISORY_RESULT",
    });
    expect(test.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });

  it.each([
    ["trace", "trace"],
    ["package", "package"],
    ["package.trace", "package.trace"],
    ["package.scope", "package.scope"],
  ] as const)("rejects missing %s identity structure before stale assertion", async (_name, missing) => {
    const test = fixture();
    test.generator.generate.mockResolvedValue({
      response,
      trace: traceWith({ missing }),
    });

    await expect(test.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "INVALID_ADVISORY_RESULT",
    });
    expect(test.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });

  it("maps stale false or thrown checks to workflow mutation", async () => {
    const stale = fixture();
    stale.context_resolver.assertCaseUnchanged.mockResolvedValue(false);
    await expect(stale.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "WORKFLOW_MUTATION_DETECTED",
    });

    const thrown = fixture();
    thrown.context_resolver.assertCaseUnchanged.mockRejectedValue(
      new Error("stale check"),
    );
    await expect(thrown.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "WORKFLOW_MUTATION_DETECTED",
    });
  });

  it("rejects an invalid requested output and malformed authoritative context", async () => {
    const wrongOutput = fixture();
    await expect(
      wrongOutput.service.execute({
        ...invocation,
        request: { ...invocation.request, requested_output: "wrong" },
      }),
    ).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
    expect(wrongOutput.context_resolver.resolve).not.toHaveBeenCalled();

    const wrongContext = fixture();
    wrongContext.context_resolver.resolve.mockResolvedValue({
      ...context,
      authoritative: { ...context.authoritative, actor: "other-user" },
    });
    await expect(wrongContext.service.execute(invocation)).rejects.toMatchObject({
      reason_code: "CASE_NOT_IN_INVESTIGATION_PLANNING",
    });
    expect(wrongContext.authorizer.authorize).not.toHaveBeenCalled();
  });
});
