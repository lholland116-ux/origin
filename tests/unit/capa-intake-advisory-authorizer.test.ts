import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PolicyBackedCapaIntakeAdvisoryAuthorizer,
} from "../../lib/capa/authorization/capa-intake-advisory-authorizer";

const ORG =
  "10000000-0000-4000-8000-000000000001";
const USER =
  "20000000-0000-4000-8000-000000000001";

function setup(
  decision: "allow" | "deny" = "allow",
  now: () => Date = () =>
    new Date(
      "2026-08-25T18:00:00.000Z",
    ),
) {
  const evaluate = vi.fn(async () => ({
    decision,
    reason_code:
      decision === "allow"
        ? "AUTHORIZED"
        : "DENIED",
    policy_version: "policy-1",
    evaluated_at:
      "2026-08-25T18:00:00.000Z",
    ...(decision === "allow"
      ? {
          relied_on_role_assignment_ids:
            [],
        }
      : {}),
  }));
  const authorizer =
    new PolicyBackedCapaIntakeAdvisoryAuthorizer({
      authentication: {
        principal: {
          principal_type: "human",
          user_id: USER,
        },
        session_id: "session-1",
        authentication_method:
          "PASSWORD",
        assurance_level: "AAL1",
        authenticated_at:
          "2026-08-25T17:00:00.000Z",
        expires_at:
          "2026-08-25T19:00:00.000Z",
      },
      tenant: {
        organization_id: ORG,
        access_grant_id: "grant-1",
        access_path:
          "SUPABASE_MEMBERSHIP",
        authorization_policy_version:
          "policy-1",
        resolved_at:
          "2026-08-25T17:00:00.000Z",
        role_assignments: [],
      },
      policy: { evaluate },
      now,
    } as never);

  return { authorizer, evaluate };
}

function request(
  overrides: Record<string, unknown> = {},
) {
  return {
    context: {
      organization_id: ORG,
      capa_case_id:
        "30000000-0000-4000-8000-000000000001",
      case_version_id:
        "40000000-0000-4000-8000-000000000001",
      record_version: 2,
      workflow_state: "S10",
      user_id: USER,
      active_role_ids: ["CAPA_OWNER"],
      minimum_case_context: [],
      ...overrides,
    },
    operation:
      "draft_intake_analysis",
  } as never;
}

describe(
  "CAPA intake advisory authorizer",
  () => {
    it("uses the dedicated AI advisory operation and purpose", async () => {
      const test = setup();

      await expect(
        test.authorizer.authorize(
          request(),
        ),
      ).resolves.toBe(true);

      expect(
        test.evaluate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          operation:
            "request_ai_intake_advisory",
          purpose:
            "CAPA_AI_INTAKE_ADVISORY",
          resource:
            expect.objectContaining({
              organization_id: ORG,
              workflow_state: "S10",
            }),
        }),
      );
    });

    for (const mismatch of [
      { user_id: "other-user" },
      { organization_id: "other-org" },
      { workflow_state: "S00" },
    ]) {
      it(`fails closed for context mismatch ${Object.keys(mismatch)[0]}`, async () => {
        const test = setup();

        await expect(
          test.authorizer.authorize(
            request(mismatch),
          ),
        ).resolves.toBe(false);
        expect(
          test.evaluate,
        ).not.toHaveBeenCalled();
      });
    }

    it("does not convert policy denial into authorization", async () => {
      const test = setup("deny");

      await expect(
        test.authorizer.authorize(
          request(),
        ),
      ).resolves.toBe(false);
    });

    it("fails closed on invalid trusted time", async () => {
      const test = setup(
        "allow",
        () => new Date("invalid"),
      );

      await expect(
        test.authorizer.authorize(
          request(),
        ),
      ).resolves.toBe(false);
      expect(
        test.evaluate,
      ).not.toHaveBeenCalled();
    });
  },
);
