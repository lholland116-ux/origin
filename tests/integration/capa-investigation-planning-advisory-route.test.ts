import { describe, expect, it, vi } from "vitest";

import {
  handleCapaInvestigationPlanningAdvisoryPost,
} from "../../lib/capa/api/capa-investigation-planning-advisory-route-handler";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  CapaInvestigationPlanningAdvisoryServiceError,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-service";
import {
  SupabaseCapaContextError,
} from "../../lib/security/supabase-capa-context";
import {
  SupabaseCapaTenantAccessError,
} from "../../lib/security/supabase-capa-durable-context";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CASE_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "50000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "60000000-0000-4000-8000-000000000001";
const RUN_ID = "70000000-0000-4000-8000-000000000001";
const VERSION_ID = "80000000-0000-4000-8000-000000000001";

function completedAdvisory() {
  return {
    run_id: RUN_ID,
    output_id: OUTPUT_ID,
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
  } as const;
}

function validDraft() {
  return {
    trust: "untrusted_human_draft",
    content: {
      items: [{
        local_key: "D1",
        investigation_question: "Question",
        evidence_target: "Evidence",
        investigation_method: "Method",
        scope_relationship: "Scope",
        due_date_consideration: "Due date",
        dependency_local_keys: [],
        owner_selected: false,
      }],
    },
  };
}

