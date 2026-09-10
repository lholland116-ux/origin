import { describe, expect, it, vi } from "vitest";
import type {
  CapaRequestContext,
} from "../../lib/security/supabase-capa-context";
import type {
  CapaImplementationWorkspaceApiDependencies,
} from "../../lib/capa/api/capa-implementation-workspace-route-handler";
import {
  handleCapaImplementationWorkspaceGet,
  handleCapaImplementationWorkspacePut,
} from "../../lib/capa/api/capa-implementation-workspace-route-handler";
import type {
  CapaImplementationWorkspaceService,
} from "../../lib/capa/application/capa-implementation-workspace-service";

const CASE = "20000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const context = {
  authentication: {
    principal: { principal_type: "human", user_id: USER },
    session_id: "90000000-0000-4000-8000-000000000001",
    authentication_method: "password",
    assurance_level: "aal1",
    authenticated_at: AT,
    expires_at: "2026-09-10T13:00:00.000Z",
  },
  tenant: {
    organization_id: "10000000-0000-4000-8000-000000000001",
    access_grant_id: "91000000-0000-4000-8000-000000000001",
    access_path: "DEVELOPMENT_SINGLE_USER_TENANT",
    authorization_policy_version: "test-policy-1.0.0",
    resolved_at: AT,
    role_assignments: [],
  },
  owner_user_id: USER,
} as unknown as CapaRequestContext;

const workspace = {
  draft_revision: 1,
  case_version_id: "30000000-0000-4000-8000-000000000002",
  record_version: 8,
  approved_s70_baseline: {
    source_case_version_id: "30000000-0000-4000-8000-000000000001",
    approved_action_plan_section_id: "40000000-0000-4000-8000-000000000001",
    approval_decision_reference: "50000000-0000-4000-8000-000000000001",
  },
  approved_actions: [{
    approved_action_reference: "ACTION-1",
    status: "approved",
    action_type: "corrective",
    description: "Complete the approved action.",
    due_date: "2026-09-30",
    deliverable: "Validated completion record",
    implementation_expectation: "Training evidence",
    effectiveness_check_required: false,
    acceptance_criteria: [],
  }],
  draft: {
    schema_version: "capa-implementation-workspace-draft-1.0.0",
    action_progress: [],
    implementation_review_return_response: null,
  },
  updated_at: AT,
};

function createDependencies(
  service: CapaImplementationWorkspaceService,
  authenticated = true,
): CapaImplementationWorkspaceApiDependencies {
  return {
    get_session_facts: vi.fn(async () => authenticated ? ({
      verified_user_id: USER,
      authenticated_at: AT,
      expires_at_epoch_seconds: 1_798_000_000,
    } as never) : null),
    resolve_context: vi.fn(async () => context),
    create_workspace_service: vi.fn(() => service),
    now: () => new Date(AT),
    generate_uuid: () => "92000000-0000-4000-8000-000000000001",
    logger: { error: vi.fn() },
  };
}

describe("S80 implementation workspace route handler", () => {
  it("returns 401 without an authenticated session", async () => {
    const service = { load: vi.fn(), save: vi.fn() } as unknown as CapaImplementationWorkspaceService;
    const response = await handleCapaImplementationWorkspaceGet(
      new Request(`https://example.test/api/capa/${CASE}/implementation-workspace`),
      CASE,
      createDependencies(service, false),
    );
    expect(response.status).toBe(401);
    expect(service.load).not.toHaveBeenCalled();
  });

  it("maps forbidden and stale-save results without leaking internal details", async () => {
    const forbiddenService = {
      load: vi.fn(async () => ({
        status: "authorization_denied",
        reason_code: "ROLE_DENIED",
        policy_version: "test-policy-1.0.0",
      })),
      save: vi.fn(),
    } as unknown as CapaImplementationWorkspaceService;
    const forbidden = await handleCapaImplementationWorkspaceGet(
      new Request("https://example.test"),
      CASE,
      createDependencies(forbiddenService),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "CAPA_IMPLEMENTATION_WORKSPACE_ACCESS_DENIED" },
    });

    const staleService = {
      load: vi.fn(),
      save: vi.fn(async () => ({ status: "concurrency_conflict" })),
    } as unknown as CapaImplementationWorkspaceService;
    const stale = await handleCapaImplementationWorkspacePut(
      new Request("https://example.test", {
        method: "PUT",
        body: JSON.stringify({ expected_draft_revision: 1, action_progress: [] }),
        headers: { "content-type": "application/json" },
      }),
      CASE,
      createDependencies(staleService),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" },
    });
  });

  it("maps missing cases, invalid workflow state, and invalid drafts", async () => {
    const notFoundService = {
      load: vi.fn(async () => ({ status: "not_found" })),
      save: vi.fn(),
    } as unknown as CapaImplementationWorkspaceService;
    const notFound = await handleCapaImplementationWorkspaceGet(
      new Request("https://example.test"),
      CASE,
      createDependencies(notFoundService),
    );
    expect(notFound.status).toBe(404);

    const workflowService = {
      load: vi.fn(async () => ({
        status: "workflow_conflict",
        reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
      })),
      save: vi.fn(),
    } as unknown as CapaImplementationWorkspaceService;
    const workflow = await handleCapaImplementationWorkspaceGet(
      new Request("https://example.test"),
      CASE,
      createDependencies(workflowService),
    );
    expect(workflow.status).toBe(409);

    const invalidService = {
      load: vi.fn(),
      save: vi.fn(async () => ({
        status: "validation_failed",
        reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_OBJECT",
      })),
    } as unknown as CapaImplementationWorkspaceService;
    const invalid = await handleCapaImplementationWorkspacePut(
      new Request("https://example.test", {
        method: "PUT",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      CASE,
      createDependencies(invalidService),
    );
    expect(invalid.status).toBe(400);
  });

  it("returns only the safe S80 projection", async () => {
    const service = {
      load: vi.fn(async () => ({ status: "loaded", workspace })),
      save: vi.fn(),
    } as unknown as CapaImplementationWorkspaceService;
    const response = await handleCapaImplementationWorkspaceGet(
      new Request("https://example.test"),
      CASE,
      createDependencies(service),
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      workspace: {
        draft_revision: 1,
        approved_actions: [{ approved_action_reference: "ACTION-1" }],
        draft: { implementation_review_return_response: null },
      },
    });
    expect(payload).not.toHaveProperty("workspace.created_by_user_id");
    expect(payload).not.toHaveProperty("workspace.updated_by_user_id");
    expect(payload).not.toHaveProperty("workspace.organization_id");
    expect(payload).not.toHaveProperty("workspace.database_row");
  });
});
