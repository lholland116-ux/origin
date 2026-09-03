import { describe, expect, it, vi } from "vitest";

import {
  constructCapaInvestigationPlanningAdoption,
} from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";
import type {
  PersistedCapaInvestigationPlanningAdoption,
} from "../../lib/database/repositories/capa-investigation-planning-adoption-repository";
import {
  verifyCapaInvestigationPlanningAdoptionProvenance,
} from "../../lib/capa/application/capa-investigation-planning-adoption-verifier";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const USER = "50000000-0000-4000-8000-000000000001";
const OTHER_USER = "50000000-0000-4000-8000-000000000002";
const ADOPTION_1 = "60000000-0000-4000-8000-000000000001";
const ADOPTION_2 = "60000000-0000-4000-8000-000000000002";
const ADOPTED_AT = "2026-09-03T12:00:00.000Z";

function adoption(
  adoptionId: string,
  proposalKey: "P1" | "P2" = "P1",
  dependencyProposalKeys: ("P1" | "P2")[] = [],
  batch = "batch-1",
  adoptedBy = USER,
  adoptedAt = ADOPTED_AT,
): PersistedCapaInvestigationPlanningAdoption {
  const item = {
    proposal_key: proposalKey,
    investigation_question: `Question ${proposalKey}`,
    evidence_target: `Evidence ${proposalKey}`,
    investigation_method: `Method ${proposalKey}`,
    scope_relationship: `Scope ${proposalKey}`,
    owner_user_id: USER,
    due_date: "2026-09-30",
    dependency_proposal_keys: dependencyProposalKeys,
  };
  return {
    adoption: constructCapaInvestigationPlanningAdoption({
      adoption_id: adoptionId as never,
      organization_id: ORG as never,
      capa_case_id: CASE_ID as never,
      case_version_id: VERSION as never,
      record_version: 3,
      output_id: OUTPUT as never,
      adopted_item: item as never,
      adopted_at: adoptedAt as never,
      adopted_by: { actor_type: "human", actor_id: adoptedBy },
      request_id: "70000000-0000-4000-8000-000000000001" as never,
      correlation_id: "80000000-0000-4000-8000-000000000001" as never,
      idempotency_key: batch as never,
    }),
    request_fingerprint: "a".repeat(64),
    record_fingerprint: "b".repeat(64),
    audit_event_id: "90000000-0000-4000-8000-000000000001",
  } as PersistedCapaInvestigationPlanningAdoption;
}

function planItem(record: ReturnType<typeof adoption>["adoption"], overrides: Record<string, unknown> = {}) {
  return {
    item_id: `item-${record.proposal_key}`,
    investigation_question: record.adopted_item.investigation_question,
    evidence_target: record.adopted_item.evidence_target,
    investigation_method: record.adopted_item.investigation_method,
    owner_user_id: record.adopted_item.owner_user_id,
    due_date: record.adopted_item.due_date,
    sme_user_ids: [],
    dependency_item_ids: [],
    scope_relationship: record.adopted_item.scope_relationship,
    status: "planned",
    disposition: null,
    disposition_rationale: null,
    draft_provenance: {
      source_type: "ai_proposal",
      source_reference: record.adoption_id,
      adopted_by_user_id: record.adopted_by.actor_id,
      adopted_at: record.adopted_at,
    },
    ...overrides,
  };
}

function verify(
  records: readonly ReturnType<typeof adoption>[],
  items: readonly unknown[],
) {
  const byId = new Map(records.map((record) => [record.adoption.adoption_id, record]));
  return verifyCapaInvestigationPlanningAdoptionProvenance({
    repository: {
      findAdoptionById: vi.fn(async (_organizationId, adoptionId) => byId.get(adoptionId) ?? null),
    } as never,
    organization_id: ORG as never,
    capa_case_id: CASE_ID as never,
    expected_case_version_id: VERSION as never,
    expected_record_version: 3,
    plan: { items } as never,
  });
}

