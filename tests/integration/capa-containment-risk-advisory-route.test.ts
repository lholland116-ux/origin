import { describe, expect, it, vi } from "vitest";

import { handleCapaContainmentRiskAdvisoryPost } from "../../lib/capa/api/capa-containment-risk-advisory-route-handler";
import { CapaContainmentRiskAdvisoryServiceError } from "../../lib/capa/ai/capa-containment-risk-advisory-service";
import { SupabaseCapaContextError } from "../../lib/security/supabase-capa-context";
import { SupabaseCapaTenantAccessError } from "../../lib/security/supabase-capa-durable-context";

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
    output_schema_version: "capa-containment-risk-advisory-1.0.0",
    status: "completed_draft",
    proposal: {
      missing_risk_inputs: [],
      missing_impact_dimensions: [],
      human_review_questions: ["Is additional evidence required?"],
      evidence_provenance_gaps: [],
    },
    containment_summary: [],
    citations: [],
    assumptions: [],
    uncertainty_and_limitations: [],
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
      actions: [],
      impact_scope: {
        products: [],
        processes: [],
        data: [],
        customers: [],
        patients: [],
      },
      risk_evaluation: null,
      missing_risk_information: [],
      escalations: [],
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
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER_ID })),
    resolve_context: vi.fn(async () => ({
      authentication: {
        principal: { principal_type: "human", user_id: USER_ID },
      },
      tenant: { organization_id: ORGANIZATION_ID },
      owner_user_id: USER_ID,
    })),
    create_advisory_service: createAdvisoryService,
    now: () => new Date("2026-09-02T12:00:00.000Z"),
    generate_uuid: vi.fn()
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(CORRELATION_ID)
      .mockReturnValue("90000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
  };
  return { dependencies, execute, createAdvisoryService };
}

