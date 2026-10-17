import { describe, expect, it } from "vitest";

import { isQualityDataPilotOrganizationAllowed, parseQualityDataPilotGate } from "../../lib/quality-data/quality-data-pilot-gate";

const ORGANIZATION = "30000000-0000-4000-8000-000000000002";
const OTHER_ORGANIZATION = "30000000-0000-4000-8000-000000000099";

describe("quality-data pilot gate configuration", () => {
  it("is disabled by default and fails closed for missing or malformed configuration", () => {
    expect(parseQualityDataPilotGate(undefined, undefined).status).toBe("disabled");
    expect(parseQualityDataPilotGate("false", "not-a-uuid").status).toBe("disabled");
    expect(parseQualityDataPilotGate("TRUE", ORGANIZATION).status).toBe("misconfigured");
    expect(parseQualityDataPilotGate("true", undefined).status).toBe("misconfigured");
    expect(parseQualityDataPilotGate("true", "").status).toBe("misconfigured");
    expect(parseQualityDataPilotGate("true", `${ORGANIZATION},`).status).toBe("misconfigured");
    expect(parseQualityDataPilotGate("true", `${ORGANIZATION},invalid`).status).toBe("misconfigured");
    expect(parseQualityDataPilotGate("true", Array.from({ length: 101 }, () => ORGANIZATION).join(",")).status).toBe("misconfigured");
    expect(parseQualityDataPilotGate("true", `${ORGANIZATION},${"x".repeat(4_100)}`).status).toBe("misconfigured");
  });

  it("allows only configured organization IDs and never matches a malformed request identity", () => {
    const gate = parseQualityDataPilotGate("true", ` ${ORGANIZATION.toUpperCase()} , ${OTHER_ORGANIZATION} `);
    expect(isQualityDataPilotOrganizationAllowed(gate, ORGANIZATION)).toBe(true);
    expect(isQualityDataPilotOrganizationAllowed(gate, OTHER_ORGANIZATION)).toBe(true);
    expect(isQualityDataPilotOrganizationAllowed(gate, "30000000-0000-4000-8000-000000000003")).toBe(false);
    expect(isQualityDataPilotOrganizationAllowed(gate, "not-a-uuid")).toBe(false);
    expect(isQualityDataPilotOrganizationAllowed(undefined, ORGANIZATION)).toBe(false);
  });
});
