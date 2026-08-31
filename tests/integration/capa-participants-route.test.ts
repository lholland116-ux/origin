import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ORG = "20000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({ createDependencies: vi.fn() }));
vi.mock("../../app/api/capa/capa-next-route-dependencies", () => ({
  createCapaApiHandlerDependencies: mocks.createDependencies,
}));

import { GET, dynamic, runtime } from "../../app/api/capa/participants/route";

function dependencies(role = "CAPA_OWNER", principalType = "human") {
  const list = vi.fn().mockResolvedValue([
    { user_id: USER, display_label: null },
    { user_id: OTHER, display_label: null },
  ]);
  return {
    get_session_facts: vi.fn().mockResolvedValue({ verified_user_id: USER }),
    resolve_context: vi.fn().mockResolvedValue({
      authentication: {
        principal: { principal_type: principalType, user_id: USER },
        session_id: "session", authentication_method: "SUPABASE_SESSION",
        assurance_level: "SINGLE_FACTOR", authenticated_at: "2026-09-01T11:00:00.000Z",
        expires_at: "2026-09-01T13:00:00.000Z",
      },
      tenant: {
        organization_id: ORG, access_grant_id: "grant", access_path: "SUPABASE_MEMBERSHIP",
        authorization_policy_version: "policy-1", resolved_at: "2026-09-01T12:00:00.000Z",
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

async function request(query = "?purpose=investigation_owner") {
  return GET(new Request(`http://localhost/api/capa/participants${query}`));
}

describe("GET /api/capa/participants Next route", () => {
  beforeEach(() => { mocks.createDependencies.mockReset(); });

  it("uses dynamic Node route wiring and returns a minimized tenant-scoped response", async () => {
    const deps = dependencies();
    deps.list.mockResolvedValue([
      { user_id: USER, display_label: null },
      { user_id: OTHER, display_label: null },
    ]);
    mocks.createDependencies.mockReturnValue(deps);
    const response = await request();
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(mocks.createDependencies).toHaveBeenCalledOnce();
    expect(deps.list).toHaveBeenCalledWith(ORG, new Date("2026-09-01T12:00:00.000Z"));
    expect(await response.json()).toEqual({
      purpose: "investigation_owner",
      participants: [
        { user_id: USER, display_label: null },
        { user_id: OTHER, display_label: null },
      ], correlation_id: "50000000-0000-4000-8000-000000000001",
    });
  });

  it("returns 401 when route dependencies find no session", async () => {
    const deps = dependencies();
    deps.get_session_facts.mockResolvedValue(null);
    mocks.createDependencies.mockReturnValue(deps);
    expect((await request()).status).toBe(401);
  });

  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR"])("allows a %s caller", async (role) => {
    mocks.createDependencies.mockReturnValue(dependencies(role));
    expect((await request()).status).toBe(200);
  });

  it.each(["CAPA_REVIEWER", "CAPA_APPROVER", "CAPA_ORG_ADMIN"])(
    "denies a %s-only caller", async (role) => {
      mocks.createDependencies.mockReturnValue(dependencies(role));
      expect((await request()).status).toBe(403);
    });

  it("denies a non-human principal", async () => {
    mocks.createDependencies.mockReturnValue(dependencies("CAPA_OWNER", "service"));
    expect((await request()).status).toBe(403);
  });

  it.each([
    "", "?purpose=unsupported", "?purpose=investigation_owner&purpose=investigation_owner",
    "?purpose=investigation_owner&organization_id=other",
    "?purpose=investigation_owner&role_id=CAPA_OWNER",
  ])("rejects invalid route query %s", async (query) => {
    mocks.createDependencies.mockReturnValue(dependencies());
    expect((await request(query)).status).toBe(400);
  });

  it("returns repository-collapsed participants and cannot substitute a browser tenant", async () => {
    const deps = dependencies();
    deps.list.mockResolvedValue([{ user_id: USER, display_label: null }]);
    mocks.createDependencies.mockReturnValue(deps);
    const response = await request();
    expect(deps.list).toHaveBeenCalledWith(ORG, expect.any(Date));
    expect(await response.json()).toMatchObject({
      participants: [{ user_id: USER, display_label: null }],
    });
  });
});
