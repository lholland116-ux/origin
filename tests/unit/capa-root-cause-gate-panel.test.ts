import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("S50 root-cause gate panel", () => {
  const panel = readFileSync("app/capa/CapaRootCauseGatePanel.tsx", "utf8");
  const client = readFileSync("app/capa/capa-root-cause-gate-client.ts", "utf8");

  it("keeps the two human-controlled outcomes separate from the advisory", () => {
    expect(panel).toContain("Approve to S60");
    expect(panel).toContain("Return to S40");
    expect(panel).toContain("FreshTotpStepUp");
    expect(panel).toContain("onAuthoritativeRefresh");
    expect(panel).toContain("submitted S50 root-cause package remains read-only");
  });

  it("retains one immutable attempt through confirmation and step-up", () => {
    expect(panel).toContain("setAttempt(next)");
    expect(panel).toContain("if (attempt) void submit(attempt)");
    expect(panel).toContain("crypto.randomUUID()");
    expect(client).toContain('"idempotency-key": attempt.idempotencyKey');
    expect(client).toContain("body: attempt.requestBody");
    expect(client).toContain("expectedCurrentVersionId");
    expect(client).toContain("body.record_version === attempt.expectedRecordVersion + 1");
    expect(panel).not.toContain("setState(\"S60\")");
    expect(panel).not.toContain("setState(\"S40\")");
  });

  it("contains no adoption, disposition, recommendation, history, or signature controls", () => {
    expect(panel).not.toMatch(/adopt|disposition|recommendation|history|signature/i);
  });
});