function setup() {
  const execute = vi.fn(async () => ({
    advisory: completedAdvisory(),
    snapshot: {
      capa_case_id: CASE_ID,
      case_version_id: VERSION_ID,
      record_version: 2,
    },
  }));
  const createAdvisoryService = vi.fn(() => ({ execute }));
  const dependencies = {
    get_session_facts: vi.fn(async () => ({
      verified_user_id: USER_ID,
      authenticated_at: "2026-09-03T12:00:00.000Z",
      expires_at_epoch_seconds: 1_800_000_000,
    })),
    resolve_context: vi.fn(async () => ({
      authentication: {
        principal: { principal_type: "human", user_id: USER_ID },
      },
      tenant: { organization_id: ORGANIZATION_ID },
      owner_user_id: USER_ID,
    })),
    create_advisory_service: createAdvisoryService,
    now: () => new Date("2026-09-03T12:00:00.000Z"),
    generate_uuid: vi.fn()
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(CORRELATION_ID)
      .mockReturnValue("90000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
  };
  return { dependencies, execute, createAdvisoryService };
}

function request(
  body: unknown = {},
  headers: Record<string, string> = {},
): Request {
  return new Request(
    `https://lvtchat.com/api/capa/${CASE_ID}/investigation-planning-advisory`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}

async function run(
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  const test = setup();
  const response = await handleCapaInvestigationPlanningAdvisoryPost(
    request(body, headers),
    CASE_ID,
    test.dependencies as never,
  );
  return { ...test, response };
}

describe("CAPA investigation-planning advisory route", () => {
  it("passes the controlled default request and trusted identity to execute", async () => {
    const test = await run({});

    expect(test.execute).toHaveBeenCalledWith({
      organization_id: ORGANIZATION_ID,
      capa_case_id: CASE_ID,
      user_id: USER_ID,
      request_id: REQUEST_ID,
      correlation_id: CORRELATION_ID,
      request: {
        requested_output: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
        focus: null,
        untrusted_human_draft: null,
      },
    });
    expect(test.createAdvisoryService).toHaveBeenCalledWith(expect.objectContaining({
      tenant: { organization_id: ORGANIZATION_ID },
      owner_user_id: USER_ID,
    }));
  });

  it("normalizes focus, preserves the valid untrusted draft, and returns the success envelope", async () => {
    const test = await run({
      focus: "  Ｆｕｌｌ－ｗｉｄｔｈ focus  ",
      untrusted_human_draft: validDraft(),
    });

    expect(test.response.status).toBe(201);
    expect(test.execute).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        requested_output: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
        focus: "Full-width focus",
        untrusted_human_draft: expect.objectContaining({
          trust: "untrusted_human_draft",
        }),
      },
    }));
    expect(await test.response.json()).toEqual({
      advisory: completedAdvisory(),
      snapshot: {
        capa_case_id: CASE_ID,
        case_version_id: VERSION_ID,
        record_version: 2,
      },
      correlation_id: CORRELATION_ID,
    });
    expect(test.response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves valid UUID trace headers and replaces malformed values", async () => {
    const traced = await run({}, {
      "x-request-id": "81000000-0000-4000-8000-000000000001",
      "x-correlation-id": "82000000-0000-4000-8000-000000000001",
    });
    expect(traced.execute).toHaveBeenCalledWith(expect.objectContaining({
      request_id: "81000000-0000-4000-8000-000000000001",
      correlation_id: "82000000-0000-4000-8000-000000000001",
    }));

    const malformed = await run({}, {
      "x-request-id": "not-a-uuid",
      "x-correlation-id": "not-a-correlation-id",
    });
    expect(malformed.execute).toHaveBeenCalledWith(expect.objectContaining({
      request_id: REQUEST_ID,
      correlation_id: CORRELATION_ID,
    }));
    expect((await malformed.response.json()).correlation_id).toBe(CORRELATION_ID);
  });

  it("rejects unauthenticated requests before service creation", async () => {
    const test = setup();
    test.dependencies.get_session_facts = vi.fn(async () => null) as never;
    const response = await handleCapaInvestigationPlanningAdvisoryPost(
      request(), CASE_ID, test.dependencies as never,
    );
    expect(response.status).toBe(401);
    expect(test.createAdvisoryService).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("maps context failures without leaking security details", async () => {
    const session = setup();
    session.dependencies.resolve_context = vi.fn(async () => {
      throw new SupabaseCapaContextError("SESSION_INACTIVE");
    }) as never;
    const sessionResponse = await handleCapaInvestigationPlanningAdvisoryPost(
      request(), CASE_ID, session.dependencies as never,
    );
    expect(sessionResponse.status).toBe(401);
    expect((await sessionResponse.json()).error.code).toBe("INVALID_SESSION_CONTEXT");
    expect(session.createAdvisoryService).not.toHaveBeenCalled();

    const tenant = setup();
    tenant.dependencies.resolve_context = vi.fn(async () => {
      throw new SupabaseCapaTenantAccessError("NO_ACTIVE_MEMBERSHIP");
    }) as never;
    const tenantResponse = await handleCapaInvestigationPlanningAdvisoryPost(
      request(), CASE_ID, tenant.dependencies as never,
    );
    expect(tenantResponse.status).toBe(403);
    expect((await tenantResponse.text())).not.toContain(ORGANIZATION_ID);
    expect(tenant.createAdvisoryService).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid case", "not-a-uuid", request(), "INVALID_CAPA_CASE_ID"],
    ["malformed JSON", CASE_ID, new Request("https://lvtchat.com", { method: "POST", body: "{bad" }), "INVALID_CAPA_ADVISORY_REQUEST"],
  ] as const)("rejects %s before service creation", async (_name, caseId, input, code) => {
    const test = setup();
    const response = await handleCapaInvestigationPlanningAdvisoryPost(
      input, caseId, test.dependencies as never,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(code);
    expect(test.createAdvisoryService).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    { requested_output: "authoritative" },
    { adopted_by_user_id: USER_ID },
    { adopted_at: "2026-09-03T12:00:00.000Z" },
    { workflow_state: "S40" },
    { release_g03: true },
    { focus: 10 },
    { untrusted_human_draft: { trust: "untrusted_human_draft", content: { items: "invalid" } } },
  ])("rejects authority-bearing or invalid browser input before service creation", async (body) => {
    const test = await run(body);
    expect(test.response.status).toBe(400);
    expect((await test.response.json()).error.code).toBe("INVALID_CAPA_ADVISORY_REQUEST");
    expect(test.createAdvisoryService).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["CASE_NOT_FOUND_OR_NOT_AUTHORIZED", 404, "CAPA_ADVISORY_CASE_NOT_FOUND"],
    ["CASE_NOT_IN_INVESTIGATION_PLANNING", 409, "CAPA_ADVISORY_CASE_STATE_CONFLICT"],
    ["ADVISORY_ACCESS_DENIED", 403, "CAPA_ADVISORY_ACCESS_DENIED"],
    ["AGENT_NOT_ELIGIBLE", 409, "CAPA_ADVISORY_AGENT_NOT_ELIGIBLE"],
    ["WORKFLOW_MUTATION_DETECTED", 409, "CAPA_ADVISORY_CASE_CHANGED"],
  ] as const)("maps service reason %s to safe HTTP %d", async (reason, status, code) => {
    const test = setup();
    test.execute.mockRejectedValueOnce(
      new CapaInvestigationPlanningAdvisoryServiceError(reason),
    );
    const response = await handleCapaInvestigationPlanningAdvisoryPost(
      request(), CASE_ID, test.dependencies as never,
    );
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.correlation_id).toBe(CORRELATION_ID);
  });

  it.each([
    "ADVISORY_GENERATION_FAILED",
    "INVALID_ADVISORY_RESULT",
    "ADVISORY_PERSISTENCE_FAILED",
  ] as const)("maps %s to a generic internal error", async (reason) => {
    const test = setup();
    test.execute.mockRejectedValueOnce(
      new CapaInvestigationPlanningAdvisoryServiceError(reason),
    );
    const response = await handleCapaInvestigationPlanningAdvisoryPost(
      request({ untrusted_human_draft: validDraft() }), CASE_ID, test.dependencies as never,
    );
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).toContain("CAPA_INTERNAL_ERROR");
    expect(body).not.toContain(reason);
    expect(test.dependencies.logger.error).toHaveBeenCalledWith(
      "CAPA API investigation-planning advisory failed.",
      expect.objectContaining({ correlation_id: CORRELATION_ID }),
    );
  });

  it("sanitizes unexpected failures and does not log request contents", async () => {
    const test = setup();
    const sensitive = "provider-secret draft-content";
    test.execute.mockRejectedValueOnce(new Error(sensitive));
    const response = await handleCapaInvestigationPlanningAdvisoryPost(
      request({ focus: sensitive, untrusted_human_draft: validDraft() }),
      CASE_ID,
      test.dependencies as never,
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("CAPA_INTERNAL_ERROR");
    expect(body).not.toContain(sensitive);
    expect(test.dependencies.logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(test.dependencies.logger.error.mock.calls)).not.toContain(sensitive);
  });
});
