import {
  describe,
  expect,
  it,
} from "vitest";

import {
  hasTimestampedTotpAuthenticationMethod,
  normalizedTotpCode,
  verifiedTotpFactorOptions,
} from "../../lib/security/supabase-totp-step-up-ui";

describe(
  "Supabase controlled TOTP step-up UI helpers",
  () => {
    it(
      "returns only verified TOTP factors",
      () => {
        expect(
          verifiedTotpFactorOptions([
            {
              id: "verified-totp",
              factor_type: "totp",
              status: "verified",
              friendly_name:
                "LVTChat Authenticator",
            },
            {
              id: "incomplete-totp",
              factor_type: "totp",
              status: "unverified",
            },
            {
              id: "phone-factor",
              factor_type: "phone",
              status: "verified",
            },
          ]),
        ).toEqual([
          {
            factor_id:
              "verified-totp",
            label:
              "LVTChat Authenticator · 1",
          },
        ]);
      },
    );

    it(
      "uses a neutral label when no friendly name exists",
      () => {
        expect(
          verifiedTotpFactorOptions([
            {
              id: "factor-1",
              factor_type: "totp",
              status: "verified",
            },
          ]),
        ).toEqual([
          {
            factor_id:
              "factor-1",
            label:
              "Authenticator 1",
          },
        ]);
      },
    );

    it(
      "deduplicates factor identifiers and ignores blank identifiers",
      () => {
        expect(
          verifiedTotpFactorOptions([
            {
              id: "factor-1",
              factor_type: "totp",
              status: "verified",
            },
            {
              id: "factor-1",
              factor_type: "totp",
              status: "verified",
            },
            {
              id: "  ",
              factor_type: "totp",
              status: "verified",
            },
          ]),
        ).toHaveLength(1);
      },
    );

    it(
      "accepts a six-digit TOTP code after trimming",
      () => {
        expect(
          normalizedTotpCode(
            " 123456 ",
          ),
        ).toBe("123456");
      },
    );

    it(
      "rejects malformed TOTP codes",
      () => {
        for (
          const value of [
            "",
            "12345",
            "1234567",
            "12a456",
            "12 456",
          ]
        ) {
          expect(
            normalizedTotpCode(
              value,
            ),
          ).toBeNull();
        }
      },
    );

    it(
      "accepts timestamped totp AMR evidence",
      () => {
        expect(
          hasTimestampedTotpAuthenticationMethod([
            {
              method:
                "totp",
              timestamp:
                1_777_000_100,
            },
          ]),
        ).toBe(true);

        expect(
          hasTimestampedTotpAuthenticationMethod([
            {
              method:
                "mfa/totp",
              timestamp:
                1_777_000_200,
            },
          ]),
        ).toBe(true);
      },
    );

    it(
      "does not infer recency from string-form AMR",
      () => {
        expect(
          hasTimestampedTotpAuthenticationMethod([
            "password",
            "mfa/totp",
          ]),
        ).toBe(false);
      },
    );

    it(
      "rejects ordinary OTP and invalid timestamps as TOTP step-up evidence",
      () => {
        expect(
          hasTimestampedTotpAuthenticationMethod([
            {
              method:
                "otp",
              timestamp:
                1_777_000_100,
            },
            {
              method:
                "mfa/totp",
              timestamp:
                0,
            },
          ]),
        ).toBe(false);
      },
    );
  },
);
