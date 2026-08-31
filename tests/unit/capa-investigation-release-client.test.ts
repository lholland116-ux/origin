import { describe, expect, it, vi } from "vitest";
import { createInvestigationReleaseAttempt, G03_CONFIRMATION, submitInvestigationReleaseAttempt } from
  "../../app/capa/capa-investigation-release-client";

const CASE = "30000000-0000-4000-8000-000000000001";
function attempt() { return createInvestigationReleaseAttempt({ caseId: CASE, recordVersion: 3,
  currentVersionId: "40000000-0000-4000-8000-000000000001", investigationPlan: { items: [] },
  comment: null, idempotencyKey: "release-1" })!; }

describe("investigation release browser client", () => {
  it("freezes one exact serialized request and confirmation", () => {
    const target = attempt(); const body = JSON.parse(target.requestBody);
    expect(Object.isFrozen(target)).toBe(true);
    expect(body).toMatchObject({ expected_record_version: 3,
      expected_current_version_id: "40000000-0000-4000-8000-000000000001",
      release: { confirmation: G03_CONFIRMATION, comment: null } });
  });
  it("submits and retries with the same endpoint, body, and key", async () => {
    const target = attempt();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(
      new Response(JSON.stringify({ capa: { capa_case_id: CASE, status: "S40" } }), { status: 200 }));
    expect((await submitInvestigationReleaseAttempt(target, fetcher)).status).toBe("failed");
    expect((await submitInvestigationReleaseAttempt(target, fetcher)).status).toBe("released");
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(fetcher.mock.calls[0]![0]).toBe(`/api/capa/${CASE}/release-investigation`);
  });
  it.each([
    [409, "CAPA_INVESTIGATION_RELEASE_GATE_BLOCKED", false],
    [409, "CAPA_INVESTIGATION_OWNER_INELIGIBLE", false],
    [409, "CAPA_CONCURRENCY_CONFLICT", true],
  ])("parses controlled failure %s %s", async (status, code, refresh) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code,
      message: "Controlled failure", issues: [{ path: "plan", message: "REASON" }] } }), { status }));
    await expect(submitInvestigationReleaseAttempt(attempt(), fetcher)).resolves.toMatchObject({
      status: "failed", code, reasons: ["REASON"], requiresRefresh: refresh,
    });
  });
});
