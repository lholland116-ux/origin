import { describe, expect, it, vi } from "vitest";
import { createCapaAgentActivationService } from "../../lib/capa/ai/capa-agent-activation-service";
import { CapaContainmentRiskAdvisoryServiceError } from "../../lib/capa/ai/capa-containment-risk-advisory-service";
import { createRequestScopedCapaContainmentRiskAdvisoryService } from "../../lib/capa/application/capa-containment-risk-advisory-runtime-factory";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";
const SECTION = "50000000-0000-4000-8000-000000000001";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-02T12:00:00.000Z");
const raw = JSON.stringify({ proposal: { missing_risk_inputs: [], missing_impact_dimensions: [], human_review_questions: ["Is additional evidence required?"], evidence_provenance_gaps: [] }, assumptions: [], uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true });

function setup(policyDecision: "allow" | "deny" = "allow", activation = createCapaAgentActivationService()) {
  const repository: any = { findCaseById: vi.fn().mockResolvedValue({ organization_id: ORG, capa_case_id: CASE, current_version_id: VERSION, record_version: 2, status: "S20" }), findCaseVersionById: vi.fn().mockResolvedValue({ organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, version_number: 2, status: "S20", section_version_ids: [SECTION] }), findSectionVersionById: vi.fn().mockResolvedValue({ organization_id: ORG, capa_case_id: CASE, section_version_id: SECTION, section_type: "CAPA_INTAKE", content: { initiating_event: "event", organization_reference: "reference", source: {} } }) };
  const authentication: any = { principal: { principal_type: "human", user_id: USER }, session_id: "session", authentication_method: "PASSWORD", assurance_level: "AAL1", authenticated_at: "2026-09-02T10:00:00.000Z", expires_at: "2026-09-02T14:00:00.000Z" };
  const tenant: any = { organization_id: ORG, access_grant_id: "grant", access_path: "SUPABASE_MEMBERSHIP", authorization_policy_version: "policy-1", resolved_at: "2026-09-02T10:00:00.000Z", role_assignments: [{ role_assignment_id: "assignment", role_id: "CAPA_OWNER", scope: "ORGANIZATION", effective_at: "2026-09-01T00:00:00.000Z" }] };
  const request_context: any = { authentication, tenant, owner_user_id: USER };
  const policy = { evaluate: vi.fn().mockResolvedValue({ decision: policyDecision, reason_code: "AUTH", policy_version: "policy-1", evaluated_at: "2026-09-02T12:00:00.000Z", relied_on_role_assignment_ids: [] }) };
  const model_client = { generateStructured: vi.fn().mockResolvedValue({ output_text: raw }) };
  const output_repository = { save: vi.fn().mockResolvedValue("saved") };
  const transaction = { transaction_id: "transaction", started_at: "2026-09-02T12:00:00.000Z", request_trace: { request_id: REQUEST, correlation_id: CORRELATION } };
  const transaction_manager = { runInTransaction: vi.fn(async (_trace: unknown, work: (value: unknown) => Promise<unknown>) => work(transaction)) };
  const ids = ["80000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000001"];
  const generate_uuid = vi.fn(() => ids.shift() ?? "b0000000-0000-4000-8000-000000000001");
  const service = createRequestScopedCapaContainmentRiskAdvisoryService(request_context, { capa_repository: repository, authorization_policy: policy, agent_activation_service: activation, structured_model_client: model_client, output_repository, transaction_manager: transaction_manager as never, intake_section_type: "CAPA_INTAKE", now: () => NOW, generate_uuid });
  const invocation: any = { organization_id: ORG, capa_case_id: CASE, user_id: USER, request_id: REQUEST, correlation_id: CORRELATION, request: { requested_output: "containment_risk_analysis", focus: null, untrusted_human_draft: null } };
  return { service, policy, model_client, output_repository, transaction_manager, generate_uuid, invocation };
}

describe("request-scoped S20 advisory runtime factory", () => {
  it("composes a governed request-scoped service with distinct identities and durable persistence", async () => {
    const test = setup();
    await expect(test.service.execute(test.invocation)).resolves.toMatchObject({ advisory: { run_id: "80000000-0000-4000-8000-000000000001", output_id: "a0000000-0000-4000-8000-000000000001" }, snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 2 } });
    expect(test.model_client.generateStructured).toHaveBeenCalledTimes(1);
    expect(test.generate_uuid).toHaveBeenCalledTimes(3);
    expect(test.transaction_manager.runInTransaction).toHaveBeenCalledTimes(1);
    expect(test.output_repository.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ context: expect.objectContaining({ actor: USER, organization_id: ORG, workflow_state: "S20" }), response: expect.objectContaining({ run_id: "80000000-0000-4000-8000-000000000001", output_id: "a0000000-0000-4000-8000-000000000001" }), generation_trace: expect.objectContaining({ package: expect.objectContaining({ trace: expect.objectContaining({ prompt_package_id: "90000000-0000-4000-8000-000000000001" }) }) }) }));
    expect(test.policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: "request_ai_containment_risk_advisory", purpose: "CAPA_AI_CONTAINMENT_RISK_ADVISORY" }));
    for (const forbidden of ["acceptCapaContainmentRisk", "transitionWorkflow", "approve", "release", "reportability", "recall", "fieldAction"]) expect(test.service).not.toHaveProperty(forbidden);
  });

  it("fails closed on policy denial before model or persistence", async () => {
    const test = setup("deny");
    await expect(test.service.execute(test.invocation)).rejects.toMatchObject({ reason_code: "ADVISORY_ACCESS_DENIED" } satisfies Partial<CapaContainmentRiskAdvisoryServiceError>);
    expect(test.model_client.generateStructured).not.toHaveBeenCalled();
    expect(test.output_repository.save).not.toHaveBeenCalled();
  });

  it("fails closed on rejected S20 activation before model or persistence", async () => {
    const activation: any = { registry_version: "test", evaluate: vi.fn().mockReturnValue({ eligible: false, reason_code: "OPERATION_NOT_ELIGIBLE" }) };
    const test = setup("allow", activation);
    await expect(test.service.execute(test.invocation)).rejects.toMatchObject({ reason_code: "AGENT_NOT_ELIGIBLE" });
    expect(test.model_client.generateStructured).not.toHaveBeenCalled();
    expect(test.output_repository.save).not.toHaveBeenCalled();
  });
});
