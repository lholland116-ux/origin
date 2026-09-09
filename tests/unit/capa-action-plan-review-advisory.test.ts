import { describe, expect, it, vi } from "vitest";
import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION } from "../../lib/capa/ai/capa-action-plan-review-advisory-contract";
import { validateCapaActionPlanReviewAdvisoryModelOutput } from "../../lib/capa/ai/capa-action-plan-review-advisory-validator";
import { ActivationBackedCapaActionPlanReviewAdvisoryAgentGate, CAPA_ACTION_PLAN_REVIEW_ADVISORY_AGENT } from "../../lib/capa/ai/capa-action-plan-review-advisory-agent-gate";
import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION } from "../../lib/capa/ai/capa-action-plan-review-advisory-agent-gate";
import { CapaActionPlanReviewAdvisoryService } from "../../lib/capa/ai/capa-action-plan-review-advisory-service";

const VERSION = "10000000-0000-4000-8000-000000000001";
const SECTION = "20000000-0000-4000-8000-000000000001";
const ACTION = "30000000-0000-4000-8000-000000000001";
const ROOT = "40000000-0000-4000-8000-000000000001";
const valid = { schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION, status: "completed_draft", source_case_version_id: VERSION, action_plan_section_version_id: SECTION, proposal: { overall_assessment: "needs_attention", findings: [{ finding_id: "F1", category: "owner_completeness", severity: "high", summary: "The action needs an owner.", rationale: "Ownership is not established in the submitted baseline.", affected_action_ids: [ACTION], affected_root_cause_ids: [ROOT], reference_keys: ["R1"], suggested_reviewer_attention: "Confirm the accountable owner before approval." }], recommended_disposition: "return", limitations: ["The advisory is not a human review decision."] }, citations: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true };

describe("S70 governed action-plan review advisory", () => {
  it("validates a grounded advisory with explicit S70 baseline bindings", () => { const result = validateCapaActionPlanReviewAdvisoryModelOutput(JSON.stringify(valid)); expect(result.source_case_version_id).toBe(VERSION); expect(result.action_plan_section_version_id).toBe(SECTION); expect(Object.isFrozen(result)).toBe(true); });
  it.each([
    ["invalid recommendation", { proposal: { ...valid.proposal, recommended_disposition: "approve_now" } }],
    ["malformed source version", { source_case_version_id: "not-a-source-version" }],
    ["malformed action section", { action_plan_section_version_id: "not-an-action-section" }],
    ["malformed finding", { proposal: { ...valid.proposal, findings: [{ ...valid.proposal.findings[0], reference_keys: ["not-a-reference"] }] } }],
    ["duplicate finding ids", { proposal: { ...valid.proposal, findings: [valid.proposal.findings[0], valid.proposal.findings[0]] } }],
  ])("rejects %s", (_label, override) => { expect(() => validateCapaActionPlanReviewAdvisoryModelOutput(JSON.stringify({ ...valid, ...override }))).toThrow(); });
  it("rejects approval or transition claims", () => { expect(() => validateCapaActionPlanReviewAdvisoryModelOutput(JSON.stringify({ ...valid, approval_claimed: true }))).toThrow(); expect(() => validateCapaActionPlanReviewAdvisoryModelOutput(JSON.stringify({ ...valid, workflow_transition: "S80" }))).toThrow(); });
  it("uses only the AG-REVIEW S70 capability", () => { const evaluate = vi.fn(() => ({ eligible: true })); const gate = new ActivationBackedCapaActionPlanReviewAdvisoryAgentGate({ evaluate } as never); const context = { workflow_state: "S70", active_roles: [{ role_id: "CAPA_REVIEWER" }] } as never; expect(gate.evaluate({ context, agent: CAPA_ACTION_PLAN_REVIEW_ADVISORY_AGENT, operation: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OPERATION })).toBe(true); expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ agent_id: "AG-REVIEW", workflow_state: "S70", operation: "assemble_review_packet", output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION })); });

  it.each([
    ["source case version", { source_case_version_id: ROOT }],
    ["action-plan section", { action_plan_section_version_id: ROOT }],
  ])("rejects a generated advisory bound to the wrong %s", async (_label, change) => {
    const context = {
      trust: "authoritative_server_context", organization_id: "50000000-0000-4000-8000-000000000001", capa_case_id: "60000000-0000-4000-8000-000000000001", case_version_id: VERSION, record_version: 7, workflow_state: "S70", actor: "70000000-0000-4000-8000-000000000001", active_roles: [{ role_id: "CAPA_REVIEWER" }],
      case_version: { version_number: 7, parent_version_id: null, change_reason: "submit action plan" },
      sections: { action_plan: { section_version_id: SECTION, content: { items: [{ item_id: ACTION }], effectiveness_checks: [] } }, root_cause_package: { content: { hypotheses: [{ hypothesis_id: ROOT }] } }, investigation_ledger: { content: { items: [] } } },
    };
    const response = { ...valid, ...change, run_id: "80000000-0000-4000-8000-000000000001", output_id: "90000000-0000-4000-8000-000000000001", output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION };
    const trace = { package: { package_schema_version: "capa-action-plan-review-advisory-prompt-package-1.0.0", scope: { organization_id: context.organization_id, capa_case_id: context.capa_case_id, case_version_id: VERSION, record_version: 7, workflow_state: "S70" }, trace: { run_id: response.run_id, request_id: "a0000000-0000-4000-8000-000000000001", correlation_id: "b0000000-0000-4000-8000-000000000001" }, generation_contract: { operation: "assemble_review_packet", output_schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION } } };
    const service = new CapaActionPlanReviewAdvisoryService({
      context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: { authoritative: context, reference_manifest: [{ reference_key: "R1" }], model_safe_context: {} } })), assertCaseUnchanged: vi.fn(async () => true) },
      authorizer: { authorize: vi.fn(async () => true) }, agent_gate: { evaluate: vi.fn(() => true) }, generator: { generate: vi.fn(async () => ({ response, trace })) }, output_repository: { save: vi.fn(async () => "saved") }, transaction_manager: { runInTransaction: vi.fn(async (_trace, callback) => callback({})) },
    } as never);
    await expect(service.execute({ organization_id: context.organization_id as never, capa_case_id: context.capa_case_id as never, user_id: context.actor as never, request_id: "a0000000-0000-4000-8000-000000000001" as never, correlation_id: "b0000000-0000-4000-8000-000000000001" as never, request: { expected_case_version_id: VERSION as never, expected_record_version: 7 } })).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
  });
});
