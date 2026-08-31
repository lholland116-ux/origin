import { describe, expect, it, vi } from "vitest";
import { handleCapaParticipantsGet } from "../../lib/capa/api/capa-participants-route-handler";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";

function dependencies(role = "CAPA_OWNER", principalType = "human") {
  const list = vi.fn().mockResolvedValue([
    { user_id: USER, display_label: null },
  ]);
  return {
    get_session_facts: vi.fn().mockResolvedValue({ verified_user_id: USER }),
    resolve_context: vi.fn().mockResolvedValue({
      authentication: {
        principal: { principal_type: principalType, user_id: USER },
        session_id: "session", authentication_method: "SUPABASE_SESSION",
        assurance_level: "SINGLE_FACTOR",
        authenticated_at: "2026-09-01T11:00:00.000Z",
        expires_at: "2026-09-01T13:00:00.000Z",
      },
      tenant: {
        organization_id: ORG, access_grant_id: "grant",
        access_path: "SUPABASE_MEMBERSHIP", authorization_policy_version: "policy-1",
        resolved_at: "2026-09-01T12:00:00.000Z",
        role_assignments: [{ role_assignment_id: "assignment", role_id: role,
          scope: "ORGANIZATION", effective_at: "2026-09-01T10:00:00.000Z" }],
      }, owner_user_id: USER,
    }),
    get_runtime: vi.fn().mockReturnValue({ participant_eligibility_repository: {
      listEligibleInvestigationOwners: list,
    } }),
    now: () => new Date("2026-09-01T12:00:00.000Z"),
    generate_uuid: () => "50000000-0000-4000-8000-000000000001",
    logger: { error: vi.fn() }, list,
  } as any;
}

describe("CAPA participant directory", () => {
  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR"])("allows an active %s caller", async (role) => {
    const deps = dependencies(role);
    const response = await handleCapaParticipantsGet(
      new Request("http://localhost/api/capa/participants?purpose=investigation_owner"), deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      purpose: "investigation_owner",
      participants: [{ user_id: USER, display_label: null }],
      correlation_id: "50000000-0000-4000-8000-000000000001",
    });
  });

  it.each(["CAPA_REVIEWER", "CAPA_APPROVER", "CAPA_ORG_ADMIN", "CAPA_AUDITOR"])(
    "denies a %s-only caller", async (role) => {
      const response = await handleCapaParticipantsGet(
        new Request("http://localhost/api/capa/participants?purpose=investigation_owner"),
        dependencies(role),
      );
      expect(response.status).toBe(403);
    });

  it("denies a service principal", async () => {
    const response = await handleCapaParticipantsGet(
      new Request("http://localhost/api/capa/participants?purpose=investigation_owner"),
      dependencies("CAPA_OWNER", "service"),
    );
    expect(response.status).toBe(403);
  });

  it("returns 401 without authentication", async () => {
    const deps = dependencies();
    deps.get_session_facts = vi.fn().mockResolvedValue(null);
    const response = await handleCapaParticipantsGet(
      new Request("http://localhost/api/capa/participants?purpose=investigation_owner"), deps,
    );
    expect(response.status).toBe(401);
  });

  it("preserves a valid correlation identifier", async () => {
    const correlation = "60000000-0000-4000-8000-000000000001";
    const response = await handleCapaParticipantsGet(new Request(
      "http://localhost/api/capa/participants?purpose=investigation_owner",
      { headers: { "x-correlation-id": correlation } },
    ), dependencies());
    expect(await response.json()).toMatchObject({ correlation_id: correlation });
  });

  it.each([
    "", "?purpose=wrong", "?purpose=investigation_owner&purpose=investigation_owner",
    "?purpose=investigation_owner&organization_id=x",
    "?purpose=investigation_owner&role_id=CAPA_OWNER",
    "?purpose=investigation_owner&user_id=x",
    "?purpose=investigation_owner&membership_id=x",
  ])("rejects unsupported query %s", async (query) => {
    const response = await handleCapaParticipantsGet(
      new Request(`http://localhost/api/capa/participants${query}`), dependencies(),
    );
    expect(response.status).toBe(400);
  });
});
