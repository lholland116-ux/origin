import { describe, expect, it, vi } from "vitest";

import { handleCapaReleaseInvestigation } from "../../lib/capa/api/capa-route-handler";

const CASE = "30000000-0000-4000-8000-000000000001";

function dependencies() {
  return {
    get_session_facts: vi.fn().mockResolvedValue({
      verified_user_id: "10000000-0000-4000-8000-000000000001",
      authenticated_at: "2026-09-01T11:00:00.000Z",
      expires_at_epoch_seconds: 1788267600,
    }),
    resolve_context: vi.fn().mockReturnValue({
      authentication: {}, tenant: {}, owner_user_id: "user",
    }),
    get_runtime: vi.fn().mockReturnValue({
      release_investigation_dependencies: {},
    }),
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    generate_uuid: vi.fn()
      .mockReturnValueOnce("50000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("60000000-0000-4000-8000-000000000001"),
    logger: { error: vi.fn() },
  } as never;
}

describe("G-03 release route validation", () => {
  it("requires an idempotency key", async () => {
    const response = await handleCapaReleaseInvestigation(
      new Request(`http://localhost/api/capa/${CASE}/release-investigation`, {
        method: "POST", body: "{}", headers: { "content-type": "application/json" },
      }), CASE, dependencies(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_IDEMPOTENCY_KEY" } });
  });

  it("rejects unknown top-level request fields", async () => {
    const response = await handleCapaReleaseInvestigation(
      new Request(`http://localhost/api/capa/${CASE}/release-investigation`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "release-1" },
        body: JSON.stringify({
          expected_record_version: 3,
          expected_current_version_id: "40000000-0000-4000-8000-000000000001",
          investigation_plan: { items: [] }, release: {}, actor_id: "browser",
        }),
      }), CASE, dependencies(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_CAPA_INVESTIGATION_RELEASE" } });
  });
});
