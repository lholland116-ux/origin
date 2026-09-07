import { describe, expect, it, vi } from "vitest";
import {
  verifyCapaInvestigationActiveAdoptionProvenance,
} from "../../lib/capa/application/capa-investigation-active-adoption-verifier";
import { constructCapaInvestigationActiveAdoption } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const VERSION_5 = "30000000-0000-4000-8000-000000000002";
const VERSION_6 = "30000000-0000-4000-8000-000000000003";
const ORPHAN_VERSION = "30000000-0000-4000-8000-000000000004";
const CYCLE_A = "30000000-0000-4000-8000-000000000005";
const CYCLE_B = "30000000-0000-4000-8000-000000000006";
const CROSS_CASE_VERSION = "30000000-0000-4000-8000-000000000007";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const ADOPTION = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const REQUEST = "70000000-0000-4000-8000-000000000001";
const CORRELATION = "80000000-0000-4000-8000-000000000001";
const AT = "2026-09-05T12:00:00.000Z";
const emptyLedger = { items: [] };
const emptyPackage = { hypotheses: [], root_cause_not_confirmed: null };

type Category = "evidence_gap" | "conflicting_information" | "assumption" | "investigation_recommendation" | "causal_hypothesis" | "alternative_hypothesis";
function adoption(category: Category = "evidence_gap") {
  const content = category === "evidence_gap"
    ? { gap: "Gap", why_it_matters: "Why", recommended_next_step: "Next" }
    : category === "conflicting_information"
      ? { conflict: "Conflict", why_it_matters: "Why" }
      : category === "assumption"
        ? { assumption: "Assumption", verification_question: "Verify?" }
        : category === "investigation_recommendation"
          ? { recommendation: "Recommendation", rationale: "Reason" }
          : { hypothesis: category === "causal_hypothesis" ? "Cause" : "Alternative", rationale: "Reason" };
  return constructCapaInvestigationActiveAdoption({
    adoption_id: ADOPTION as never,
    organization_id: ORG as never,
    capa_case_id: CASE_ID as never,
    case_version_id: VERSION as never,
    record_version: 4,
    output_id: OUTPUT,
    proposal_key: "P1",
    proposal_category: category,
    adopted_item: {
      proposal_key: "P1",
      adopted_content: content,
      ...(category === "causal_hypothesis" ? { human_causal_role: "proposed_root_cause" as const } : {}),
    },
    resolved_reference_bindings: [],
    reference_manifest_schema_version: "capa-investigation-active-reference-manifest-1.0.0",
    reference_manifest_fingerprint_algorithm: "sha256-canonical-json-v1",
    reference_manifest_sha256: "a".repeat(64),
    adopted_at: AT as never,
    adopted_by: { actor_type: "human", actor_id: USER },
    request_id: REQUEST as never,
    correlation_id: CORRELATION as never,
    idempotency_key: "batch-1" as never,
    workflow_mutated: false,
    controlled_record_mutated: false,
    gate_approved: false,
  });
}

function caseVersion(
  id: string,
  number: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_version_id: id,
    version_number: number,
    status: "S40",
    parent_version_id: undefined,
    section_version_ids: [],
    change_reason: "Test version",
    effective_at: AT,
    created_at: AT,
    created_by: { actor_type: "human", actor_id: USER },
    ...overrides,
  };
}

function defaultVersionRepository() {
  const versions = new Map([
    [VERSION, caseVersion(VERSION, 4)],
    [VERSION_5, caseVersion(VERSION_5, 5, { parent_version_id: VERSION })],
    [VERSION_6, caseVersion(VERSION_6, 6, { parent_version_id: VERSION_5 })],
  ]);
  return {
    findCaseVersionById: vi.fn(async (_organizationId: string, _caseId: string, id: string) => versions.get(id) ?? null),
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue({ adoption: adoption() }) },
    capa_repository: defaultVersionRepository(),
    organization_id: ORG,
    capa_case_id: CASE_ID,
    expected_case_version_id: VERSION,
    expected_record_version: 4,
    evidence_assumption_ledger: emptyLedger,
    root_cause_package: emptyPackage,
    ...overrides,
  } as never;
}

