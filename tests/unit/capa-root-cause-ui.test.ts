import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CapaRootCauseWorkspace, { normalizedLedgerReferenceIds } from "../../app/capa/CapaRootCauseWorkspace";
import { emptyInvestigationProgressForm } from "../../app/capa/capa-investigation-progress-client";
describe("CS4E S40/S50 browser boundary", () => {
  const intake = readFileSync(resolve("app/capa/CapaIntakeClient.tsx"), "utf8");
  const progress = readFileSync(resolve("app/capa/CapaInvestigationProgressPanel.tsx"), "utf8");
  const workspace = readFileSync(resolve("app/capa/CapaRootCauseWorkspace.tsx"), "utf8");
  const d2 = readFileSync(resolve("app/capa/capa-root-cause-submission-client.ts"), "utf8");
  it("renders semantic S40 and S50 workspace branches", () => {
    expect(intake).toContain('createdCapa.status === "S40" || createdCapa.status === "S50"');
    expect(workspace).toContain("S40 · Investigation Active"); expect(workspace).toContain("S50 · Submitted read-only record");
    expect(intake).toContain("CAPA_STATE_DEFINITIONS.S50.name");
  });
  it("represents all plan fields read-only and exposes legal action buttons only", () => {
    for (const label of ["Investigation question", "Evidence target", "Investigation method", "Owner", "Due date", "SMEs", "Dependencies", "Scope relationship", "Disposition rationale"]) expect(progress).toContain(label);
    for (const action of [">Start<", ">Complete<", '"Disposition"', '"Cancel"']) expect(progress).toContain(action);
    expect(progress).not.toContain("Reopen"); expect(progress).not.toContain('type="text" value={item.owner_user_id');
  });
  it("disables dependency-blocked Start/Complete and uses an inline disposition-code form", () => {
    expect(progress).toContain("!canStartOrComplete"); expect(progress).toContain("Start and Complete are blocked by");
    expect(progress).toContain("Disposition code"); expect(progress).toContain("Rationale"); expect(progress).toContain("CONTROLLED_CODE");
  });
  it("always refreshes selected case and list after D3/D2 outcomes requiring authority", () => {
    expect(progress).toMatch(/status === "updated"[\s\S]*await onAuthoritativeRefresh/);
    expect(workspace).toMatch(/status === "submitted"[\s\S]*await onAuthoritativeRefresh/);
    expect(intake).toMatch(/onAuthoritativeRefresh=\{async \(\) => \{[\s\S]*await openExistingCase[\s\S]*await loadCases\("replace"\)/);
  });
  it("hydrates by case identity while excluding version identity from reloads", () => {
    expect(intake).toContain("key={capaRootCauseWorkspaceKey(createdCapa.capaCaseId, createdCapa.status)}");
    expect(workspace).toContain("loadCapaInvestigationActiveWorkspace(caseId)");
    expect(workspace).toContain("}, [caseId, readOnly]);");
    expect(workspace).toContain("readOnly ? authoritativeLedger");
    expect(workspace).toContain("readOnly ? authoritativeRootCausePackage");
  });
  it("uses latest concurrency values and excludes plan from D2", () => {
    expect(workspace).toContain("caseId, recordVersion, currentVersionId");
    expect(d2).not.toContain("investigation_plan:");
  });
  it("makes S50 plan, ledger, and package read-only with no controlled actions", () => {
    expect(workspace).toContain('const readOnly = mode === "S50"');
    expect(workspace).toContain("Authoritative submitted ledger; read-only.");
    expect(workspace).toContain("Authoritative submitted package; read-only.");
    expect(progress).toContain("!readOnly && !terminal.has(item.status)");
    expect(workspace).toContain("!readOnly ?");
  });
  it("contains no raw JSON editor or CS4E approval, G-04, MFA, signature controls", () => {
    const cs4e = progress + workspace;
    expect(cs4e).not.toMatch(/JSON\.stringify|raw JSON|G-04|MFA|TOTP|e-signature|Approve root cause/i);
  });
  it("normalizes distinct controlled ledger reference inputs", () => {
    expect(normalizedLedgerReferenceIds(" LED-1, LED-2, LED-1, , ")).toEqual(["LED-1", "LED-2"]);
  });
  it("provides an executable empty-state decision for stale D3 forms", () => {
    expect(emptyInvestigationProgressForm()).toEqual({ activeItemId: null, action: null, disposition: "", rationale: "" });
  });
  it("renders populated authoritative S50 data semantically without editor controls", () => {
    const human = { source_type: "human" as const, source_reference: null, adopted_by_user_id: null, adopted_at: null };
    const ledgerItem = (overrides: Record<string, unknown>) => ({ item_id: "E-1", information_class: "verified_evidence",
      statement: "Seal wear was verified.", evidence_status: "verified", assumption_status: null, gap_status: null,
      conflict_status: null, provenance: human, owner_user_id: null, information_date: "2026-08-31", source_version: "v2",
      context: "Inspection record", linked_capa_objects: [], supporting_item_ids: [], contradictory_item_ids: [], conflict_item_ids: [],
      material_to_conclusion: false, critical_to_conclusion: false, recommended_next_step: null, target_date: null,
      human_disposition: { user_id: "30000000-0000-4000-8000-000000000001", disposition_at: "2026-09-01T11:00:00.000Z", rationale: "Verified by investigator." }, ...overrides });
    const markup = renderToStaticMarkup(createElement(CapaRootCauseWorkspace, {
      caseId: "10000000-0000-4000-8000-000000000001", caseNumber: "CAPA-1", mode: "S50" as const,
      recordVersion: 8, currentVersionId: "20000000-0000-4000-8000-000000000001",
      currentUserId: "30000000-0000-4000-8000-000000000001", onAuthoritativeRefresh: async () => {},
      plan: { items: [{ item_id: "INV-1", investigation_question: "Why?", evidence_target: "Record", investigation_method: "Review",
        owner_user_id: null, due_date: null, sme_user_ids: [], dependency_item_ids: [], scope_relationship: "Scope", status: "completed" as const,
        disposition: null, disposition_rationale: null, draft_provenance: human }] },
      authoritativeLedger: { items: [ledgerItem({}), ledgerItem({ item_id: "R-1", information_class: "retrieved_reference",
        statement: "Controlled maintenance procedure.", evidence_status: "current", provenance: { source_type: "retrieved_reference", source_reference: "QMS-DOC-42", adopted_by_user_id: null, adopted_at: null }, human_disposition: null }),
        ledgerItem({ item_id: "C-1", information_class: "conflicting_information", statement: "Records conflict on inspection timing.",
          evidence_status: null, conflict_status: "open", conflict_item_ids: ["E-1", "R-1"], human_disposition: null })] as never },
      authoritativeRootCausePackage: { hypotheses: [{ hypothesis_id: "H-1", statement: "Maintenance timing contributed to the event.",
        status: "confirmed", causal_role: "contributing_factor", rationale: "Supported by controlled records.",
        responsible_user_id: "30000000-0000-4000-8000-000000000001", supporting_evidence_item_ids: ["E-1"],
        contradictory_evidence_item_ids: ["R-1"], linked_assumption_item_ids: [], linked_gap_item_ids: [], linked_conflict_item_ids: ["C-1"],
        material_to_package: true, provenance: human }], root_cause_not_confirmed: { rationale: "Evidence was insufficient.",
        next_steps: ["Continue monitoring"], concluded_by_user_id: "30000000-0000-4000-8000-000000000001",
        concluded_at: "2026-09-01T12:00:00.000Z", provenance: human } },
    }));
    expect(markup).toContain("Seal wear was verified."); expect(markup).toContain("Verified Evidence");
    expect(markup).toContain("QMS-DOC-42"); expect(markup).toContain("Maintenance timing contributed to the event.");
    expect(markup).toContain("Confirmed"); expect(markup).toContain("Contributing Factor");
    expect(markup).toContain("Root cause not confirmed"); expect(markup).toContain("Evidence was insufficient.");
    expect(markup).toContain("Continue monitoring"); expect(markup).not.toContain("Record that root cause was not confirmed");
    expect(markup).not.toContain("Submit root cause for review");
    expect(markup).not.toContain("<input"); expect(markup).not.toContain("<select"); expect(markup).not.toContain("<textarea");
    expect(markup).not.toMatch(/<button[^>]*>\s*(?:Start|Complete|Disposition|Cancel)\s*<\/button>/);
  });
  it("routes every controlled ledger/package mutation through attempt-invalidating wrappers", () => {
    expect(workspace).toContain("applyRootCauseDraftMutation(ledgerRef.current, mutation).draft");
    expect(workspace).toContain("applyRootCauseDraftMutation(rootPackageRef.current, mutation).draft");
    expect(workspace).toContain("setAttempt(null)");
  });
  it("hydrates S40 before enabling durable edits and describes the draft correctly", () => {
    expect(workspace).toContain("Loading durable workspace");
    expect(workspace).toContain("Durable working draft; non-authoritative until root cause is submitted for review.");
    expect(workspace).toContain("workspaceStatus === \"conflict\"");
  });
  it("proves ordered S40 hydration, reconciliation failure handling, and server adoption hydration", () => {
    expect(workspace).toMatch(/loadCapaInvestigationActiveWorkspace\(caseId\)[\s\S]*reconcileCapaInvestigationActiveWorkspaceAdoptions\(caseId\)[\s\S]*resetFromServer\(loadedRevision\)[\s\S]*setHydrationStatus\("ready"\)/);
    expect(workspace).toMatch(/reconciled\.status === "failed"[\s\S]*setHydrationStatus\("failed"\)[\s\S]*Editing remains disabled/);
    expect(workspace).toMatch(/if \(readOnly\) return;[\s\S]*loadCapaInvestigationActiveWorkspace\(caseId\)/);
    expect(workspace).toMatch(/!readOnly && hydrationStatus === "ready"[\s\S]*CapaInvestigationActiveAdvisoryPanel/);
    expect(workspace).not.toContain("materializeCapaInvestigationActiveAdoptions");
    expect(workspace).toMatch(/setLedger\(workspace\.evidence_assumption_ledger\)[\s\S]*setRootPackage\(workspace\.root_cause_package\)[\s\S]*resetFromServer\(workspace\.draft_revision\)/);
  });
  it("locks only adopted AI causal roles while preserving human decision controls", () => {
    expect(workspace).toContain("const adoptedAi = isAdoptedAi(hypothesis.provenance)");
    expect(workspace).toContain("const adoptedAi = isAdoptedAi(item.provenance)");
    expect(workspace).toContain("!readOnly && !adoptedAi ? <button");
    expect(workspace).toContain('disabled={adoptedAi}');
    expect(workspace).toContain('Status<select value={hypothesis.status}');
    expect(workspace).toContain('Material to package');
  });
});
