import { describe, expect, it, vi } from "vitest";

import {
  handleCapaInvestigationPlanningAdoptionPost,
} from "../../lib/capa/api/capa-investigation-planning-adoption-route-handler";

const CASE_ID = "10000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "20000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000001";

function body(outputId = OUTPUT_ID) {
  return {
    expected_case_version_id: "40000000-0000-4000-8000-000000000001",
    expected_record_version: 3,
    output_id: outputId,
    selected_items: [{
      proposal_key: "P1",
      investigation_question: "Question",
      evidence_target: "Evidence",
      investigation_method: "Method",
      scope_relationship: "Scope",
      owner_user_id: USER,
      due_date: "2026-09-30",
      dependency_proposal_keys: [],
    }],
  };
}

function request(bodyValue: unknown, headers: Record<string, string> = {}) {
  return new Request(
    `http://localhost/api/capa/${CASE_ID}/investigation-planning-advisory/${OUTPUT_ID}/adoptions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "batch-1",
        ...headers,
      },
      body: JSON.stringify(bodyValue),
    },
  );
}

function dependencies(result: any = {
  status: "adopted" as const,
  records: [],
}) {
  const adopt = vi.fn().mockResolvedValue(result);
  return {
    get_session_facts: vi.fn().mockResolvedValue({
      verified_user_id: USER,
      authenticated_at: "2026-09-03T11:00:00.000Z",
      expires_at_epoch_seconds: 1_800_000_000,
    }),
    resolve_context: vi.fn().mockResolvedValue({
      authentication: {},
      tenant: { organization_id: "50000000-0000-4000-8000-000000000001" },
      owner_user_id: USER,
    }),
    create_adoption_service: vi.fn().mockReturnValue({ adopt }),
    now: vi.fn().mockReturnValue(new Date("2026-09-03T12:00:00.000Z")),
    generate_uuid: vi.fn()
      .mockReturnValueOnce("60000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("70000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
    adopt,
  } as any;
}

describe("S30 investigation-planning adoption POST boundary", () => {
  it("requires idempotency and returns no-store successful responses", async () => {
    const missing = dependencies();
    const missingResponse = await handleCapaInvestigationPlanningAdoptionPost(
      request(body(), { "idempotency-key": "" }), CASE_ID, OUTPUT_ID, missing,
    );
    expect(missingResponse.status).toBe(400);

    const test = dependencies();
    const response = await handleCapaInvestigationPlanningAdoptionPost(
      request(body()), CASE_ID, OUTPUT_ID, test,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(test.adopt).toHaveBeenCalledWith(expect.objectContaining({
      capa_case_id: CASE_ID,
      request_trace: expect.objectContaining({ idempotency_key: "batch-1" }),
    }));
    expect(test.adopt.mock.calls[0]![0]).not.toHaveProperty("adopted_by");
  });

  it("rejects output mismatch and maps authorization denial", async () => {
    const mismatch = dependencies();
    const mismatchResponse = await handleCapaInvestigationPlanningAdoptionPost(
      request(body("80000000-0000-4000-8000-000000000001")), CASE_ID, OUTPUT_ID, mismatch,
    );
    expect(mismatchResponse.status).toBe(400);

    const denied = dependencies({
      status: "authorization_denied",
      reason_code: "ADOPTION_NOT_AUTHORIZED",
    });
    const deniedResponse = await handleCapaInvestigationPlanningAdoptionPost(
      request(body()), CASE_ID, OUTPUT_ID, denied,
    );
    expect(deniedResponse.status).toBe(403);
  });

  it("requires authentication before resolving tenant context", async () => {
    const test = dependencies();
    test.get_session_facts.mockResolvedValue(null);
    const response = await handleCapaInvestigationPlanningAdoptionPost(
      request(body()), CASE_ID, OUTPUT_ID, test,
    );
    expect(response.status).toBe(401);
    expect(test.resolve_context).not.toHaveBeenCalled();
  });
});
