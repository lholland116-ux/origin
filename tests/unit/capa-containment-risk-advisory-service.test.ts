import { describe, expect, it, vi } from "vitest";

import { CapaContainmentRiskAdvisoryService } from "../../lib/capa/ai/capa-containment-risk-advisory-service";

const advisory: any = { proposal: { missing_risk_inputs: [], missing_impact_dimensions: [], human_review_questions: ["Is additional evidence required?"], evidence_provenance_gaps: [] }, assumptions: [], uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true };
const response: any = { run_id: "run-1", output_id: "output-1", output_schema_version: "capa-containment-risk-advisory-1.0.0", status: "completed_draft", ...advisory, containment_summary: [], warnings: [] };
const context: any = { authoritative: { trust: "authoritative_server_context", organization_id: "organization", capa_case_id: "case", case_version_id: "version", record_version: 2, workflow_state: "S20", actor: "user", active_roles: [{}], intake_scope: {}, persisted_containment_risk: null }, untrusted_human_draft: null };
const invocation: any = { organization_id: "organization", capa_case_id: "case", user_id: "user", request_id: "request-1", correlation_id: "correlation-1", request: { requested_output: "containment_risk_analysis", focus: null, untrusted_human_draft: null } };
const trace: any = { package: { trace: { run_id: "run-1", prompt_package_id: "package-1", request_id: "request-1", correlation_id: "correlation-1", assembled_at: "2026-09-01T00:00:00.000Z" }, scope: { organization_id: "organization", capa_case_id: "case", case_version_id: "version", record_version: 2, workflow_state: "S20" } } };

function fixture() {
  const context_resolver = { resolve: vi.fn().mockResolvedValue(context), assertCaseUnchanged: vi.fn().mockResolvedValue(true) };
  const authorizer = { authorize: vi.fn().mockResolvedValue(true) };
  const agent_gate = { evaluate: vi.fn().mockReturnValue(true) };
  const generator = { generate: vi.fn().mockResolvedValue({ response, trace }) };
  return { context_resolver, authorizer, agent_gate, generator, service: new CapaContainmentRiskAdvisoryService({ context_resolver, authorizer, agent_gate, generator }) };
}

describe("S20 advisory service", () => {
  it("passes exact trusted request and correlation identities to the generator", async () => {
    const subject = fixture();
    const result = await subject.service.execute(invocation);
    expect(subject.generator.generate).toHaveBeenCalledWith({ context, focus: null, request_id: invocation.request_id, correlation_id: invocation.correlation_id });
    expect(subject.context_resolver.assertCaseUnchanged).toHaveBeenCalledWith(context.authoritative);
    expect(result.advisory).toBe(response);
    expect(result.snapshot).toEqual({ capa_case_id: "case", case_version_id: "version", record_version: 2 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts matching response, trace, request, correlation, and scope identities", async () => {
    const subject = fixture();
    await subject.service.execute(invocation);
    expect(subject.context_resolver.assertCaseUnchanged).toHaveBeenCalledTimes(1);
    expect(subject.generator.generate.mock.results[0]?.value).toBeDefined();
  });

  const traceWith = (change: { responseRunId?: string; runId?: string; requestId?: string; correlationId?: string; organizationId?: string; caseId?: string; versionId?: string; recordVersion?: number; workflowState?: string; missing?: "trace" | "package" | "package.trace" | "package.scope" }) => {
    if (change.missing === "trace") return {};
    if (change.missing === "package") return { trace: {} };
    if (change.missing === "package.trace") return { package: { scope: trace.package.scope } };
    if (change.missing === "package.scope") return { package: { trace: trace.package.trace } };
    return { package: { trace: { ...trace.package.trace, run_id: change.runId ?? trace.package.trace.run_id, request_id: change.requestId ?? trace.package.trace.request_id, correlation_id: change.correlationId ?? trace.package.trace.correlation_id }, scope: { ...trace.package.scope, organization_id: change.organizationId ?? trace.package.scope.organization_id, capa_case_id: change.caseId ?? trace.package.scope.capa_case_id, case_version_id: change.versionId ?? trace.package.scope.case_version_id, record_version: change.recordVersion ?? trace.package.scope.record_version, workflow_state: change.workflowState ?? trace.package.scope.workflow_state } } };
  };

  it.each([
    ["response run ID", { responseRunId: "different" }],
    ["trace run ID", { runId: "different" }],
    ["request ID", { requestId: "different" }],
    ["correlation ID", { correlationId: "different" }],
    ["organization scope", { organizationId: "different" }],
    ["case scope", { caseId: "different" }],
    ["version scope", { versionId: "different" }],
    ["record-version scope", { recordVersion: 3 }],
    ["workflow scope", { workflowState: "S30" }],
  ] as const)("rejects mismatched %s before stale-case assertion", async (_name, change) => {
    const subject = fixture();
    const responseRunId = "responseRunId" in change ? change.responseRunId : undefined;
    subject.generator.generate.mockResolvedValue({ response: { ...response, ...(responseRunId ? { run_id: responseRunId } : {}) }, trace: traceWith(change) });
    await expect(subject.service.execute(invocation)).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
    expect(subject.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });

  it.each([["trace", "trace"], ["package", "package"], ["package.trace", "package.trace"], ["package.scope", "package.scope"]] as const)("rejects missing %s structure fail-closed", async (_name, missing) => {
    const subject = fixture();
    subject.generator.generate.mockResolvedValue({ response, trace: traceWith({ missing }) });
    await expect(subject.service.execute(invocation)).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
    expect(subject.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });

  it("preserves output and governed trace identities without rewriting them", async () => {
    const subject = fixture();
    const result = await subject.service.execute(invocation);
    expect(result.advisory.output_id).toBe("output-1");
    expect(trace.package.trace.prompt_package_id).toBe("package-1");
    expect(trace.package.trace.assembled_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps the browser draft outside authorization and gate evaluation", async () => {
    const subject = fixture();
    const assembly = { ...context, untrusted_human_draft: { trust: "untrusted_human_draft", content: {} } };
    subject.context_resolver.resolve.mockResolvedValue(assembly);
    await subject.service.execute(invocation);
    expect(subject.authorizer.authorize).toHaveBeenCalledWith(expect.objectContaining({ context: context.authoritative }));
    expect(subject.agent_gate.evaluate).toHaveBeenCalledWith(expect.objectContaining({ context: context.authoritative }));
    expect(subject.generator.generate).toHaveBeenCalledWith(expect.objectContaining({ context: assembly }));
  });

  it("retains stale-case detection after advisory generation", async () => {
    const subject = fixture();
    subject.context_resolver.assertCaseUnchanged.mockResolvedValue(false);
    await expect(subject.service.execute(invocation)).rejects.toMatchObject({ reason_code: "WORKFLOW_MUTATION_DETECTED" });
  });

  it.each([
    ["schema", { output_schema_version: "wrong" }],
    ["status", { status: "failed" }],
    ["containment summary", { containment_summary: ["raw"] }],
    ["citations", { citations: [{ source: "raw" }] }],
    ["warnings", { warnings: ["raw"] }],
    ["authority flags", { advisory_only: false }],
  ] as const)("rejects malformed generated %s", async (_name, change) => {
    const subject = fixture();
    subject.generator.generate.mockResolvedValue({ response: { ...response, ...change }, trace });
    await expect(subject.service.execute(invocation)).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
    expect(subject.context_resolver.assertCaseUnchanged).not.toHaveBeenCalled();
  });
});