function adoptedGapItem(sourceReference = ADOPTION) {
  return {
    information_class: "missing_information",
    statement: "Gap",
    context: "Why",
    recommended_next_step: "Next",
    provenance: { source_type: "ai_proposal", source_reference: sourceReference, adopted_by_user_id: USER, adopted_at: AT },
  };
}

function provenanceInput(overrides: Record<string, unknown> = {}) {
  return input({
    evidence_assumption_ledger: { items: [adoptedGapItem()] },
    ...overrides,
  });
}

describe("durable S40 adoption provenance verifier", () => {
  it("does not read the repository when there is no AI provenance", async () => {
    const repository = { findAdoptionById: vi.fn() };
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ adoption_repository: repository }))).resolves.toEqual({ status: "verified" });
    expect(repository.findAdoptionById).not.toHaveBeenCalled();
  });

  it("verifies an evidence-gap mapping against immutable adoption evidence", async () => {
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({
      evidence_assumption_ledger: {
        items: [{
          information_class: "missing_information", statement: "Gap", context: "Why",
          recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT },
        }],
      },
    }))).resolves.toEqual({ status: "verified" });
  });

  it.each([
    ["same-version", VERSION, 4],
    ["historical V4 to V5", VERSION_5, 5],
    ["historical V4 to V6", VERSION_6, 6],
  ] as const)("keeps %s adoption valid through authoritative ancestry", async (_label, currentVersionId, currentRecordVersion) => {
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(provenanceInput({
      expected_case_version_id: currentVersionId,
      expected_record_version: currentRecordVersion,
    }))).resolves.toEqual({ status: "verified" });
  });

  it.each([
    ["missing source version", adoption(), { findCaseVersionById: vi.fn().mockResolvedValue(null) }, VERSION, 4],
    ["source organization mismatch", adoption(), { findCaseVersionById: vi.fn(async (_o: string, _c: string, id: string) => id === VERSION ? caseVersion(VERSION, 4, { organization_id: "90000000-0000-4000-8000-000000000001" }) : caseVersion(VERSION_5, 5, { parent_version_id: VERSION })) }, VERSION_5, 5],
    ["source CAPA mismatch", adoption(), { findCaseVersionById: vi.fn(async (_o: string, _c: string, id: string) => id === VERSION ? caseVersion(VERSION, 4, { capa_case_id: "90000000-0000-4000-8000-000000000002" }) : caseVersion(VERSION_5, 5, { parent_version_id: VERSION })) }, VERSION_5, 5],
    ["source record version mismatch", adoption(), { findCaseVersionById: vi.fn(async (_o: string, _c: string, id: string) => id === VERSION ? caseVersion(VERSION, 5) : caseVersion(VERSION_5, 5, { parent_version_id: VERSION })) }, VERSION_5, 5],
    ["source status mismatch", adoption(), { findCaseVersionById: vi.fn(async (_o: string, _c: string, id: string) => id === VERSION ? caseVersion(VERSION, 4, { status: "S50" }) : caseVersion(VERSION_5, 5, { parent_version_id: VERSION })) }, VERSION_5, 5],
  ] as const)("blocks %s", async (_label, adopted, capaRepository, currentVersionId, currentRecordVersion) => {
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(provenanceInput({
      adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue({ adoption: adopted }) },
      capa_repository: capaRepository,
      expected_case_version_id: currentVersionId,
      expected_record_version: currentRecordVersion,
    }))).resolves.toMatchObject({ status: "blocked", blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED" });
  });

  it.each([
    ["missing current version", VERSION_5, 5, (id: string) => id === VERSION ? caseVersion(VERSION, 4) : null],
    ["current record version mismatch", VERSION_5, 4, (id: string) => id === VERSION ? caseVersion(VERSION, 4) : caseVersion(VERSION_5, 5, { parent_version_id: VERSION })],
    ["current status mismatch", VERSION_5, 5, (id: string) => id === VERSION ? caseVersion(VERSION, 4) : caseVersion(VERSION_5, 5, { parent_version_id: VERSION, status: "S50" })],
  ] as const)("blocks %s", async (_label, currentVersionId, currentRecordVersion, lookup) => {
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(provenanceInput({
      expected_case_version_id: currentVersionId,
      expected_record_version: currentRecordVersion,
      capa_repository: { findCaseVersionById: vi.fn(async (_o: string, _c: string, id: string) => lookup(id)) },
    }))).resolves.toMatchObject({ status: "blocked", blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED" });
  });

  it.each([
    ["non-ancestor older version", ORPHAN_VERSION, 4, VERSION_6, 6, (id: string) => ({
      [ORPHAN_VERSION]: caseVersion(ORPHAN_VERSION, 4),
      [VERSION]: caseVersion(VERSION, 4),
      [VERSION_5]: caseVersion(VERSION_5, 5, { parent_version_id: VERSION }),
      [VERSION_6]: caseVersion(VERSION_6, 6, { parent_version_id: VERSION_5 }),
    }[id] ?? null)],
    ["newer adoption version", VERSION_6, 6, VERSION_5, 5, (id: string) => ({
      [VERSION]: caseVersion(VERSION, 4),
      [VERSION_5]: caseVersion(VERSION_5, 5, { parent_version_id: VERSION }),
      [VERSION_6]: caseVersion(VERSION_6, 6, { parent_version_id: VERSION_5 }),
    }[id] ?? null)],
    ["broken parent chain", VERSION, 4, VERSION_5, 5, (id: string) => id === VERSION ? caseVersion(VERSION, 4) : caseVersion(VERSION_5, 5, { parent_version_id: "90000000-0000-4000-8000-000000000099" })],
    ["parent cycle", VERSION, 4, CYCLE_A, 6, (id: string) => ({
      [VERSION]: caseVersion(VERSION, 4),
      [CYCLE_A]: caseVersion(CYCLE_A, 6, { parent_version_id: CYCLE_B }),
      [CYCLE_B]: caseVersion(CYCLE_B, 5, { parent_version_id: CYCLE_A }),
    }[id] ?? null)],
    ["cross-case parent", VERSION, 4, VERSION_5, 5, (id: string) => id === VERSION ? caseVersion(VERSION, 4) : id === VERSION_5 ? caseVersion(VERSION_5, 5, { parent_version_id: CROSS_CASE_VERSION }) : caseVersion(CROSS_CASE_VERSION, 4, { capa_case_id: "90000000-0000-4000-8000-000000000002" })],
  ] as const)("blocks %s", async (_label, adoptedVersionId, adoptedRecordVersion, currentVersionId, currentRecordVersion, lookup) => {
    const adopted = { ...adoption(), case_version_id: adoptedVersionId, record_version: adoptedRecordVersion };
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(provenanceInput({
      adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue({ adoption: adopted }) },
      capa_repository: { findCaseVersionById: vi.fn(async (_o: string, _c: string, id: string) => lookup(id)) },
      expected_case_version_id: currentVersionId,
      expected_record_version: currentRecordVersion,
    }))).resolves.toMatchObject({ status: "blocked", blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED" });
  });

  it("blocks stale adopted text and adopter/timestamp mismatches", async () => {
    const base = input({ evidence_assumption_ledger: { items: [{ information_class: "missing_information", statement: "Changed", context: "Why", recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] } });
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(base)).resolves.toMatchObject({ status: "blocked", blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED" });
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ evidence_assumption_ledger: { items: [{ information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: "90000000-0000-4000-8000-000000000001", adopted_at: AT } }] } }))).resolves.toMatchObject({ status: "blocked" });
  });

  it.each([
    ["evidence_gap", { information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next" }, adoption("evidence_gap")],
    ["conflicting_information", { information_class: "conflicting_information", statement: "Conflict", context: "Why" }, adoption("conflicting_information")],
    ["assumption", { information_class: "assumption", statement: "Assumption", context: "Verify?" }, adoption("assumption")],
    ["investigation_recommendation", { information_class: "ai_recommendation", statement: "Recommendation", context: "Reason" }, adoption("investigation_recommendation")],
  ] as const)("verifies ledger %s provenance mapping", async (_name, fields, record) => {
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({
      adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue({ adoption: record }) },
      evidence_assumption_ledger: { items: [{ ...fields, provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] },
    }))).resolves.toEqual({ status: "verified" });
  });

  it.each([
    ["proposed_root_cause", "causal_hypothesis"],
    ["contributing_factor", "causal_hypothesis"],
    ["alternative_hypothesis", "alternative_hypothesis"],
  ] as const)("verifies %s hypothesis provenance mapping", async (role, category) => {
    const repository = { findAdoptionById: vi.fn().mockResolvedValue({ adoption: adoption("causal_hypothesis") }) };
    const record = adoption(category);
    repository.findAdoptionById.mockResolvedValue({ adoption: record });
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({
      adoption_repository: repository,
      root_cause_package: { hypotheses: [{ statement: role === "alternative_hypothesis" ? "Alternative" : "Cause", rationale: "Reason", causal_role: role, provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }], root_cause_not_confirmed: null },
    }))).resolves.toEqual({ status: "verified" });
  });

  it.each([
    ["organization_id", { organization_id: "90000000-0000-4000-8000-000000000001" }],
    ["capa_case_id", { capa_case_id: "90000000-0000-4000-8000-000000000002" }],
    ["case version", { expected_case_version_id: "90000000-0000-4000-8000-000000000003" }],
    ["record version", { expected_record_version: 5 }],
  ])("blocks %s mismatch", async (_name, override) => {
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ ...override, evidence_assumption_ledger: { items: [{ information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] } }))).resolves.toMatchObject({ status: "blocked" });
  });

  it("ignores human-owned changes while rejecting bad policy, flags, duplicate references, and unsupported AI classes", async () => {
    const humanOwned = { owner_user_id: "changed", gap_status: "resolved", material_to_conclusion: true, human_disposition: { user_id: USER, disposition_at: AT, rationale: "resolved" } };
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ evidence_assumption_ledger: { items: [{ information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next", ...humanOwned, provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] } }))).resolves.toEqual({ status: "verified" });
    for (const field of ["workflow_mutated", "controlled_record_mutated", "gate_approved"] as const) {
      const bad = { ...adoption(), [field]: true };
      await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue({ adoption: bad }) }, evidence_assumption_ledger: { items: [{ information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] } }))).resolves.toMatchObject({ status: "blocked" });
    }
    for (const bad of [
      { adopted_by: { actor_type: "service", actor_id: USER } },
      { adopted_at: "2026-09-05T12:00:01.000Z" },
      { adoption_policy_version: "wrong-policy" },
    ]) {
      await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ adoption_repository: { findAdoptionById: vi.fn().mockResolvedValue({ adoption: { ...adoption(), ...bad } }) }, evidence_assumption_ledger: { items: [{ information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] } }))).resolves.toMatchObject({ status: "blocked" });
    }
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ evidence_assumption_ledger: { items: [{ information_class: "ai_generated_hypothesis", statement: "H", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } }] } }))).resolves.toMatchObject({ status: "blocked" });
  });

  it("rejects AI root-cause conclusions and duplicate adoption references", async () => {
    const item = { information_class: "missing_information", statement: "Gap", context: "Why", recommended_next_step: "Next", provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } };
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ evidence_assumption_ledger: { items: [item, item] } }))).resolves.toMatchObject({ status: "blocked" });
    await expect(verifyCapaInvestigationActiveAdoptionProvenance(input({ root_cause_package: { hypotheses: [], root_cause_not_confirmed: { rationale: "R", next_steps: [], provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT } } } }))).resolves.toMatchObject({ status: "blocked" });
  });
});
