import { describe, expect, it } from "vitest";

import {
  CapaDevelopmentOrganizationConfigurationError,
  resolveCapaDevelopmentOrganizationId,
} from "../../lib/security/capa-development-organization";

const VALID_ORGANIZATION_ID =
  "deadbeef-dead-4ead-8ead-deadbeefdead";

describe("resolveCapaDevelopmentOrganizationId", () => {
  it("returns null when the development organization is absent", () => {
    expect(resolveCapaDevelopmentOrganizationId(undefined)).toBeNull();
  });

  it("accepts a canonical UUID", () => {
    expect(
      resolveCapaDevelopmentOrganizationId(
        VALID_ORGANIZATION_ID,
      ),
    ).toBe(VALID_ORGANIZATION_ID);
  });

  it.each([
    "",
    "   ",
    ` ${VALID_ORGANIZATION_ID}`,
    `${VALID_ORGANIZATION_ID} `,
    VALID_ORGANIZATION_ID.toUpperCase(),
    "not-a-uuid",
    "10000000-0000-0000-8000-000000000001",
    "10000000-0000-4000-c000-000000000001",
    "10000000-0000-4000-8000-00000000001",
  ])("rejects invalid configured organization %s", (value) => {
    expect(() =>
      resolveCapaDevelopmentOrganizationId(value),
    ).toThrow(CapaDevelopmentOrganizationConfigurationError);
  });
});
