import { describe, expect, it } from "vitest";
import {
  CAPA_LEDGER_INFORMATION_CLASSES,
  validateCapaEvidenceAssumptionLedger,
} from "../../lib/capa/domain/capa-evidence-assumption-ledger";

const USER = "10000000-0000-4000-8000-000000000001";
const when = "2026-08-31T12:00:00.000Z";
const human = {
  source_type: "human",
  source_reference: "interview-1",
  adopted_by_user_id: null,
  adopted_at: null,
};
const disposition = {
  user_id: USER,
  disposition_at: when,
  rationale: "Reviewed against the controlled record.",
};
function item(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "E-1",
    information_class: "user_provided_statement",
    statement: "Operator reported an alarm.",
    evidence_status: "current",
    assumption_status: null,
    gap_status: null,
    conflict_status: null,
    provenance: human,
    owner_user_id: null,
    information_date: "2026-08-30",
    source_version: "1",
    context: "Investigation",
    linked_capa_objects: ["INV-001"],
    supporting_item_ids: [],
    contradictory_item_ids: [],
    conflict_item_ids: [],
    material_to_conclusion: false,
    critical_to_conclusion: false,
    recommended_next_step: null,
    target_date: null,
    human_disposition: null,
    ...overrides,
  };
}
function valid(items: unknown[]) {
  return validateCapaEvidenceAssumptionLedger({ items });
}

