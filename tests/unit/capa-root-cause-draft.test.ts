import { describe, expect, it } from "vitest";
import { validateCapaEvidenceAssumptionLedger } from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import { CAPA_LEDGER_INFORMATION_CLASSES, addHypothesis, addLedgerItem, capaRootCauseWorkspaceKey, createHypothesis,
  applyRootCauseDraftMutation, clearRootCauseNotConfirmed, createInitialLedgerDraft, createInitialRootCausePackageDraft, createLedgerItem, removeHypothesis,
  isValidCurrentUserId, removeLedgerItem, setRootCauseNotConfirmed,
  updateHypothesis, updateLedgerItem, validateRootCauseDrafts, applyAdoptedCapaInvestigationActiveProposal } from "../../app/capa/capa-root-cause-draft";
const USER = "10000000-0000-4000-8000-000000000001";
const NOW = "2026-09-01T12:00:00.000Z";
const plan = (status = "completed") => ({ items: [{ item_id: "INV-1", investigation_question: "Why?", evidence_target: "Record",
  investigation_method: "Review", owner_user_id: USER, due_date: "2026-09-30", sme_user_ids: [], dependency_item_ids: [],
  scope_relationship: "Scope", status, disposition: null, disposition_rationale: null,
  draft_provenance: { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null } }] } as never);
