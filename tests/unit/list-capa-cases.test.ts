import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  RoleId,
  UserId,
} from "../../lib/capa/domain/capa-types";

import type {
  AuthenticationContext,
  SessionId,
} from "../../lib/security/auth-context";

import type {
  RoleAssignmentId,
  TenantAccessGrantId,
  TenantContext,
} from "../../lib/security/tenant-context";

import type {
  CapaAuthorizationPolicy,
  CapaPolicyDecision,
  CapaPolicyEvaluationRequest,
} from "../../lib/capa/authorization/capa-policy";

import type {
  CapaCaseListCursor,
  CapaCaseListPage,
  CapaCaseListQuery,
  CapaRepository,
} from "../../lib/database/repositories/capa-repository";

import {
  DEFAULT_CAPA_CASE_LIST_LIMIT,
  ListCapaCasesConfigurationError,
  MAXIMUM_CAPA_CASE_LIST_LIMIT,
  listCapaCases,
  type ListCapaCasesDependencies,
} from "../../lib/capa/application/list-capa-cases";

const NOW =
  new Date("2026-08-20T14:00:00.000Z");

const NOW_ISO =
  NOW.toISOString() as IsoDateTime;

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as
    OrganizationId;

const USER_ID =
  "20000000-0000-4000-8000-000000000002" as
    UserId;

const ROLE_ASSIGNMENT_ID =
  "30000000-0000-4000-8000-000000000003" as
    RoleAssignmentId;

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function authentication():
  AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id: USER_ID,
    },
    session_id:
      "session-list-capa-cases" as
        SessionId,
    authentication_method:
      controlled("PASSWORD"),
    assurance_level:
      controlled("AAL1"),
    authenticated_at:
      "2026-08-20T13:00:00.000Z" as
        IsoDateTime,
    expires_at:
      "2026-08-20T15:00:00.000Z" as
        IsoDateTime,
  };
}

function tenant(): TenantContext {
  return {
    organization_id:
      ORGANIZATION_ID,
    access_grant_id:
      "list-access-grant" as
        TenantAccessGrantId,
    access_path:
      controlled("MEMBERSHIP"),
    authorization_policy_version:
      "policy-1.0.0",
    resolved_at:
      NOW_ISO,
    role_assignments: [
      {
        role_assignment_id:
          ROLE_ASSIGNMENT_ID,
        role_id:
          "CAPA_OWNER" as RoleId,
        scope:
          controlled("ORGANIZATION"),
        effective_at:
          "2026-08-20T12:00:00.000Z" as
            IsoDateTime,
      },
    ],
  };
}

function allowDecision():
  CapaPolicyDecision {
  return {
    decision: "allow",
    reason_code:
      controlled("CAPA_VIEW_ALLOWED"),
    policy_version:
      "policy-1.0.0",
    evaluated_at:
      NOW_ISO,
    relied_on_role_assignment_ids: [
      ROLE_ASSIGNMENT_ID,
    ],
  };
}

interface Harness {
  readonly dependencies:
    ListCapaCasesDependencies;
  readonly policy_requests:
    CapaPolicyEvaluationRequest[];
  readonly repository_queries:
    CapaCaseListQuery[];
  setDecision(
    decision: CapaPolicyDecision,
  ): void;
  setPage(page: CapaCaseListPage): void;
}

function createHarness(): Harness {
  const policyRequests:
    CapaPolicyEvaluationRequest[] = [];

  const repositoryQueries:
    CapaCaseListQuery[] = [];

  let decision = allowDecision();

  let page: CapaCaseListPage = {
    cases: [],
  };

  const authorizationPolicy:
    CapaAuthorizationPolicy = {
    async evaluate(request) {
      policyRequests.push(request);
      return decision;
    },
  };

  const repository = {
    async listCases(query) {
      repositoryQueries.push(query);
      return page;
    },
  } as Pick<
    CapaRepository,
    "listCases"
  > as CapaRepository;

  return {
    dependencies: {
      repository,
      authorization_policy:
        authorizationPolicy,
      clock: {
        now() {
          return NOW;
        },
      },
    },
    policy_requests:
      policyRequests,
    repository_queries:
      repositoryQueries,
    setDecision(nextDecision) {
      decision = nextDecision;
    },
    setPage(nextPage) {
      page = nextPage;
    },
  };
}

