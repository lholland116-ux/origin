import { describe, expect, it } from "vitest";
import { addInvestigationPlanItem, composeInvestigationPlan, createEmptyInvestigationPlanDraft,
  integrateAdoptedInvestigationPlanItems, normalizedReleaseComment, removeInvestigationPlanItem, setInvestigationPlanDependency,
  updateInvestigationPlanItem, validateInvestigationPlanDraft } from
  "../../app/capa/capa-investigation-plan-draft";
import { validateCapaInvestigationPlan } from "../../lib/capa/domain/capa-investigation-plan";
import { constructCapaInvestigationPlanningAdoption } from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";
import type { PersistedCapaInvestigationPlanningAdoption } from "../../lib/database/repositories/capa-investigation-planning-adoption-repository";

const OWNER = "10000000-0000-4000-8000-000000000001";
function complete(draft: ReturnType<typeof createEmptyInvestigationPlanDraft>, id: string) {
  return updateInvestigationPlanItem(addInvestigationPlanItem(draft, id), id, {
    investigationQuestion: "What caused it?", evidenceTarget: "Batch records",
    investigationMethod: "Document review", ownerUserId: OWNER, dueDate: "2026-10-01",
    scopeRelationship: "Within approved product scope",
  });
}

function adoptedRecord(proposalKey = "P1", dependencies: string[] = []): PersistedCapaInvestigationPlanningAdoption {
  const adoption = constructCapaInvestigationPlanningAdoption({
    adoption_id: `60000000-0000-4000-8000-00000000000${proposalKey === "P1" ? "1" : "2"}` as never,
    organization_id: "10000000-0000-4000-8000-000000000001" as never,
    capa_case_id: "20000000-0000-4000-8000-000000000001" as never,
    case_version_id: "30000000-0000-4000-8000-000000000001" as never,
    record_version: 3,
    output_id: "40000000-0000-4000-8000-000000000001" as never,
    adopted_item: {
      proposal_key: proposalKey,
      investigation_question: `Question ${proposalKey}`,
      evidence_target: `Evidence ${proposalKey}`,
      investigation_method: `Method ${proposalKey}`,
      scope_relationship: `Scope ${proposalKey}`,
      owner_user_id: "50000000-0000-4000-8000-000000000001" as never,
      due_date: "2026-10-01",
      dependency_proposal_keys: dependencies,
    } as never,
    adopted_at: "2026-09-03T12:00:00.000Z" as never,
    adopted_by: { actor_type: "human", actor_id: "50000000-0000-4000-8000-000000000001" },
    request_id: "70000000-0000-4000-8000-000000000001" as never,
    correlation_id: "80000000-0000-4000-8000-000000000001" as never,
    idempotency_key: "adoption-batch-1" as never,
  });
  return { adoption, request_fingerprint: "a".repeat(64) as never,
    record_fingerprint: "b".repeat(64) as never,
    audit_event_id: "90000000-0000-4000-8000-000000000001" as never };
}

function adoptedDraft(dependencies: string[] = []) {
  return integrateAdoptedInvestigationPlanItems(createEmptyInvestigationPlanDraft(),
    [adoptedRecord("P1", dependencies)], () => "AI-1")!;
}

