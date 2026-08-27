import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PolicyBackedCapaAiOutputReviewAuthorizer,
} from "../../lib/capa/authorization/capa-ai-output-review-authorizer";

const ORG =
  "10000000-0000-4000-8000-000000000001";

const USER =
  "20000000-0000-4000-8000-000000000001";

const CASE_ID =
  "30000000-0000-4000-8000-000000000001";

const CASE_VERSION_ID =
  "40000000-0000-4000-8000-000000000001";

const OUTPUT_ID =
  "50000000-0000-4000-8000-000000000001";

function setup(
  options: {
    readonly decision?:
      "allow" | "deny";
    readonly principal_type?:
      "human" | "service";
    readonly now?:
      () => Date;
    readonly throw_policy?:
      boolean;
  } = {},
) {
  const decision =
    options.decision ??
      "allow";

  const evaluate =
    vi.fn(
      async () => {
        if (
          options.throw_policy ===
          true
        ) {
          throw new Error(
            "Policy failure.",
          );
        }

        return {
          decision,
          reason_code:
            decision === "allow"
              ? "AUTHORIZED"
              : "DENIED",
          policy_version:
            "policy-1",
          evaluated_at:
            "2026-08-26T19:00:00.000Z",
          ...(decision === "allow"
            ? {
                relied_on_role_assignment_ids:
                  [],
              }
            : {}),
        };
      },
    );

  const principal =
    options.principal_type ===
      "service"
      ? {
          principal_type:
            "service",
          service_id:
            "service-1",
        }
      : {
          principal_type:
            "human",
          user_id:
            USER,
        };

  const authorizer =
    new PolicyBackedCapaAiOutputReviewAuthorizer(
      {
        authentication: {
          principal,
          session_id:
            "session-1",
          authentication_method:
            "PASSWORD",
          assurance_level:
            "AAL1",
          authenticated_at:
            "2026-08-26T18:00:00.000Z",
          expires_at:
            "2026-08-26T20:00:00.000Z",
        },

        tenant: {
          organization_id:
            ORG,
          access_grant_id:
            "grant-1",
          access_path:
            "SUPABASE_MEMBERSHIP",
          authorization_policy_version:
            "policy-1",
          resolved_at:
            "2026-08-26T18:00:00.000Z",
          role_assignments:
            [],
        },

        policy: {
          evaluate,
        },

        now:
          options.now ??
          (() =>
            new Date(
              "2026-08-26T19:00:00.000Z",
            )),
      } as never,
    );

  return {
    authorizer,
    evaluate,
  };
}

function request(
  overrides: {
    readonly actor_id?:
      string;
    readonly organization_id?:
      string;
    readonly record_version?:
      number;
  } = {},
) {
  return {
    organization_id:
      overrides.organization_id ??
        ORG,

    capa_case_id:
      CASE_ID,

    case_version_id:
      CASE_VERSION_ID,

    record_version:
      overrides.record_version ??
        2,

    output_id:
      OUTPUT_ID,

    reviewer: {
      actor_type:
        "human",
      actor_id:
        overrides.actor_id ??
          USER,
    },
  } as never;
}

describe(
  "CAPA AI-output review authorizer",
  () => {
    it("uses the dedicated AI-review operation, purpose and exact review context", async () => {
      const test =
        setup();

      await expect(
        test.authorizer
          .authorizeAiOutputReview(
            request(),
          ),
      ).resolves.toBe(true);

      expect(
        test.evaluate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          operation:
            "review_ai_intake_advisory",

          purpose:
            "CAPA_AI_INTAKE_ADVISORY_REVIEW",

          resource:
            expect.objectContaining({
              organization_id:
                ORG,

              resource_type:
                "CAPA_AI_OUTPUT",

              resource_id:
                OUTPUT_ID,

              resource_version_id:
                CASE_VERSION_ID,

              capa_case_id:
                CASE_ID,

              case_version_id:
                CASE_VERSION_ID,

              workflow_state:
                "S10",
            }),
        }),
      );
    });

    it("fails closed when the reviewer is not the authenticated human", async () => {
      const test =
        setup();

      await expect(
        test.authorizer
          .authorizeAiOutputReview(
            request({
              actor_id:
                "different-user",
            }),
          ),
      ).resolves.toBe(false);

      expect(
        test.evaluate,
      ).not.toHaveBeenCalled();
    });

    it("fails closed for a non-human authenticated principal", async () => {
      const test =
        setup({
          principal_type:
            "service",
        });

      await expect(
        test.authorizer
          .authorizeAiOutputReview(
            request(),
          ),
      ).resolves.toBe(false);

      expect(
        test.evaluate,
      ).not.toHaveBeenCalled();
    });

    it("fails closed across tenant boundaries", async () => {
      const test =
        setup();

      await expect(
        test.authorizer
          .authorizeAiOutputReview(
            request({
              organization_id:
                "90000000-0000-4000-8000-000000000009",
            }),
          ),
      ).resolves.toBe(false);

      expect(
        test.evaluate,
      ).not.toHaveBeenCalled();
    });

    it("fails closed for invalid exact-version context", async () => {
      const test =
        setup();

      await expect(
        test.authorizer
          .authorizeAiOutputReview(
            request({
              record_version:
                0,
            }),
          ),
      ).resolves.toBe(false);

      expect(
        test.evaluate,
      ).not.toHaveBeenCalled();
    });

    it("does not convert a policy denial into authorization", async () => {
      const test =
        setup({
          decision:
            "deny",
        });

      await expect(
        test.authorizer
          .authorizeAiOutputReview(
            request(),
          ),
      ).resolves.toBe(false);
    });

    it("fails closed when trusted time or policy evaluation fails", async () => {
      const invalidTime =
        setup({
          now: () =>
            new Date(
              Number.NaN,
            ),
        });

      await expect(
        invalidTime.authorizer
          .authorizeAiOutputReview(
            request(),
          ),
      ).resolves.toBe(false);

      expect(
        invalidTime.evaluate,
      ).not.toHaveBeenCalled();

      const policyFailure =
        setup({
          throw_policy:
            true,
        });

      await expect(
        policyFailure.authorizer
          .authorizeAiOutputReview(
            request(),
          ),
      ).resolves.toBe(false);
    });
  },
);