describe("CAPA evidence/assumption ledger", () => {
  it("defines and accepts all eight controlled information classes", () => {
    expect(CAPA_LEDGER_INFORMATION_CLASSES).toEqual([
      "verified_evidence",
      "user_provided_statement",
      "ai_generated_hypothesis",
      "assumption",
      "missing_information",
      "conflicting_information",
      "retrieved_reference",
      "ai_recommendation",
    ]);
    const items = [
      item({
        item_id: "E",
        information_class: "verified_evidence",
        evidence_status: "verified",
        human_disposition: disposition,
      }),
      item({ item_id: "U" }),
      item({
        item_id: "H",
        information_class: "ai_generated_hypothesis",
        evidence_status: null,
        provenance: {
          source_type: "ai_proposal",
          source_reference: "run-1",
          adopted_by_user_id: null,
          adopted_at: null,
        },
      }),
      item({
        item_id: "A",
        information_class: "assumption",
        evidence_status: null,
        assumption_status: "open",
      }),
      item({
        item_id: "G",
        information_class: "missing_information",
        evidence_status: null,
        gap_status: "open",
        recommended_next_step: "Review records",
        owner_user_id: USER,
        target_date: "2026-09-30",
      }),
      item({
        item_id: "C",
        information_class: "conflicting_information",
        evidence_status: null,
        conflict_status: "open",
        conflict_item_ids: ["E", "U"],
      }),
      item({
        item_id: "R",
        information_class: "retrieved_reference",
        provenance: {
          source_type: "retrieved_reference",
          source_reference: "source-1",
          adopted_by_user_id: null,
          adopted_at: null,
        },
      }),
      item({
        item_id: "AI",
        information_class: "ai_recommendation",
        evidence_status: null,
        provenance: {
          source_type: "ai_proposal",
          source_reference: "run-2",
          adopted_by_user_id: null,
          adopted_at: null,
        },
      }),
    ];
    expect(valid(items).status).toBe("valid");
  });

  it("rejects unknown classes, keys, and duplicate IDs", () => {
    expect(valid([item({ information_class: "observation" })])).toMatchObject({
      status: "invalid",
    });
    expect(valid([item({ extra: true })])).toEqual({
      status: "invalid",
      reason_code: "INVALID_LEDGER_ITEM",
    });
    expect(valid([item(), item()])).toEqual({
      status: "invalid",
      reason_code: "DUPLICATE_LEDGER_ITEM_ID",
    });
  });

  it("rejects malformed UUIDs, dates, and date-times", () => {
    expect(valid([item({ owner_user_id: "user" })]).status).toBe("invalid");
    expect(valid([item({ information_date: "2026-02-30" })]).status).toBe(
      "invalid"
    );
    expect(
      valid([
        item({
          evidence_status: "verified",
          human_disposition: { ...disposition, disposition_at: "today" },
        }),
      ]).status
    ).toBe("invalid");
  });

  it("requires human attribution for verification and rejection and bars AI verification", () => {
    expect(
      valid([
        item({
          information_class: "verified_evidence",
          evidence_status: "verified",
        }),
      ])
    ).toEqual({
      status: "invalid",
      reason_code: "INVALID_LEDGER_HUMAN_DISPOSITION",
    });
    expect(valid([item({ evidence_status: "rejected" })])).toEqual({
      status: "invalid",
      reason_code: "INVALID_LEDGER_HUMAN_DISPOSITION",
    });
    expect(
      valid([
        item({
          information_class: "verified_evidence",
          evidence_status: "verified",
          human_disposition: disposition,
          provenance: {
            source_type: "ai_proposal",
            source_reference: "run",
            adopted_by_user_id: USER,
            adopted_at: when,
          },
        }),
      ])
    ).toEqual({
      status: "invalid",
      reason_code: "INVALID_LEDGER_CLASS_STATUS",
    });
  });

  it.each(["rejected", "superseded", "unavailable"])(
    "preserves %s evidence",
    (status) => {
      const result = valid([
        item({ evidence_status: status, human_disposition: disposition }),
      ]);
      expect(result.status).toBe("valid");
      if (result.status === "valid")
        expect(result.value.items[0].evidence_status).toBe(status);
    }
  );

  it.each(["open", "resolved", "supported", "disproven", "no_longer_relevant"])(
    "supports assumption status %s",
    (status) => {
      expect(
        valid([
          item({
            information_class: "assumption",
            evidence_status: null,
            assumption_status: status,
            material_to_conclusion: status === "open",
            human_disposition: status === "open" ? null : disposition,
          }),
        ]).status
      ).toBe("valid");
    }
  );

  it("represents critical gaps and resolved conflicts without removing their positions", () => {
    expect(
      valid([
        item({ item_id: "E" }),
        item({ item_id: "U" }),
        item({
          item_id: "G",
          information_class: "missing_information",
          evidence_status: null,
          gap_status: "open",
          critical_to_conclusion: true,
          recommended_next_step: "Test",
          owner_user_id: USER,
          target_date: "2026-09-30",
        }),
        item({
          item_id: "C",
          information_class: "conflicting_information",
          evidence_status: null,
          conflict_status: "resolved",
          conflict_item_ids: ["E", "U"],
          supporting_item_ids: ["E"],
          human_disposition: disposition,
        }),
      ]).status
    ).toBe("valid");
  });

  it("rejects duplicate, missing, and self links", () => {
    expect(valid([item({ supporting_item_ids: ["X", "X"] })])).toMatchObject({
      reason_code: "DUPLICATE_LEDGER_ITEM_REFERENCE",
    });
    expect(
      valid([
        item({
          information_class: "verified_evidence",
          evidence_status: "verified",
          human_disposition: disposition,
          supporting_item_ids: ["X"],
        }),
      ])
    ).toMatchObject({
      reason_code: "INVALID_LEDGER_ITEM_REFERENCE",
    });
    expect(
      valid([
        item({
          information_class: "verified_evidence",
          evidence_status: "verified",
          human_disposition: disposition,
          supporting_item_ids: ["E-1"],
        }),
      ])
    ).toMatchObject({
      reason_code: "SELF_LEDGER_ITEM_REFERENCE",
    });
  });

  it.each([
    ["verified_evidence", { recommended_next_step: "Investigate" }],
    ["user_provided_statement", { target_date: "2026-09-30" }],
    ["user_provided_statement", { supporting_item_ids: ["E-1"] }],
    ["retrieved_reference", { conflict_item_ids: ["E-1"] }],
    ["retrieved_reference", { contradictory_item_ids: ["E-1"] }],
    ["assumption", { critical_to_conclusion: true }],
    ["missing_information", { material_to_conclusion: true }],
    ["conflicting_information", { target_date: "2026-09-30" }],
    ["ai_generated_hypothesis", { supporting_item_ids: ["E-1"] }],
    ["ai_recommendation", { material_to_conclusion: true }],
  ])(
    "rejects fields that are inapplicable to %s",
    (informationClass, extra) => {
      const classFields: Record<string, unknown> = {
        information_class: informationClass,
        evidence_status: [
          "verified_evidence",
          "user_provided_statement",
          "retrieved_reference",
        ].includes(informationClass)
          ? informationClass === "verified_evidence"
            ? "verified"
            : "current"
          : null,
        assumption_status: informationClass === "assumption" ? "open" : null,
        gap_status: informationClass === "missing_information" ? "open" : null,
        conflict_status:
          informationClass === "conflicting_information" ? "open" : null,
        conflict_item_ids:
          informationClass === "conflicting_information" ? ["E", "U"] : [],
        human_disposition:
          informationClass === "verified_evidence" ? disposition : null,
        provenance:
          informationClass === "retrieved_reference"
            ? {
                source_type: "retrieved_reference",
                source_reference: "source-1",
                adopted_by_user_id: null,
                adopted_at: null,
              }
            : informationClass.startsWith("ai_")
            ? {
                source_type: "ai_proposal",
                source_reference: "run-1",
                adopted_by_user_id: null,
                adopted_at: null,
              }
            : human,
        ...extra,
      };
      const peers =
        informationClass === "conflicting_information"
          ? [item({ item_id: "E" }), item({ item_id: "U" })]
          : [];
      expect(valid([...peers, item(classFields)])).toMatchObject({
        status: "invalid",
        reason_code: "INVALID_LEDGER_CLASS_STATUS",
      });
    }
  );

  it("deeply freezes validated values, arrays, provenance, and disposition", () => {
    const result = valid([
      item({ evidence_status: "rejected", human_disposition: disposition }),
    ]);
    if (result.status !== "valid") throw new Error(result.reason_code);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.items)).toBe(true);
    expect(Object.isFrozen(result.value.items[0])).toBe(true);
    expect(Object.isFrozen(result.value.items[0].provenance)).toBe(true);
    expect(Object.isFrozen(result.value.items[0].human_disposition)).toBe(true);
    expect(Object.isFrozen(result.value.items[0].linked_capa_objects)).toBe(
      true
    );
  });
});