describe("trusted G-03 AI-provenance verification", () => {
  it("accepts trusted human adoption evidence and resolves dependency IDs", async () => {
    const first = adoption(ADOPTION_1, "P1");
    const second = adoption(ADOPTION_2, "P2", ["P1"]);
    const result = await verify(
      [first, second],
      [
        planItem(first.adoption),
        planItem(second.adoption, { dependency_item_ids: ["item-P1"] }),
      ],
    );
    expect(result).toEqual({ status: "verified" });
  });

  it("accepts independent AI items from different adoption batches", async () => {
    const first = adoption(ADOPTION_1, "P1", [], "batch-a");
    const second = adoption(ADOPTION_2, "P2", [], "batch-b");
    await expect(verify([first, second], [
      planItem(first.adoption),
      planItem(second.adoption),
    ])).resolves.toEqual({ status: "verified" });
  });

  it.each([
    ["missing source reference", { source_reference: null }],
    ["forged adopter", { adopted_by_user_id: "90000000-0000-4000-8000-000000000001" }],
    ["forged timestamp", { adopted_at: "2026-09-03T12:01:00.000Z" }],
    ["changed question", { investigation_question: "Forged question" }],
    ["changed evidence", { evidence_target: "Forged evidence" }],
    ["changed method", { investigation_method: "Forged method" }],
    ["changed scope", { scope_relationship: "Forged scope" }],
    ["changed owner", { owner_user_id: "90000000-0000-4000-8000-000000000001" }],
    ["changed due date", { due_date: "2026-10-01" }],
  ] as const)("blocks %s", async (_name, overrides) => {
    const record = adoption(ADOPTION_1);
    const itemOverrides = _name === "missing source reference" ||
      _name === "forged adopter" || _name === "forged timestamp"
      ? { draft_provenance: { ...planItem(record.adoption).draft_provenance, ...overrides } }
      : overrides;
    await expect(verify([record], [planItem(record.adoption, itemOverrides)])).resolves.toEqual({
      status: "blocked",
      blocker_code: "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
    });
  });

  it("blocks missing, injected, wrong-batch, and wrong-target dependencies", async () => {
    const first = adoption(ADOPTION_1, "P1");
    const second = adoption(ADOPTION_2, "P2", ["P1"]);
    await expect(verify([first, second], [
      planItem(first.adoption),
      planItem(second.adoption),
    ])).resolves.toMatchObject({ status: "blocked" });
    await expect(verify([first, second], [
      planItem(first.adoption),
      planItem(second.adoption, { dependency_item_ids: ["human-item"] }),
    ])).resolves.toMatchObject({ status: "blocked" });
    const otherBatch = adoption(ADOPTION_1, "P1", [], "batch-2");
    await expect(verify([otherBatch, second], [
      planItem(otherBatch.adoption),
      planItem(second.adoption, { dependency_item_ids: ["item-P1"] }),
    ])).resolves.toMatchObject({ status: "blocked" });
  });

  it("blocks dependency-linked items with different adopters", async () => {
    const first = adoption(ADOPTION_1, "P1", [], "batch-1", USER);
    const second = adoption(ADOPTION_2, "P2", ["P1"], "batch-1", OTHER_USER);
    await expect(verify([first, second], [
      planItem(first.adoption),
      planItem(second.adoption, { dependency_item_ids: ["item-P1"] }),
    ])).resolves.toMatchObject({ status: "blocked" });
  });

  it("blocks dependency-linked items with different adoption timestamps", async () => {
    const first = adoption(ADOPTION_1, "P1", [], "batch-1", USER, ADOPTED_AT);
    const second = adoption(
      ADOPTION_2,
      "P2",
      ["P1"],
      "batch-1",
      USER,
      "2026-09-03T12:01:00.000Z",
    );
    await expect(verify([first, second], [
      planItem(first.adoption),
      planItem(second.adoption, { dependency_item_ids: ["item-P1"] }),
    ])).resolves.toMatchObject({ status: "blocked" });
  });

  it("does not look up human-authored plan items", async () => {
    const findAdoptionById = vi.fn();
    const result = await verifyCapaInvestigationPlanningAdoptionProvenance({
      repository: { findAdoptionById } as never,
      organization_id: ORG as never,
      capa_case_id: CASE_ID as never,
      expected_case_version_id: VERSION as never,
      expected_record_version: 3,
      plan: { items: [
        {
          ...planItem(adoption(ADOPTION_1).adoption),
          draft_provenance: {
            source_type: "human",
            source_reference: null,
            adopted_by_user_id: null,
            adopted_at: null,
          },
        },
      ] } as never,
    });
    expect(result).toEqual({ status: "verified" });
    expect(findAdoptionById).not.toHaveBeenCalled();
  });
});
