import { describe, expect, it, vi } from "vitest";
import { CapaImplementationEvidenceAdvisoryAdoptionService } from "../../lib/capa/ai/capa-implementation-evidence-advisory-adoption-service";
import type { CapaImplementationEvidenceAdvisoryOutputRecord } from "../../lib/database/repositories/capa-implementation-evidence-advisory-output-repository";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const OUTPUT = "50000000-0000-4000-8000-000000000001";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-10T12:00:00.000Z");

const context = {
  authentication: {
    principal: { principal_type: "human", user_id: USER },
    session_id: "80000000-0000-4000-8000-000000000001",
    authentication_method: "password",
    assurance_level: "aal1",
    authenticated_at: NOW.toISOString(),
    expires_at: "2026-09-10T13:00:00.000Z",
  },
  tenant: {
    organization_id: ORG,
    access_grant_id: "90000000-0000-4000-8000-000000000001",
    access_path: "HUMAN_MEMBERSHIP",
    authorization_policy_version: "policy-1.0.0",
    resolved_at: NOW.toISOString(),
    role_assignments: [],
  },
  owner_user_id: USER,
} as unknown as CapaRequestContext;

function output(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    record_version: 8,
    request_trace: { request_id: REQUEST, correlation_id: CORRELATION },
    response: {
      findings: [{
        finding_id: "finding-1",
        approved_action_reference: "ACTION-1",
        category: "documentation_improvement",
        severity: "low",
        finding: "The narrative can describe the verified record more clearly.",
        rationale: "The workspace narrative is brief.",
        evidence_reference_ids: [],
        reference_keys: ["R1"],
        suggested_human_action: "Review the wording and adopt it only if accurate.",
        adoption: { eligible: true, field: "implementation_narrative", suggested_value: "Document the verified training record and its source." },
      }],
    },
    reference_manifest: { document: { entries: [] } },
    generation_trace: {},
    ...overrides,
  } as unknown as CapaImplementationEvidenceAdvisoryOutputRecord;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    output_id: OUTPUT,
    finding_id: "finding-1",
    expected_case_version_id: VERSION,
    expected_record_version: 8,
    ...overrides,
  } as any;
}

function subject(overrides: Record<string, unknown> = {}) {
  const dependencies = {
    request_context: context,
    authorization_policy: { evaluate: vi.fn(async () => ({ decision: "allow" })) },
    output_repository: { findById: vi.fn(async () => output()) },
    workspace_service: { load: vi.fn(async () => ({ status: "loaded", workspace: { case_version_id: VERSION, record_version: 8 } })) },
    transaction_manager: { runInTransaction: vi.fn(async (_trace: unknown, work: (transaction: unknown) => unknown) => work({ transaction_id: "tx-1" })) },
    now: () => NOW,
    generate_audit_event_id: () => "91000000-0000-4000-8000-000000000001",
    ...overrides,
  } as any;
  return { service: new CapaImplementationEvidenceAdvisoryAdoptionService(dependencies), dependencies };
}

const trace = { request_id: REQUEST, correlation_id: CORRELATION, idempotency_key: "adoption-1" } as never;

describe("S80 deliberate advisory adoption boundary", () => {
  it("U/V: prepares a narrative patch while never saving the workspace or creating evidence", async () => {
    const test = subject();
    const result = await test.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never });
    expect(result).toMatchObject({ status: "prepared", patch: { field: "implementation_narrative", value: "Document the verified training record and its source.", requires_human_review: true, auto_saved: false, auto_submitted: false, evidence_created: false, owner_reported_status_changed: false, approved_baseline_changed: false, audit_event_id: null } });
    expect(test.dependencies.workspace_service.load).toHaveBeenCalledTimes(1);
    expect(test.dependencies.output_repository.findById).toHaveBeenCalledWith(ORG, OUTPUT);
    expect(test.dependencies.transaction_manager.runInTransaction).not.toHaveBeenCalled();
  });

  it("W/X: rejects non-adoptable findings, stale workspaces, and cross-case outputs", async () => {
    const nonAdoptable = subject({ output_repository: { findById: vi.fn(async () => output({ response: { findings: [{ ...output().response.findings[0], adoption: { eligible: false, field: null, suggested_value: null } }] } })) } });
    await expect(nonAdoptable.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never })).rejects.toMatchObject({ reason_code: "OUTPUT_NOT_ADOPTABLE" });

    const stale = subject({ workspace_service: { load: vi.fn(async () => ({ status: "loaded", workspace: { case_version_id: VERSION, record_version: 9 } })) } });
    await expect(stale.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never })).rejects.toMatchObject({ reason_code: "CASE_CHANGED" });

    const otherCase = subject({ output_repository: { findById: vi.fn(async () => output({ capa_case_id: "29999999-9999-4999-8999-999999999999" })) } });
    await expect(otherCase.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never })).rejects.toMatchObject({ reason_code: "OUTPUT_NOT_FOUND_OR_NOT_AUTHORIZED" });
  });

  it("Y/Z: records an adoption audit event only when configured, with the CAPA case as aggregate", async () => {
    const appendEvent = vi.fn(async () => ({ status: "appended", event_id: "91000000-0000-4000-8000-000000000001" }));
    const test = subject({ audit_repository: { appendEvent } });
    const result = await test.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never });
    expect(result.patch.audit_event_id).toBe("91000000-0000-4000-8000-000000000001");
    expect(appendEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aggregate_id: CASE, metadata: expect.objectContaining({ prepared_patch_only: true, workspace_saved: false, evidence_created: false }) }));
  });

  it("AA/AB/AC: fails closed for denied adoption and audit persistence failure", async () => {
    const denied = subject({ authorization_policy: { evaluate: vi.fn(async () => ({ decision: "deny" })) } });
    await expect(denied.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never })).rejects.toMatchObject({ reason_code: "ADOPTION_ACCESS_DENIED" });

    const failed = subject({ audit_repository: { appendEvent: vi.fn(async () => { throw new Error("audit"); }) } });
    await expect(failed.service.prepare({ capa_case_id: CASE as never, request: request(), request_trace: trace, user_id: USER as never })).rejects.toMatchObject({ reason_code: "PERSISTENCE_FAILED" });
  });
});
