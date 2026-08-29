import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolveDevelopmentCapaRequestContext,
  SupabaseCapaContextError,
  type SupabaseCapaSessionFacts,
} from "../../lib/security/supabase-capa-context";

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const NOW =
  new Date(
    "2026-08-29T12:00:00.000Z",
  );

function baseFacts():
  SupabaseCapaSessionFacts {
  return {
    verified_user_id:
      USER_ID,

    authenticated_at:
      "2026-08-29T11:00:00.000Z",

    expires_at_epoch_seconds:
      Date.parse(
        "2026-08-29T13:00:00.000Z",
      ) / 1_000,
  };
}

describe(
  "Supabase CAPA trusted step-up context",
  () => {
    it(
      "preserves backward-compatible single-factor behavior when no verified AAL facts are supplied",
      () => {
        const context =
          resolveDevelopmentCapaRequestContext(
            baseFacts(),
            NOW,
          );

        expect(
          context.authentication
            .assurance_level,
        ).toBe(
          "SINGLE_FACTOR",
        );

        expect(
          context.authentication
            .reauthenticated_at,
        ).toBeUndefined();
      },
    );

    it(
      "maps verified aal2 and timestamped MFA evidence to recent CAPA reauthentication",
      () => {
        const context =
          resolveDevelopmentCapaRequestContext(
            {
              ...baseFacts(),

              verified_aal:
                "aal2",

              verified_reauthenticated_at_epoch_seconds:
                Date.parse(
                  "2026-08-29T11:55:00.000Z",
                ) / 1_000,
            },
            NOW,
          );

        expect(
          context.authentication
            .assurance_level,
        ).toBe("MFA");

        expect(
          context.authentication
            .reauthenticated_at,
        ).toBe(
          "2026-08-29T11:55:00.000Z",
        );
      },
    );

    it(
      "represents verified aal2 without timestamped AMR as MFA without claiming recency",
      () => {
        const context =
          resolveDevelopmentCapaRequestContext(
            {
              ...baseFacts(),
              verified_aal:
                "aal2",
            },
            NOW,
          );

        expect(
          context.authentication
            .assurance_level,
        ).toBe("MFA");

        expect(
          context.authentication
            .reauthenticated_at,
        ).toBeUndefined();
      },
    );

    it(
      "rejects reauthentication evidence attached to aal1",
      () => {
        expect(
          () =>
            resolveDevelopmentCapaRequestContext(
              {
                ...baseFacts(),

                verified_aal:
                  "aal1",

                verified_reauthenticated_at_epoch_seconds:
                  Date.parse(
                    "2026-08-29T11:55:00.000Z",
                  ) / 1_000,
              },
              NOW,
            ),
        ).toThrow(
          SupabaseCapaContextError,
        );
      },
    );

    it(
      "rejects future reauthentication timestamps",
      () => {
        expect(
          () =>
            resolveDevelopmentCapaRequestContext(
              {
                ...baseFacts(),

                verified_aal:
                  "aal2",

                verified_reauthenticated_at_epoch_seconds:
                  Date.parse(
                    "2026-08-29T12:05:00.000Z",
                  ) / 1_000,
              },
              NOW,
            ),
        ).toThrow(
          SupabaseCapaContextError,
        );
      },
    );

    it(
      "rejects reauthentication timestamps that predate the authenticated session",
      () => {
        expect(
          () =>
            resolveDevelopmentCapaRequestContext(
              {
                ...baseFacts(),

                verified_aal:
                  "aal2",

                verified_reauthenticated_at_epoch_seconds:
                  Date.parse(
                    "2026-08-29T10:55:00.000Z",
                  ) / 1_000,
              },
              NOW,
            ),
        ).toThrow(
          SupabaseCapaContextError,
        );
      },
    );
  },
);
