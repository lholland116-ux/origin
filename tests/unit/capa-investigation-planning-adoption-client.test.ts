import { describe, expect, it, vi } from "vitest";
import {
  createInvestigationPlanningAdoptionAttempt,
  submitInvestigationPlanningAdoptionAttempt,
} from "../../app/capa/capa-investigation-planning-adoption-client";
import { constructCapaInvestigationPlanningAdoption } from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";

const CASE_ID = "10000000-0000-4000-8000-000000000001";
const VERSION_ID = "20000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const TRACE_ID = "50000000-0000-4000-8000-000000000001";

function item() {
  return {
    proposal_key: "P1" as never,
    investigation_question: "What caused the deviation?",
    evidence_target: "Batch records",
    investigation_method: "Document review",
    scope_relationship: "In scope",
    owner_user_id: USER_ID as never,
    due_date: "2026-10-01",
    dependency_proposal_keys: [],
  };
}

function attempt() {
  return createInvestigationPlanningAdoptionAttempt({
    caseId: CASE_ID, currentVersionId: VERSION_ID, recordVersion: 3, outputId: OUTPUT_ID,
    selectedItems: [item()], idempotencyKey: "adoption-key-1", requestId: TRACE_ID,
    correlationId: TRACE_ID, currentUserId: USER_ID,
  })!;
}

function record() {
  const adoption = constructCapaInvestigationPlanningAdoption({
    adoption_id: "60000000-0000-4000-8000-000000000001" as never,
    organization_id: "70000000-0000-4000-8000-000000000001" as never,
    capa_case_id: CASE_ID as never, case_version_id: VERSION_ID as never,
    record_version: 3, output_id: OUTPUT_ID, adopted_item: item() as never,
    adopted_at: "2026-09-03T12:00:00.000Z" as never,
    adopted_by: { actor_type: "human", actor_id: USER_ID },
    request_id: "80000000-0000-4000-8000-000000000001" as never,
    correlation_id: TRACE_ID as never, idempotency_key: "adoption-key-1" as never,
  });
  return { adoption, request_fingerprint: "a".repeat(64), record_fingerprint: "b".repeat(64),
    audit_event_id: "90000000-0000-4000-8000-000000000001" };
}

describe("S30 adoption browser client", () => {
  it("freezes the exact body and reuses it for an idempotent replay", async () => {
    const target = attempt();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "already_adopted", records: [record()], correlation_id: TRACE_ID }), { status: 200 }),
    );
    expect(Object.isFrozen(target)).toBe(true);
    expect((await submitInvestigationPlanningAdoptionAttempt(target, fetcher)).status).toBe("failed");
    expect((await submitInvestigationPlanningAdoptionAttempt(target, fetcher)).status).toBe("already_adopted");
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(fetcher.mock.calls[0]![0]).toBe(`/api/capa/${CASE_ID}/investigation-planning-advisory/${OUTPUT_ID}/adoptions`);
  });

  it("rejects a returned adopter that is not the current user", async () => {
    const target = attempt();
    const original = record();
    const value = { ...original, adoption: { ...original.adoption,
      adopted_by: { actor_type: "human", actor_id: "40000000-0000-4000-8000-000000000002" } } };
    await expect(submitInvestigationPlanningAdoptionAttempt(target, vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "adopted", records: [value], correlation_id: TRACE_ID }), { status: 201 }),
    ))).resolves.toMatchObject({ status: "failed", code: "INVALID_ADOPTION_RESPONSE" });
  });
});
