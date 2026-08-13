import { describe, expect, it, vi } from "vitest";

import type postgres from "postgres";

import {
  SupabaseCapaContextError,
  type SupabaseCapaSessionFacts,
} from "../../lib/security/supabase-capa-context";

import {
  SupabaseCapaDurableContextResolver,
  SupabaseCapaTenantAccessError,
  type SupabaseCapaTenantAccessFailureReason,
} from "../../lib/security/supabase-capa-durable-context";

const NOW =
  new Date("2026-08-13T15:00:00.000Z");

const USER_ID =
  "10000000-0000-4000-8000-000000000001";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000002";

const MEMBERSHIP_ID =
  "10000000-0000-4000-8000-000000000003";

const OWNER_ASSIGNMENT_ID =
  "10000000-0000-4000-8000-000000000004";

const AUDITOR_ASSIGNMENT_ID =
  "10000000-0000-4000-8000-000000000005";

interface SqlCall {
  readonly query: string;
  readonly values: readonly unknown[];
}

interface SqlHarness {
  readonly sql: postgres.Sql;
  readonly calls: SqlCall[];
  enqueue(...responses: readonly unknown[]): void;
}

function createSqlHarness(): SqlHarness {
  const responses: unknown[] = [];
  const calls: SqlCall[] = [];

  const tagged = vi.fn(
    async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      calls.push({
        query: strings
          .join("?")
          .replace(/\s+/g, " ")
          .trim(),
        values,
      });

      return responses.shift() ?? [];
    },
  );

  return {
    sql: tagged as unknown as postgres.Sql,
    calls,
    enqueue(...nextResponses) {
      responses.push(...nextResponses);
    },
  };
}

function validFacts(
  overrides:
    Partial<SupabaseCapaSessionFacts> = {},
): SupabaseCapaSessionFacts {
  return {
    verified_user_id: USER_ID,
    authenticated_at:
      "2026-08-13T14:00:00.000Z",
    expires_at_epoch_seconds:
      Date.parse(
        "2026-08-13T16:00:00.000Z",
      ) / 1_000,
    ...overrides,
  };
}

function membershipRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    membership_id: MEMBERSHIP_ID,
    organization_id: ORGANIZATION_ID,
    authorization_policy_version:
      "authorization-policy-1.0.0",
    ...overrides,
  };
}

function assignmentRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    role_assignment_id:
      OWNER_ASSIGNMENT_ID,
    role_id: "CAPA_OWNER",
    scope_code: "ORGANIZATION",
    effective_at:
      "2026-08-13T13:00:00.000Z",
    expires_at: null,
    ...overrides,
  };
}

async function expectTenantFailure(
  action: () => Promise<unknown>,
  expectedReason:
    SupabaseCapaTenantAccessFailureReason,
): Promise<void> {
  try {
    await action();
    throw new Error(
      "Expected durable tenant resolution to fail.",
    );
  } catch (error) {
    expect(error).toBeInstanceOf(
      SupabaseCapaTenantAccessError,
    );

    if (
      !(error instanceof SupabaseCapaTenantAccessError)
    ) {
      throw error;
    }

    expect(error.name).toBe(
      "SupabaseCapaTenantAccessError",
    );

    expect(error.reason_code).toBe(
      expectedReason,
    );

    expect(error.message).toBe(
      "The authenticated user does not have an unambiguous active CAPA tenant context.",
    );
  }
}