describe("listCapaCases", () => {
  it("lists the authorized organization using the controlled default limit", async () => {
    const harness = createHarness();
    const expectedPage: CapaCaseListPage = {
      cases: [],
    };

    harness.setPage(expectedPage);

    const result = await listCapaCases(
      harness.dependencies,
      {
        authentication:
          authentication(),
        tenant: tenant(),
      },
    );

    expect(result).toEqual({
      status: "listed",
      page: expectedPage,
    });

    expect(
      harness.repository_queries,
    ).toEqual([
      {
        organization_id:
          ORGANIZATION_ID,
        limit:
          DEFAULT_CAPA_CASE_LIST_LIMIT,
      },
    ]);
  });

  it("passes an explicit maximum limit and cursor unchanged", async () => {
    const harness = createHarness();

    const cursor = {
      created_at:
        "2026-08-19T14:00:00.000Z" as
          IsoDateTime,
      capa_case_id:
        "40000000-0000-4000-8000-000000000004",
    } as CapaCaseListCursor;

    await listCapaCases(
      harness.dependencies,
      {
        authentication:
          authentication(),
        tenant: tenant(),
        limit:
          MAXIMUM_CAPA_CASE_LIST_LIMIT,
        cursor,
      },
    );

    expect(
      harness.repository_queries,
    ).toEqual([
      {
        organization_id:
          ORGANIZATION_ID,
        limit:
          MAXIMUM_CAPA_CASE_LIST_LIMIT,
        cursor,
      },
    ]);
  });

  it("sends the exact collection authorization request", async () => {
    const harness = createHarness();
    const authenticationContext =
      authentication();
    const tenantContext = tenant();

    await listCapaCases(
      harness.dependencies,
      {
        authentication:
          authenticationContext,
        tenant: tenantContext,
      },
    );

    expect(
      harness.policy_requests,
    ).toEqual([
      {
        authentication:
          authenticationContext,
        tenant: tenantContext,
        operation: "view_case",
        resource: {
          organization_id:
            ORGANIZATION_ID,
          resource_type:
            "CAPA_CASE_COLLECTION",
        },
        purpose:
          "CAPA_CASE_ACCESS",
        trusted_now: NOW,
      },
    ]);
  });

  it("returns a controlled authorization denial without querying cases", async () => {
    const harness = createHarness();

    harness.setDecision({
      decision: "deny",
      reason_code:
        controlled("VIEW_DENIED"),
      policy_version:
        "policy-2.0.0",
      evaluated_at:
        NOW_ISO,
    });

    const result = await listCapaCases(
      harness.dependencies,
      {
        authentication:
          authentication(),
        tenant: tenant(),
      },
    );

    expect(result).toEqual({
      status:
        "authorization_denied",
      reason_code: "VIEW_DENIED",
      policy_version:
        "policy-2.0.0",
    });

    expect(
      harness.repository_queries,
    ).toEqual([]);
  });

  it("returns a controlled step-up decision without querying cases", async () => {
    const harness = createHarness();

    harness.setDecision({
      decision: "step_up",
      reason_code:
        controlled(
          "STEP_UP_REAUTHENTICATION_REQUIRED",
        ),
      policy_version:
        "policy-2.0.0",
      evaluated_at:
        NOW_ISO,
      required_assurance:
        controlled("MFA"),
    });

    const result = await listCapaCases(
      harness.dependencies,
      {
        authentication:
          authentication(),
        tenant: tenant(),
      },
    );

    expect(result).toEqual({
      status:
        "step_up_required",
      reason_code:
        "STEP_UP_REAUTHENTICATION_REQUIRED",
      policy_version:
        "policy-2.0.0",
      required_assurance: "MFA",
    });

    expect(
      harness.repository_queries,
    ).toEqual([]);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1,
    1.5,
    MAXIMUM_CAPA_CASE_LIST_LIMIT + 1,
  ])(
    "rejects invalid list limit %s before authorization",
    async (limit) => {
      const harness = createHarness();

      await expect(
        listCapaCases(
          harness.dependencies,
          {
            authentication:
              authentication(),
            tenant: tenant(),
            limit,
          },
        ),
      ).rejects.toThrow(
        ListCapaCasesConfigurationError,
      );

      expect(
        harness.policy_requests,
      ).toEqual([]);

      expect(
        harness.repository_queries,
      ).toEqual([]);
    },
  );

  it("rejects an invalid trusted time before authorization", async () => {
    const harness = createHarness();

    const dependencies: ListCapaCasesDependencies = {
      ...harness.dependencies,
      clock: {
        now() {
          return new Date(
            Number.NaN,
          );
        },
      },
    };

    await expect(
      listCapaCases(dependencies, {
        authentication:
          authentication(),
        tenant: tenant(),
      }),
    ).rejects.toThrow(
      "The trusted server clock returned an invalid time.",
    );

    expect(
      harness.policy_requests,
    ).toEqual([]);
  });

  it("uses a stable named configuration error", () => {
    const error =
      new ListCapaCasesConfigurationError(
        "invalid configuration",
      );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(
      "ListCapaCasesConfigurationError",
    );
    expect(error.message).toBe(
      "invalid configuration",
    );
  });

  it("propagates an authorization-policy failure", async () => {
    const harness = createHarness();
    const policyError =
      new Error("policy unavailable");

    const evaluate = vi.fn(
      async () => {
        throw policyError;
      },
    );

    await expect(
      listCapaCases(
        {
          ...harness.dependencies,
          authorization_policy: {
            evaluate,
          },
        },
        {
          authentication:
            authentication(),
          tenant: tenant(),
        },
      ),
    ).rejects.toBe(policyError);

    expect(evaluate).toHaveBeenCalledOnce();
    expect(
      harness.repository_queries,
    ).toEqual([]);
  });

  it("propagates a repository failure after authorization", async () => {
    const harness = createHarness();
    const repositoryError =
      new Error("repository unavailable");

    const listCases = vi.fn(
      async () => {
        throw repositoryError;
      },
    );

    await expect(
      listCapaCases(
        {
          ...harness.dependencies,
          repository: {
            ...harness.dependencies
              .repository,
            listCases,
          },
        },
        {
          authentication:
            authentication(),
          tenant: tenant(),
        },
      ),
    ).rejects.toBe(repositoryError);

    expect(listCases).toHaveBeenCalledWith({
      organization_id:
        ORGANIZATION_ID,
      limit:
        DEFAULT_CAPA_CASE_LIST_LIMIT,
    });
  });
});