import { describe, expect, it } from "vitest";

import {
  CAPA_DEVELOPMENT_ROLE_IDS,
  CapaDevelopmentRoleConfigurationError,
  resolveCapaDevelopmentRoleId,
} from "../../lib/security/capa-development-role";

describe("resolveCapaDevelopmentRoleId", () => {
  it.each([undefined, "", "   "])(
    "defaults unset or whitespace-only configuration to CAPA_OWNER (%s)",
    (value) => {
      expect(resolveCapaDevelopmentRoleId(value)).toBe("CAPA_OWNER");
    },
  );

  it.each([...CAPA_DEVELOPMENT_ROLE_IDS])(
    "accepts the exact allowed development role %s",
    (role) => {
      expect(resolveCapaDevelopmentRoleId(role)).toBe(role);
    },
  );

  it.each([
    "capa_owner",
    "CAPA_OWNER_EXTRA",
    " CAPA_REVIEWER ",
    "CAPA_UNKNOWN",
  ])("rejects an unknown development role %s", (value) => {
    expect(() => resolveCapaDevelopmentRoleId(value)).toThrow(
      CapaDevelopmentRoleConfigurationError,
    );
  });

});
