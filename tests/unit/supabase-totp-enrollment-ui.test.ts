import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createSupabaseTotpQrDataUrl,
  summarizeSupabaseTotpFactors,
} from "../../lib/security/supabase-totp-enrollment-ui";

describe(
  "Supabase TOTP enrollment UI helpers",
  () => {
    it(
      "separates verified and incomplete TOTP factors",
      () => {
        expect(
          summarizeSupabaseTotpFactors([
            {
              id: "totp-verified",
              factor_type: "totp",
              status: "verified",
            },
            {
              id: "totp-incomplete",
              factor_type: "totp",
              status: "unverified",
            },
          ]),
        ).toEqual({
          verified_factor_ids: [
            "totp-verified",
          ],
          unverified_factor_ids: [
            "totp-incomplete",
          ],
        });
      },
    );

    it(
      "ignores non-TOTP factors",
      () => {
        expect(
          summarizeSupabaseTotpFactors([
            {
              id: "phone-factor",
              factor_type: "phone",
              status: "verified",
            },
            {
              id: "webauthn-factor",
              factor_type: "webauthn",
              status: "verified",
            },
          ]),
        ).toEqual({
          verified_factor_ids: [],
          unverified_factor_ids: [],
        });
      },
    );

    it(
      "ignores unsupported statuses and blank identifiers",
      () => {
        expect(
          summarizeSupabaseTotpFactors([
            {
              id: "",
              factor_type: "totp",
              status: "verified",
            },
            {
              id: "future-status",
              factor_type: "totp",
              status: "disabled",
            },
          ]),
        ).toEqual({
          verified_factor_ids: [],
          unverified_factor_ids: [],
        });
      },
    );

    it(
      "URI-encodes the Supabase SVG rather than exposing raw markup",
      () => {
        const result =
          createSupabaseTotpQrDataUrl(
            '<svg><text>LVTChat & MFA</text></svg>',
          );

        expect(result).toBe(
          "data:image/svg+xml;utf-8," +
            encodeURIComponent(
              '<svg><text>LVTChat & MFA</text></svg>',
            ),
        );

        expect(result).not.toContain(
          "<svg>",
        );
      },
    );

    it(
      "rejects an empty QR-code payload",
      () => {
        expect(
          () =>
            createSupabaseTotpQrDataUrl(
              "   ",
            ),
        ).toThrow(
          "A non-empty TOTP QR code is required.",
        );
      },
    );
  },
);
