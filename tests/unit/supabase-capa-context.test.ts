import { describe, expect, it } from "vitest";

import {
  resolveDevelopmentCapaRequestContext,
  resolveSupabaseAuthenticationContext,
  SupabaseCapaContextError,
  type SupabaseCapaContextFailureReason,
  type SupabaseCapaSessionFacts,
} from "../../lib/security/supabase-capa-context";

const NOW =
  new Date("2026-08-12T14:00:00.000Z");

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const VALID_EXPIRATION_SECONDS =
  Date.parse(
    "2026-08-12T15:00:00.000Z",
  ) / 1_000;

function validFacts(
  overrides:
    Partial<SupabaseCapaSessionFacts> = {},
): SupabaseCapaSessionFacts {
  return {
    verified_user_id: USER_ID,
    authenticated_at:
      "2026-08-12T13:00:00.000Z",
    expires_at_epoch_seconds:
      VALID_EXPIRATION_SECONDS,
    ...overrides,
  };
}

async function expectContextFailure(
  action: () => unknown,
  expectedReason:
    SupabaseCapaContextFailureReason,
): Promise<void> {
  try {
    action();
    throw new Error(
      "Expected context resolution to fail.",
    );
  } catch (error) {
    expect(error).toBeInstanceOf(
      SupabaseCapaContextError,
    );

    if (
      !(error instanceof SupabaseCapaContextError)
    ) {
      throw error;
    }

    expect(error.reason_code).toBe(
      expectedReason,
    );

    expect(error.message).toBe(
      "The authenticated CAPA request context could not be resolved.",
    );
  }
}

describe(
  "resolveSupabaseAuthenticationContext",
  () => {
    it(
      "creates minimized provider-neutral authentication",
      () => {
        expect(
          resolveSupabaseAuthenticationContext(
            validFacts(),
            NOW,
          ),
        ).toEqual({
          user_id: USER_ID,
          authentication: {
            principal: {
              principal_type: "human",
              user_id: USER_ID,
            },
            session_id:
              `supabase:${USER_ID}:${VALID_EXPIRATION_SECONDS}`,
            authentication_method:
              "SUPABASE_SESSION",
            assurance_level:
              "SINGLE_FACTOR",
            authenticated_at:
              "2026-08-12T13:00:00.000Z",
            expires_at:
              "2026-08-12T15:00:00.000Z",
          },
        });
      },
    );
  },
);

describe(
  "resolveDevelopmentCapaRequestContext",
  () => {
    it(
      "creates a minimized trusted development context",
      () => {
        const context =
          resolveDevelopmentCapaRequestContext(
            validFacts(),
            NOW,
          );

        expect(context).toEqual({
          authentication: {
            principal: {
              principal_type: "human",
              user_id: USER_ID,
            },
            session_id:
              `supabase:${USER_ID}:${VALID_EXPIRATION_SECONDS}`,
            authentication_method:
              "SUPABASE_SESSION",
            assurance_level:
              "SINGLE_FACTOR",
            authenticated_at:
              "2026-08-12T13:00:00.000Z",
            expires_at:
              "2026-08-12T15:00:00.000Z",
          },

          tenant: {
            organization_id: USER_ID,
            access_grant_id:
              `development-access:${USER_ID}`,
            access_path:
              "DEVELOPMENT_SINGLE_USER_TENANT",
            authorization_policy_version:
              "development-policy-1.0.0",
            resolved_at:
              "2026-08-12T14:00:00.000Z",
            role_assignments: [
              {
                role_assignment_id:
                  `development-role:${USER_ID}`,
                role_id:
                  "CAPA_OWNER",
                scope: "ORGANIZATION",
                effective_at:
                  "2026-08-12T13:00:00.000Z",
                expires_at:
                  "2026-08-12T15:00:00.000Z",
              },
            ],
          },

          owner_user_id: USER_ID,
        });
      },
    );

    it(
      "normalizes surrounding user-id whitespace",
      () => {
        const context =
          resolveDevelopmentCapaRequestContext(
            validFacts({
              verified_user_id:
                `  ${USER_ID}  `,
            }),
            NOW,
          );

        expect(
          context.authentication.principal,
        ).toEqual({
          principal_type: "human",
          user_id: USER_ID,
        });

        expect(
          context.tenant.organization_id,
        ).toBe(USER_ID);
      },
    );

    it(
      "derives different tenant boundaries for different users",
      () => {
        const otherUserId =
          "8eb089a8-d26f-4662-948d-d0fb5d5e81fe";

        const first =
          resolveDevelopmentCapaRequestContext(
            validFacts(),
            NOW,
          );

        const second =
          resolveDevelopmentCapaRequestContext(
            validFacts({
              verified_user_id:
                otherUserId,
            }),
            NOW,
          );

        expect(
          first.tenant.organization_id,
        ).not.toBe(
          second.tenant.organization_id,
        );

        expect(
          first.tenant.access_grant_id,
        ).not.toBe(
          second.tenant.access_grant_id,
        );
      },
    );

    it(
      "rejects an invalid trusted server time",
      async () => {
        await expectContextFailure(
          () =>
            resolveDevelopmentCapaRequestContext(
              validFacts(),
              new Date(Number.NaN),
            ),
          "INVALID_AUTHENTICATED_AT",
        );
      },
    );

    it(
      "rejects empty and malformed verified user identities",
      async () => {
        for (
          const invalidUserId
          of ["   ", "not-a-uuid"]
        ) {
          await expectContextFailure(
            () =>
              resolveDevelopmentCapaRequestContext(
                validFacts({
                  verified_user_id:
                    invalidUserId,
                }),
                NOW,
              ),
            "INVALID_USER_ID",
          );
        }
      },
    );

    it(
      "rejects invalid and future authentication timestamps",
      async () => {
        await expectContextFailure(
          () =>
            resolveDevelopmentCapaRequestContext(
              validFacts({
                authenticated_at:
                  "not-a-date",
              }),
              NOW,
            ),
          "INVALID_AUTHENTICATED_AT",
        );

        await expectContextFailure(
          () =>
            resolveDevelopmentCapaRequestContext(
              validFacts({
                authenticated_at:
                  "2026-08-12T14:00:00.001Z",
              }),
              NOW,
            ),
          "INVALID_AUTHENTICATED_AT",
        );
      },
    );

    it(
      "rejects invalid session-expiration numbers",
      async () => {
        for (
          const invalidExpiration
          of [Number.NaN, 0, -1]
        ) {
          await expectContextFailure(
            () =>
              resolveDevelopmentCapaRequestContext(
                validFacts({
                  expires_at_epoch_seconds:
                    invalidExpiration,
                }),
                NOW,
              ),
            "INVALID_SESSION_EXPIRATION",
          );
        }

        await expectContextFailure(
          () =>
            resolveDevelopmentCapaRequestContext(
              validFacts({
                expires_at_epoch_seconds:
                  Number.MAX_VALUE,
              }),
              NOW,
            ),
          "INVALID_SESSION_EXPIRATION",
        );
      },
    );

    it(
      "rejects expired and exactly expiring sessions",
      async () => {
        const expired =
          Date.parse(
            "2026-08-12T13:59:59.999Z",
          ) / 1_000;

        const exactlyNow =
          NOW.getTime() / 1_000;

        for (
          const expiration
          of [expired, exactlyNow]
        ) {
          await expectContextFailure(
            () =>
              resolveDevelopmentCapaRequestContext(
                validFacts({
                  expires_at_epoch_seconds:
                    expiration,
                }),
                NOW,
              ),
            "SESSION_INACTIVE",
          );
        }
      },
    );
  },
);