describe(
  "SupabaseCapaDurableContextResolver",
  () => {
    it(
      "resolves one active tenant and its active organization roles",
      async () => {
        const harness = createSqlHarness();

        harness.enqueue(
          [membershipRow()],
          [
            assignmentRow({
              effective_at:
                new Date(
                  "2026-08-13T13:00:00.000Z",
                ),
            }),
            assignmentRow({
              role_assignment_id:
                AUDITOR_ASSIGNMENT_ID,
              role_id: "CAPA_AUDITOR",
              effective_at:
                "2026-08-13T13:30:00.000Z",
              expires_at:
                new Date(
                  "2026-08-13T15:30:00.000Z",
                ),
            }),
          ],
        );

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expect(
          resolver.resolve(
            validFacts(),
            NOW,
          ),
        ).resolves.toEqual({
          authentication: {
            principal: {
              principal_type: "human",
              user_id: USER_ID,
            },
            session_id:
              `supabase:${USER_ID}:${Date.parse(
                "2026-08-13T16:00:00.000Z",
              ) / 1_000}`,
            authentication_method:
              "SUPABASE_SESSION",
            assurance_level:
              "SINGLE_FACTOR",
            authenticated_at:
              "2026-08-13T14:00:00.000Z",
            expires_at:
              "2026-08-13T16:00:00.000Z",
          },
          tenant: {
            organization_id:
              ORGANIZATION_ID,
            access_grant_id:
              MEMBERSHIP_ID,
            access_path:
              "SUPABASE_MEMBERSHIP",
            authorization_policy_version:
              "authorization-policy-1.0.0",
            resolved_at:
              "2026-08-13T15:00:00.000Z",
            role_assignments: [
              {
                role_assignment_id:
                  OWNER_ASSIGNMENT_ID,
                role_id: "CAPA_OWNER",
                scope: "ORGANIZATION",
                effective_at:
                  "2026-08-13T13:00:00.000Z",
              },
              {
                role_assignment_id:
                  AUDITOR_ASSIGNMENT_ID,
                role_id: "CAPA_AUDITOR",
                scope: "ORGANIZATION",
                effective_at:
                  "2026-08-13T13:30:00.000Z",
                expires_at:
                  "2026-08-13T15:30:00.000Z",
              },
            ],
          },
          owner_user_id: USER_ID,
        });

        expect(harness.calls).toHaveLength(2);

        expect(harness.calls[0]?.query).toContain(
          "limit 2",
        );

        expect(harness.calls[0]?.values).toEqual([
          USER_ID,
          NOW.toISOString(),
          NOW.toISOString(),
          NOW.toISOString(),
          NOW.toISOString(),
        ]);

        expect(harness.calls[1]?.query).toContain(
          "assignment.scope_code = 'ORGANIZATION'",
        );

        expect(harness.calls[1]?.values).toEqual([
          ORGANIZATION_ID,
          MEMBERSHIP_ID,
          USER_ID,
          NOW.toISOString(),
          NOW.toISOString(),
        ]);
      },
    );

    it(
      "supports an active tenant with no active role assignments",
      async () => {
        const harness = createSqlHarness();
        harness.enqueue([membershipRow()], []);

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        const context = await resolver.resolve(
          validFacts(),
          NOW,
        );

        expect(
          context.tenant.role_assignments,
        ).toEqual([]);
      },
    );

    it(
      "validates authentication before querying tenant records",
      async () => {
        const harness = createSqlHarness();

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expect(
          resolver.resolve(
            validFacts({
              verified_user_id:
                "not-a-uuid",
            }),
            NOW,
          ),
        ).rejects.toBeInstanceOf(
          SupabaseCapaContextError,
        );

        expect(harness.calls).toHaveLength(0);
      },
    );

    it(
      "denies a user without an active membership",
      async () => {
        const harness = createSqlHarness();
        harness.enqueue([]);

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expectTenantFailure(
          () =>
            resolver.resolve(
              validFacts(),
              NOW,
            ),
          "NO_ACTIVE_MEMBERSHIP",
        );

        expect(harness.calls).toHaveLength(1);
      },
    );

    it(
      "denies ambiguous active memberships",
      async () => {
        const harness = createSqlHarness();
        harness.enqueue([
          membershipRow(),
          membershipRow({
            membership_id:
              "20000000-0000-4000-8000-000000000003",
            organization_id:
              "20000000-0000-4000-8000-000000000002",
          }),
        ]);

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expectTenantFailure(
          () =>
            resolver.resolve(
              validFacts(),
              NOW,
            ),
          "AMBIGUOUS_ACTIVE_MEMBERSHIP",
        );
      },
    );

    it(
      "rejects a malformed single membership result",
      async () => {
        const harness = createSqlHarness();
        harness.enqueue([undefined]);

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expectTenantFailure(
          () =>
            resolver.resolve(
              validFacts(),
              NOW,
            ),
          "INVALID_MEMBERSHIP_DATA",
        );
      },
    );

    it.each([
      {
        membership_id: "not-a-uuid",
      },
      {
        organization_id: "not-a-uuid",
      },
      {
        authorization_policy_version: "",
      },
      {
        authorization_policy_version:
          " policy-1 ",
      },
      {
        authorization_policy_version:
          "x".repeat(101),
      },
    ])(
      "rejects malformed membership data: %j",
      async (overrides) => {
        const harness = createSqlHarness();
        harness.enqueue([
          membershipRow(overrides),
        ]);

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expectTenantFailure(
          () =>
            resolver.resolve(
              validFacts(),
              NOW,
            ),
          "INVALID_MEMBERSHIP_DATA",
        );
      },
    );

    it.each([
      {
        scope_code: "CASE",
      },
      {
        role_assignment_id:
          "not-a-uuid",
      },
      {
        role_id: "",
      },
      {
        role_id: "x".repeat(65),
      },
      {
        role_id: "INVALID ROLE",
      },
      {
        effective_at: "not-a-date",
      },
      {
        expires_at: "not-a-date",
      },
    ])(
      "rejects malformed role-assignment data: %j",
      async (overrides) => {
        const harness = createSqlHarness();
        harness.enqueue(
          [membershipRow()],
          [assignmentRow(overrides)],
        );

        const resolver =
          new SupabaseCapaDurableContextResolver(
            harness.sql,
          );

        await expectTenantFailure(
          () =>
            resolver.resolve(
              validFacts(),
              NOW,
            ),
          "INVALID_ROLE_ASSIGNMENT_DATA",
        );
      },
    );
  },
);