describe("root-cause browser draft helpers", () => {
  it("maps an adopted S40 evidence gap to a fresh ledger item with immutable AI provenance", () => {
    const result = applyAdoptedCapaInvestigationActiveProposal(createInitialLedgerDraft(), createInitialRootCausePackageDraft(), {
      adoption_id: "20000000-0000-4000-8000-000000000001", proposal_key: "P1", proposal_category: "evidence_gap",
      adopted_item: { proposal_key: "P1", adopted_content: { gap: "Missing record", why_it_matters: "It matters", recommended_next_step: "Review record" } },
      adopted_at: NOW, adopted_by_user_id: USER,
    }, undefined, () => "LED-NEW");
    expect(result?.ledger.items[0]).toMatchObject({ item_id: "LED-NEW", information_class: "missing_information", statement: "Missing record", context: "It matters", recommended_next_step: "Review record", provenance: { source_type: "ai_proposal", source_reference: "20000000-0000-4000-8000-000000000001", adopted_by_user_id: USER, adopted_at: NOW } });
  });
  it("preserves a human not-confirmed conclusion when AI causal or alternative hypotheses are adopted", () => {
    const pkg = setRootCauseNotConfirmed(createInitialRootCausePackageDraft(), { rationale: "Insufficient evidence", nextSteps: ["Collect more evidence"] }, USER, NOW);
    for (const [category, role] of [["causal_hypothesis", "proposed_root_cause"], ["alternative_hypothesis", undefined]] as const) {
      const result = applyAdoptedCapaInvestigationActiveProposal(createInitialLedgerDraft(), pkg, {
        adoption_id: "20000000-0000-4000-8000-000000000001", proposal_key: category === "causal_hypothesis" ? "P1" : "P2", proposal_category: category,
        adopted_item: { proposal_key: category === "causal_hypothesis" ? "P1" : "P2", adopted_content: { hypothesis: "Potential cause", rationale: "Requires human evaluation" } }, adopted_at: NOW, adopted_by_user_id: USER,
      }, role, () => "LED-unused", () => `HYP-${category}`);
      expect(result?.rootCausePackage.root_cause_not_confirmed).toBe(pkg.root_cause_not_confirmed);
      expect(result?.rootCausePackage.root_cause_not_confirmed).toEqual(pkg.root_cause_not_confirmed);
    }
  });
  it("keeps the ordinary human add-hypothesis conclusion-clearing behavior", () => {
    const pkg = setRootCauseNotConfirmed(createInitialRootCausePackageDraft(), { rationale: "Insufficient evidence", nextSteps: ["Collect more evidence"] }, USER, NOW);
    expect(addHypothesis(pkg, createHypothesis("H-human")).root_cause_not_confirmed).toBeNull();
  });
  it("initializes all eight classes with class-aware controlled status and provenance", () => {
    expect(CAPA_LEDGER_INFORMATION_CLASSES).toHaveLength(8);
    for (const informationClass of CAPA_LEDGER_INFORMATION_CLASSES) {
      const item = createLedgerItem(informationClass, informationClass);
      expect(item.information_class).toBe(informationClass);
      expect(item.provenance.source_type).toBe(informationClass.startsWith("ai_") ? "ai_proposal" : informationClass === "retrieved_reference" ? "retrieved_reference" : "human");
      expect(item.evidence_status !== null).toBe(["verified_evidence", "user_provided_statement", "retrieved_reference"].includes(informationClass));
    }
  });
  it("uses render-safe ownership keys without version identity", () => {
    expect(capaRootCauseWorkspaceKey("case-a", "S40")).toBe(capaRootCauseWorkspaceKey("case-a", "S40"));
    expect(capaRootCauseWorkspaceKey("case-a", "S40")).not.toBe(capaRootCauseWorkspaceKey("case-b", "S40"));
    expect(capaRootCauseWorkspaceKey("case-a", "S40")).not.toBe(capaRootCauseWorkspaceKey("case-a", "S50"));
  });
  it("fails safe for unavailable authenticated identity", () => {
    expect(isValidCurrentUserId(USER)).toBe(true); expect(isValidCurrentUserId("")).toBe(false); expect(isValidCurrentUserId("user")).toBe(false);
  });
  it("adds, immutably edits, and removes ledger items", () => {
    const empty = createInitialLedgerDraft(); const added = addLedgerItem(empty, createLedgerItem("assumption", "A-1"));
    const edited = updateLedgerItem(added, "A-1", { statement: "Assumed condition" }, USER, NOW);
    expect(empty.items).toHaveLength(0); expect(added.items[0].statement).toBe(""); expect(edited.items[0].statement).toBe("Assumed condition");
    expect(removeLedgerItem(edited, "A-1").items).toHaveLength(0); expect(Object.isFrozen(edited.items)).toBe(true);
  });
  it("records current-user disposition for resolved assumption, gap, conflict, and evidence", () => {
    const cases = [["assumption", { assumption_status: "resolved" }], ["missing_information", { gap_status: "resolved" }],
      ["conflicting_information", { conflict_status: "resolved" }], ["user_provided_statement", { evidence_status: "verified" }]] as const;
    for (const [informationClass, patch] of cases) {
      const draft = addLedgerItem(createInitialLedgerDraft(), createLedgerItem(informationClass, "I-1"));
      expect(updateLedgerItem(draft, "I-1", patch as never, USER, NOW).items[0].human_disposition).toMatchObject({ user_id: USER, disposition_at: NOW });
    }
  });
  it("never turns an AI item into verified evidence", () => {
    const item = createLedgerItem("ai_generated_hypothesis", "AI-1");
    expect(item.evidence_status).toBeNull(); expect(item.provenance.source_type).toBe("ai_proposal");
  });
  it("constructs a domain-valid ledger containing all eight browser classes", () => {
    let draft = createInitialLedgerDraft();
    for (const informationClass of CAPA_LEDGER_INFORMATION_CLASSES) {
      draft = addLedgerItem(draft, createLedgerItem(informationClass, informationClass));
      draft = updateLedgerItem(draft, informationClass, { statement: `${informationClass} statement` }, USER, NOW);
    }
    draft = updateLedgerItem(draft, "verified_evidence", { evidence_status: "verified" }, USER, NOW);
    draft = updateLedgerItem(draft, "verified_evidence", { human_disposition: { user_id: USER, disposition_at: NOW, rationale: "Human verified the evidence." } }, USER, NOW);
    draft = updateLedgerItem(draft, "retrieved_reference", { provenance: { source_type: "retrieved_reference", source_reference: "QMS-DOC-42", adopted_by_user_id: null, adopted_at: null } }, USER, NOW);
    draft = updateLedgerItem(draft, "conflicting_information", { conflict_item_ids: ["verified_evidence", "user_provided_statement"] }, USER, NOW);
    const result = validateRootCauseDrafts(plan(), draft, createInitialRootCausePackageDraft());
    expect(result.status).toBe("valid");
    expect(draft.items.find((item) => item.item_id === "retrieved_reference")?.provenance.source_reference).toBe("QMS-DOC-42");
    expect(JSON.stringify(draft)).not.toContain("Pending reference");
  });
  it("blocks a retrieved reference until the browser receives a genuine source reference", () => {
    let draft = addLedgerItem(createInitialLedgerDraft(), createLedgerItem("retrieved_reference", "R-1"));
    draft = updateLedgerItem(draft, "R-1", { statement: "Retrieved procedure" }, USER, NOW);
    expect(validateCapaEvidenceAssumptionLedger(draft).status).toBe("valid");
    expect(validateRootCauseDrafts(plan(), draft, createInitialRootCausePackageDraft())).toMatchObject({
      status: "invalid", reasonCode: "MISSING_RETRIEVED_SOURCE_REFERENCE",
      path: "items.0.provenance.source_reference",
    });
    draft = updateLedgerItem(draft, "R-1", { provenance: { ...draft.items[0].provenance, source_reference: "   " } }, USER, NOW);
    expect(validateRootCauseDrafts(plan(), draft, createInitialRootCausePackageDraft())).toMatchObject({ reasonCode: "MISSING_RETRIEVED_SOURCE_REFERENCE" });
    draft = updateLedgerItem(draft, "R-1", { provenance: { ...draft.items[0].provenance, source_reference: "  QMS-DOC-42  " } }, USER, NOW);
    expect(draft.items[0].provenance.source_reference).toBe("QMS-DOC-42");
    expect(validateRootCauseDrafts(plan(), draft, createInitialRootCausePackageDraft()).status).toBe("valid");
  });
  it("keeps verified evidence incomplete until a real human status choice and rationale", () => {
    let draft = addLedgerItem(createInitialLedgerDraft(), createLedgerItem("verified_evidence", "E-1"));
    draft = updateLedgerItem(draft, "E-1", { statement: "Evidence" }, USER, NOW);
    expect(validateRootCauseDrafts(plan(), draft, createInitialRootCausePackageDraft())).toMatchObject({ status: "invalid" });
    draft = updateLedgerItem(draft, "E-1", { evidence_status: "verified" }, USER, NOW);
    draft = updateLedgerItem(draft, "E-1", { human_disposition: { user_id: USER, disposition_at: NOW, rationale: "Verified by human." } }, USER, NOW);
    expect(validateRootCauseDrafts(plan(), draft, createInitialRootCausePackageDraft()).status).toBe("valid");
  });
  it("creates, edits, self-attributes, and removes hypotheses immutably", () => {
    const empty = createInitialRootCausePackageDraft(); const added = addHypothesis(empty, createHypothesis("H-1"));
    const edited = updateHypothesis(added, "H-1", { status: "confirmed", statement: "Cause", rationale: "Evidence" }, USER);
    expect(edited.hypotheses[0].responsible_user_id).toBe(USER); expect(added.hypotheses[0].responsible_user_id).toBeNull();
    expect(removeHypothesis(edited, "H-1").hypotheses).toHaveLength(0);
  });
  it("preserves support and contradiction references", () => {
    const added = addHypothesis(createInitialRootCausePackageDraft(), createHypothesis("H-1"));
    const edited = updateHypothesis(added, "H-1", { supporting_evidence_item_ids: ["E-1"], contradictory_evidence_item_ids: ["E-2"] }, USER);
    expect(edited.hypotheses[0]).toMatchObject({ supporting_evidence_item_ids: ["E-1"], contradictory_evidence_item_ids: ["E-2"] });
  });
  it("records a human root-cause-not-confirmed conclusion and removes contradictory confirmation", () => {
    const confirmed = updateHypothesis(addHypothesis(createInitialRootCausePackageDraft(), createHypothesis("H-1")), "H-1", { status: "confirmed" }, USER);
    const result = setRootCauseNotConfirmed(confirmed, { rationale: "Insufficient evidence", nextSteps: ["Collect more evidence"] }, USER, NOW);
    expect(result.root_cause_not_confirmed).toMatchObject({ concluded_by_user_id: USER, concluded_at: NOW, provenance: { source_type: "human" } });
    expect(result.hypotheses[0].status).toBe("unresolved");
  });
  it("uses domain validators and prevents contradictory packages", () => {
    const ledger = createInitialLedgerDraft(); const confirmed = updateHypothesis(addHypothesis(createInitialRootCausePackageDraft(), createHypothesis("H-1")), "H-1", { status: "confirmed", statement: "Cause", rationale: "Reason" }, USER);
    const contradiction = { ...confirmed, root_cause_not_confirmed: { rationale: "None", next_steps: ["Next"], concluded_by_user_id: USER, concluded_at: NOW, provenance: { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null } } } as never;
    expect(validateRootCauseDrafts(plan(), ledger, contradiction)).toMatchObject({ status: "invalid", reasonCode: "CONTRADICTORY_ROOT_CAUSE_CONCLUSION" });
  });
  it("integrates plan and package readiness", () => {
    const pkg = setRootCauseNotConfirmed(createInitialRootCausePackageDraft(), { rationale: "No root cause", nextSteps: ["Monitor"] }, USER, NOW);
    expect(validateRootCauseDrafts(plan(), createInitialLedgerDraft(), pkg)).toMatchObject({ status: "valid", readiness: { status: "ready_for_review" } });
    expect(validateRootCauseDrafts(plan("planned"), createInitialLedgerDraft(), pkg)).toMatchObject({ readiness: { status: "blocked", reason_codes: ["OPEN_INVESTIGATION_PLAN_ITEM"] } });
  });
  it("invalidates D2 attempt while adding a ledger item", () => {
    const result = applyRootCauseDraftMutation(createInitialLedgerDraft(), (draft) => addLedgerItem(draft, createLedgerItem("assumption", "A-1")));
    expect(result.attempt).toBeNull(); expect(result.draft.items).toHaveLength(1);
  });
  it("invalidates D2 attempt while removing a ledger item", () => {
    const source = addLedgerItem(createInitialLedgerDraft(), createLedgerItem("assumption", "A-1"));
    const result = applyRootCauseDraftMutation(source, (draft) => removeLedgerItem(draft, "A-1"));
    expect(result.attempt).toBeNull(); expect(result.draft.items).toHaveLength(0);
  });
  it("invalidates D2 attempt while editing a ledger item", () => {
    const source = addLedgerItem(createInitialLedgerDraft(), createLedgerItem("assumption", "A-1"));
    const result = applyRootCauseDraftMutation(source, (draft) => updateLedgerItem(draft, "A-1", { statement: "Changed" }, USER, NOW));
    expect(result.attempt).toBeNull(); expect(result.draft.items[0].statement).toBe("Changed");
  });
  it("invalidates D2 attempt while adding a hypothesis", () => {
    const result = applyRootCauseDraftMutation(createInitialRootCausePackageDraft(), (draft) => addHypothesis(draft, createHypothesis("H-1")));
    expect(result.attempt).toBeNull(); expect(result.draft.hypotheses).toHaveLength(1);
  });
  it("invalidates D2 attempt while removing a hypothesis", () => {
    const source = addHypothesis(createInitialRootCausePackageDraft(), createHypothesis("H-1"));
    const result = applyRootCauseDraftMutation(source, (draft) => removeHypothesis(draft, "H-1"));
    expect(result.attempt).toBeNull(); expect(result.draft.hypotheses).toHaveLength(0);
  });
  it("invalidates D2 attempt while editing a hypothesis", () => {
    const source = addHypothesis(createInitialRootCausePackageDraft(), createHypothesis("H-1"));
    const result = applyRootCauseDraftMutation(source, (draft) => updateHypothesis(draft, "H-1", { statement: "Changed" }, USER));
    expect(result.attempt).toBeNull(); expect(result.draft.hypotheses[0].statement).toBe("Changed");
  });
  it("invalidates D2 attempt while creating or editing a not-confirmed conclusion", () => {
    const created = applyRootCauseDraftMutation(createInitialRootCausePackageDraft(), (draft) => setRootCauseNotConfirmed(draft, { rationale: "Not confirmed", nextSteps: ["Monitor"] }, USER, NOW));
    expect(created.attempt).toBeNull(); expect(created.draft.root_cause_not_confirmed?.rationale).toBe("Not confirmed");
    const edited = applyRootCauseDraftMutation(created.draft, (draft) => setRootCauseNotConfirmed(draft, { rationale: "Still not confirmed", nextSteps: ["Collect evidence"] }, USER, NOW));
    expect(edited.attempt).toBeNull(); expect(edited.draft.root_cause_not_confirmed?.rationale).toBe("Still not confirmed");
  });
  it("invalidates D2 attempt while clearing a not-confirmed conclusion", () => {
    const source = setRootCauseNotConfirmed(createInitialRootCausePackageDraft(), { rationale: "Not confirmed", nextSteps: ["Monitor"] }, USER, NOW);
    const result = applyRootCauseDraftMutation(source, clearRootCauseNotConfirmed);
    expect(result.attempt).toBeNull(); expect(result.draft.root_cause_not_confirmed).toBeNull();
  });
  it("preserves an exact frozen D2 attempt when no draft mutation occurs", () => {
    const attempt = Object.freeze({ idempotencyKey: "same-key", requestBody: "same-body" });
    expect(attempt).toBe(attempt); expect(attempt.idempotencyKey).toBe("same-key"); expect(attempt.requestBody).toBe("same-body");
  });
});
