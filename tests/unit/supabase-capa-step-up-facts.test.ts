import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveSupabaseCapaStepUpFacts,
  SupabaseCapaStepUpFactsError,
} from "../../lib/security/supabase-capa-step-up-facts";

describe(
  "Supabase CAPA step-up fact minimization",
  () => {
    it(
      "keeps aal1 single-factor without deriving reauthentication",
      () => {
        expect(
          deriveSupabaseCapaStepUpFacts({
            aal: "aal1",
            amr: [
              {
                method: "password",
                timestamp: 1_777_000_000,
              },
            ],
          }),
        ).toEqual({
          verified_aal: "aal1",
        });
      },
    );

    it(
      "derives timestamped TOTP step-up from verified aal2 AMR",
      () => {
        expect(
          deriveSupabaseCapaStepUpFacts({
            aal: "aal2",
            amr: [
              {
                method: "password",
                timestamp: 1_777_000_000,
              },
              {
                method: "mfa/totp",
                timestamp: 1_777_000_300,
              },
            ],
          }),
        ).toEqual({
          verified_aal: "aal2",
          verified_reauthenticated_at_epoch_seconds:
            1_777_000_300,
        });
      },
    );

    it(
      "accepts Supabase qualifying MFA method vocabulary",
      () => {
        for (
          const method of [
            "totp",
            "mfa/totp",
            "mfa/phone",
            "mfa/webauthn",
          ] as const
        ) {
          expect(
            deriveSupabaseCapaStepUpFacts({
              aal: "aal2",
              amr: [
                {
                  method,
                  timestamp:
                    1_777_000_500,
                },
              ],
            }),
          ).toEqual({
            verified_aal:
              "aal2",
            verified_reauthenticated_at_epoch_seconds:
              1_777_000_500,
          });
        }
      },
    );

    it(
      "uses the latest qualifying second-factor timestamp",
      () => {
        expect(
          deriveSupabaseCapaStepUpFacts({
            aal: "aal2",
            amr: [
              {
                method: "mfa/totp",
                timestamp: 1_777_000_100,
              },
              {
                method: "mfa/webauthn",
                timestamp: 1_777_000_900,
              },
              {
                method: "password",
                timestamp: 1_777_001_000,
              },
            ],
          }),
        ).toEqual({
          verified_aal: "aal2",
          verified_reauthenticated_at_epoch_seconds:
            1_777_000_900,
        });
      },
    );

    it(
      "does not invent recency from legacy string AMR",
      () => {
        expect(
          deriveSupabaseCapaStepUpFacts({
            aal: "aal2",
            amr: [
              "password",
              "mfa/totp",
            ],
          }),
        ).toEqual({
          verified_aal: "aal2",
        });
      },
    );

    it(
      "does not treat ordinary OTP or password as CAPA MFA step-up evidence",
      () => {
        expect(
          deriveSupabaseCapaStepUpFacts({
            aal: "aal2",
            amr: [
              {
                method: "password",
                timestamp:
                  1_777_000_100,
              },
              {
                method: "otp",
                timestamp:
                  1_777_000_200,
              },
            ],
          }),
        ).toEqual({
          verified_aal: "aal2",
        });
      },
    );

    it(
      "fails closed for an unrecognized verified AAL",
      () => {
        expect(
          () =>
            deriveSupabaseCapaStepUpFacts({
              aal: "aal3",
              amr: [],
            }),
        ).toThrow(
          SupabaseCapaStepUpFactsError,
        );
      },
    );
  },
);