function request(body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request(`https://lvtchat.com/api/capa/${CASE_ID}/containment-risk-advisory`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function run(
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  const test = setup();
  const response = await handleCapaContainmentRiskAdvisoryPost(
    request(body, headers),
    CASE_ID,
    test.dependencies as never,
  );
  return { ...test, response };
}

describe("CAPA containment-risk advisory route", () => {
  it("passes an empty browser request through the governed validator defaults", async () => {
    const test = await run({});

    expect(test.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          requested_output: "containment_risk_analysis",
          focus: null,
          untrusted_human_draft: null,
        },
      }),
    );
  });

  it("passes trusted identity and the normalized request to execute", async () => {
    const test = await run({ focus: "  Ｆｏｃｕｓ  " });
    expect(test.response.status).toBe(201);
    expect(test.createAdvisoryService).toHaveBeenCalledWith(expect.objectContaining({
      tenant: { organization_id: ORGANIZATION_ID },
      owner_user_id: USER_ID,
    }));
    expect(test.execute).toHaveBeenCalledWith({
      organization_id: ORGANIZATION_ID,
      capa_case_id: CASE_ID,
      user_id: USER_ID,
      request_id: REQUEST_ID,
      correlation_id: CORRELATION_ID,
      request: {
        requested_output: "containment_risk_analysis",
        focus: "Focus",
        untrusted_human_draft: null,
      },
    });
  });

  it("preserves an untrusted human draft and returns the governed success envelope", async () => {
    const draft = validDraft();
    const test = await run({ untrusted_human_draft: draft });
    expect(test.execute).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        untrusted_human_draft: expect.objectContaining({
          trust: "untrusted_human_draft",
        }),
      }),
    }));
    const body = await test.response.json();
    expect(body).toEqual({
      advisory: completedAdvisory(),
      snapshot: { capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 2 },
      correlation_id: CORRELATION_ID,
    });
    expect(test.response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses valid trace headers and replaces malformed headers with generated UUIDs", async () => {
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

  it.each([
    ["unauthenticated", async (test: ReturnType<typeof setup>) => { test.dependencies.get_session_facts = vi.fn(async () => null) as never; }],
  ])("rejects %s before service creation", async (_name, mutate) => {
    const test = setup();
    await mutate(test);
    const response = await handleCapaContainmentRiskAdvisoryPost(request(), CASE_ID, test.dependencies as never);
    expect(response.status).toBe(401);
    expect(test.createAdvisoryService).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("maps context and tenant failures safely", async () => {
    const contextTest = setup();
    contextTest.dependencies.resolve_context = vi.fn(async () => { throw new SupabaseCapaContextError("SESSION_INACTIVE"); }) as never;
    const contextResponse = await handleCapaContainmentRiskAdvisoryPost(request(), CASE_ID, contextTest.dependencies as never);
    expect(contextResponse.status).toBe(401);
    expect((await contextResponse.json()).error.code).toBe("INVALID_SESSION_CONTEXT");

    const tenantTest = setup();
    tenantTest.dependencies.resolve_context = vi.fn(async () => { throw new SupabaseCapaTenantAccessError("NO_ACTIVE_MEMBERSHIP"); }) as never;
    const tenantResponse = await handleCapaContainmentRiskAdvisoryPost(request(), CASE_ID, tenantTest.dependencies as never);
    expect(tenantResponse.status).toBe(403);
    const tenantBody = await tenantResponse.text();
    expect(tenantBody).toContain("CAPA_TENANT_ACCESS_DENIED");
    expect(tenantBody).not.toContain(ORGANIZATION_ID);
  });

  it.each([
    ["invalid case", "not-a-uuid", {}],
    ["malformed json", CASE_ID, undefined],
  ] as const)("rejects %s before execute", async (_name, caseId, body) => {
    const test = setup();
    const malformed = body === undefined
      ? new Request("https://lvtchat.com", { method: "POST", body: "{bad" })
      : request(body);
    const response = await handleCapaContainmentRiskAdvisoryPost(malformed, caseId, test.dependencies as never);
    expect(response.status).toBe(400);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    { organization_id: "browser" },
    { request_id: REQUEST_ID },
    { correlation_id: CORRELATION_ID },
    { workflow_state: "S90" },
    { model: "browser-model" },
  ])("rejects unsupported browser field %j", async (body) => {
    const test = await run(body);
    expect(test.response.status).toBe(400);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["CASE_NOT_FOUND_OR_NOT_AUTHORIZED", 404, "CAPA_ADVISORY_CASE_NOT_FOUND"],
    ["CASE_NOT_IN_CONTAINMENT_RISK", 409, "CAPA_ADVISORY_CASE_STATE_CONFLICT"],
    ["ADVISORY_ACCESS_DENIED", 403, "CAPA_ADVISORY_ACCESS_DENIED"],
    ["AGENT_NOT_ELIGIBLE", 409, "CAPA_ADVISORY_AGENT_NOT_ELIGIBLE"],
    ["WORKFLOW_MUTATION_DETECTED", 409, "CAPA_ADVISORY_CASE_CHANGED"],
    ["ADVISORY_GENERATION_FAILED", 500, "CAPA_INTERNAL_ERROR"],
    ["INVALID_ADVISORY_RESULT", 500, "CAPA_INTERNAL_ERROR"],
    ["ADVISORY_PERSISTENCE_FAILED", 500, "CAPA_INTERNAL_ERROR"],
  ] as const)("maps service reason %s to safe HTTP %d", async (reason, status, code) => {
    const test = setup();
    test.execute.mockRejectedValueOnce(new CapaContainmentRiskAdvisoryServiceError(reason));
    const response = await handleCapaContainmentRiskAdvisoryPost(request(), CASE_ID, test.dependencies as never);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    if (status === 500) expect(test.dependencies.logger.error).toHaveBeenCalled();
  });

  it("sanitizes unexpected and service-factory failures", async () => {
    const unexpected = setup();
    unexpected.execute.mockRejectedValueOnce(new Error("provider-secret database-detail"));
    const response = await handleCapaContainmentRiskAdvisoryPost(request(), CASE_ID, unexpected.dependencies as never);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("CAPA_INTERNAL_ERROR");
    expect(body).not.toContain("provider-secret");
    expect(unexpected.dependencies.logger.error).toHaveBeenCalled();

    const factory = setup();
    factory.dependencies.create_advisory_service = vi.fn(() => { throw new Error("configuration-secret"); }) as never;
    const factoryResponse = await handleCapaContainmentRiskAdvisoryPost(request(), CASE_ID, factory.dependencies as never);
    expect(factoryResponse.status).toBe(500);
    expect(await factoryResponse.text()).not.toContain("configuration-secret");
    expect(factory.dependencies.logger.error).toHaveBeenCalled();
  });
});
