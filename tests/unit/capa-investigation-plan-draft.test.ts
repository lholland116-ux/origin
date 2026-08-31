import { describe, expect, it } from "vitest";
import { addInvestigationPlanItem, composeInvestigationPlan, createEmptyInvestigationPlanDraft,
  normalizedReleaseComment, removeInvestigationPlanItem, setInvestigationPlanDependency,
  updateInvestigationPlanItem, validateInvestigationPlanDraft } from
  "../../app/capa/capa-investigation-plan-draft";
import { validateCapaInvestigationPlan } from "../../lib/capa/domain/capa-investigation-plan";

const OWNER = "10000000-0000-4000-8000-000000000001";
function complete(draft: ReturnType<typeof createEmptyInvestigationPlanDraft>, id: string) {
  return updateInvestigationPlanItem(addInvestigationPlanItem(draft, id), id, {
    investigationQuestion: "What caused it?", evidenceTarget: "Batch records",
    investigationMethod: "Document review", ownerUserId: OWNER, dueDate: "2026-10-01",
    scopeRelationship: "Within approved product scope",
  });
}

describe("investigation plan draft", () => {
  it("creates stable planned CS4A-compatible items", () => {
    const draft = complete(createEmptyInvestigationPlanDraft(), "INV-1");
    const plan = composeInvestigationPlan(draft);
    expect(plan.items[0]).toMatchObject({ item_id: "INV-1", owner_user_id: OWNER,
      status: "planned", sme_user_ids: [], disposition: null });
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
});