describe("investigation plan draft", () => {
  it("creates stable planned CS4A-compatible items", () => {
    const draft = complete(createEmptyInvestigationPlanDraft(), "INV-1");
    const plan = composeInvestigationPlan(draft);
    expect(plan.items[0]).toMatchObject({ item_id: "INV-1", owner_user_id: OWNER,
      status: "planned", sme_user_ids: [], disposition: null });
    expect(plan.items[0]!.draft_provenance).toEqual({ source_type: "human",
      source_reference: null, adopted_by_user_id: null, adopted_at: null });
    expect(validateCapaInvestigationPlan(plan).status).toBe("valid");
  });
  it("adds and removes items while preserving stable IDs", () => {
    let draft = addInvestigationPlanItem(createEmptyInvestigationPlanDraft(), "INV-1");
    draft = addInvestigationPlanItem(draft, "INV-2");
    expect(draft.items.map((item) => item.itemId)).toEqual(["INV-1", "INV-2"]);
    expect(removeInvestigationPlanItem(draft, "INV-1").items.map((item) => item.itemId)).toEqual(["INV-2"]);
  });
  it("accepts valid dependencies and rejects self, missing, and cycles", () => {
    let draft = addInvestigationPlanItem(createEmptyInvestigationPlanDraft(), "INV-1");
    draft = addInvestigationPlanItem(draft, "INV-2");
    const linked = setInvestigationPlanDependency(draft, "INV-2", "INV-1", true)!;
    expect(linked.items[1]!.dependencyItemIds).toEqual(["INV-1"]);
    expect(setInvestigationPlanDependency(linked, "INV-1", "INV-1", true)).toBeNull();
    expect(setInvestigationPlanDependency(linked, "INV-1", "missing", true)).toBeNull();
    expect(setInvestigationPlanDependency(linked, "INV-1", "INV-2", true)).toBeNull();
  });
  it("removes dangling dependencies when an item is deleted", () => {
    let draft = addInvestigationPlanItem(createEmptyInvestigationPlanDraft(), "INV-1");
    draft = addInvestigationPlanItem(draft, "INV-2");
    draft = setInvestigationPlanDependency(draft, "INV-2", "INV-1", true)!;
    expect(removeInvestigationPlanItem(draft, "INV-1").items[0]!.dependencyItemIds).toEqual([]);
  });
  it("reports missing required fields and normalizes optional comments", () => {
    expect(validateInvestigationPlanDraft(addInvestigationPlanItem(createEmptyInvestigationPlanDraft(), "INV-1"))).not.toEqual([]);
    expect(normalizedReleaseComment("   ")).toBeNull();
    expect(normalizedReleaseComment("  Human comment  ")).toBe("Human comment");
  });

  it("integrates trusted adoption provenance and dependencies atomically", () => {
    const second = adoptedRecord("P2", ["P1"]);
    const draft = integrateAdoptedInvestigationPlanItems(createEmptyInvestigationPlanDraft(),
      [adoptedRecord(), second], () => `AI-${Math.random()}`)!;
    expect(draft.items[0]!.provenance).toMatchObject({ source_type: "ai_proposal",
      source_reference: adoptedRecord().adoption.adoption_id,
      adopted_by_user_id: adoptedRecord().adoption.adopted_by.actor_id,
      adopted_at: adoptedRecord().adoption.adopted_at });
    expect(draft.items[1]!.dependencyItemIds).toEqual([draft.items[0]!.itemId]);
  });

  it("fails unresolved or partially integrated adoption batches without mutation", () => {
    const unresolved = integrateAdoptedInvestigationPlanItems(createEmptyInvestigationPlanDraft(),
      [adoptedRecord("P2", ["P1"])], () => "AI-2");
    expect(unresolved).toBeNull();
    const partial = adoptedDraft();
    expect(integrateAdoptedInvestigationPlanItems(partial,
      [adoptedRecord(), adoptedRecord("P2")], () => "AI-2")).toBeNull();
  });

  it("treats an exact replay as already integrated", () => {
    const draft = adoptedDraft();
    expect(integrateAdoptedInvestigationPlanItems(draft, [adoptedRecord()], () => {
      throw new Error("must not generate a duplicate ID");
    })).toBe(draft);
  });

  it.each([
    ["investigation question", { investigationQuestion: "Changed" }],
    ["evidence target", { evidenceTarget: "Changed" }],
    ["method", { investigationMethod: "Changed" }],
    ["owner", { ownerUserId: "60000000-0000-4000-8000-000000000001" }],
    ["due date", { dueDate: "2026-11-01" }],
    ["scope relationship", { scopeRelationship: "Changed" }],
    ["dependency", { dependencyItemIds: ["OTHER"] }],
  ] as const)("preserves AI provenance when %s changes", (_name, changes) => {
    const draft = adoptedDraft();
    const originalProvenance = draft.items[0]!.provenance;
    const next = updateInvestigationPlanItem(draft, "AI-1", changes);
    expect(next.items[0]!.provenance).toEqual(originalProvenance);
  });

  it("preserves AI provenance for a no-op edit", () => {
    const draft = adoptedDraft();
    const next = updateInvestigationPlanItem(draft, "AI-1", {
      investigationQuestion: draft.items[0]!.investigationQuestion,
      dependencyItemIds: [...draft.items[0]!.dependencyItemIds],
    });
    expect(next.items[0]!.provenance.source_type).toBe("ai_proposal");
  });

  it("carries adopted AI provenance into G-03 composition after a human edit", () => {
    const draft = adoptedDraft();
    const originalProvenance = draft.items[0]!.provenance;
    const next = updateInvestigationPlanItem(draft, "AI-1", {
      investigationQuestion: "Question P1 best",
    });
    const plan = composeInvestigationPlan(next);
    expect(plan.items[0]!.investigation_question).toBe("Question P1 best");
    expect(plan.items[0]!.draft_provenance).toEqual(originalProvenance);
    expect(plan.items[0]!.draft_provenance.source_type).toBe("ai_proposal");
  });

  it("preserves dependent AI provenance when another item is removed", () => {
    const first = adoptedRecord("P1");
    const second = adoptedRecord("P2", ["P1"]);
    const draft = integrateAdoptedInvestigationPlanItems(createEmptyInvestigationPlanDraft(), [first, second],
      (() => { let index = 0; return () => `AI-${++index}`; })())!;
    const originalProvenance = draft.items[1]!.provenance;
    const next = removeInvestigationPlanItem(draft, "AI-1");
    expect(next.items[0]!.provenance).toEqual(originalProvenance);
    expect(next.items[0]!.dependencyItemIds).toEqual([]);
  });

  it("leaves manually created human items unchanged", () => {
    const draft = complete(createEmptyInvestigationPlanDraft(), "HUMAN-1");
    const next = removeInvestigationPlanItem(updateInvestigationPlanItem(draft, "HUMAN-1", {
      investigationQuestion: "Edited by human",
    }), "missing");
    expect(next.items[0]!.provenance.source_type).toBe("human");
  });
});
