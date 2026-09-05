import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInvestigationActiveAdoptionRetry } from "../../app/capa/CapaInvestigationActiveAdvisoryPanel";
import { createInvestigationActiveAdoptionAttempt } from "../../app/capa/capa-investigation-active-adoption-client";

const CASE = "10000000-0000-4000-8000-000000000001"; const VERSION = "20000000-0000-4000-8000-000000000001"; const OUTPUT = "30000000-0000-4000-8000-000000000001";
describe("S40 advisory panel hardening", () => {
  const source = readFileSync(resolve("app/capa/CapaInvestigationActiveAdvisoryPanel.tsx"), "utf8");
  it("freezes client-local causal roles with the exact retry attempt", () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "retry-key", requestId: "40000000-0000-4000-8000-000000000001", correlationId: "50000000-0000-4000-8000-000000000001", selectedItems: [{ proposal_key: "P1", adopted_content: { hypothesis: "Potential cause", rationale: "Evaluate" } }] });
    const roles: Record<string, "proposed_root_cause" | "contributing_factor"> = { P1: "contributing_factor" }; const retry = createInvestigationActiveAdoptionRetry(attempt!, roles);
    roles.P1 = "proposed_root_cause";
    expect(retry.attempt.requestBody).toBe(attempt?.requestBody); expect(retry.attempt.idempotencyKey).toBe("retry-key"); expect(retry.attempt.requestId).toBe("40000000-0000-4000-8000-000000000001"); expect(retry.attempt.correlationId).toBe("50000000-0000-4000-8000-000000000001"); expect(retry.causalRoles).toEqual({ P1: "contributing_factor" }); expect(Object.isFrozen(retry.causalRoles)).toBe(true);
  });
  it("locks cards and generation while an exact retry is retained and renders advisory uncertainty", () => {
    expect(source).toContain("retry !== null"); expect(source).toContain("Discard exact retry"); expect(source).toContain("Uncertainty and limitations"); expect(source).toContain("item.human_review_question"); expect(source).toContain("local S40 working draft"); expect(source).toContain("does not verify evidence, confirm root cause, mutate the authoritative controlled record, or submit the CAPA");
  });
});
