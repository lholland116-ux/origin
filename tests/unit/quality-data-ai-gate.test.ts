import { describe, expect, it } from "vitest";
import { isQualityDataAiOrganizationAllowed, parseQualityDataAiGate } from "../../lib/quality-data/quality-data-ai-gate";

const ORG = "11000000-0000-4000-8000-000000000001";

describe("quality-data external AI fail-closed gate", () => {
  it("is disabled by default and rejects malformed or empty allowlists", () => {
    expect(parseQualityDataAiGate(undefined, undefined)).toEqual({ status: "disabled" });
    expect(parseQualityDataAiGate("false", ORG)).toEqual({ status: "disabled" });
    expect(parseQualityDataAiGate("true", undefined).status).toBe("misconfigured");
    expect(parseQualityDataAiGate("true", "").status).toBe("misconfigured");
    expect(parseQualityDataAiGate("yes", ORG).status).toBe("misconfigured");
    expect(parseQualityDataAiGate("true", `${ORG},not-an-id`).status).toBe("misconfigured");
  });

  it("allows only exact server-resolved organizations on the configured list", () => {
    const gate = parseQualityDataAiGate("true", ORG);
    expect(isQualityDataAiOrganizationAllowed(gate, ORG)).toBe(true);
    expect(isQualityDataAiOrganizationAllowed(gate, ORG.toUpperCase())).toBe(true);
    expect(isQualityDataAiOrganizationAllowed(gate, "11000000-0000-4000-8000-000000000002")).toBe(false);
    expect(isQualityDataAiOrganizationAllowed({ status: "disabled" }, ORG)).toBe(false);
    expect(isQualityDataAiOrganizationAllowed(undefined, ORG)).toBe(false);
  });
});
