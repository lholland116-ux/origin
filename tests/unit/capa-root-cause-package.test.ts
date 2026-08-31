import { describe, expect, it } from "vitest";
import { validateCapaEvidenceAssumptionLedger } from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import {
  CAPA_CAUSAL_HYPOTHESIS_STATUSES,
  CAPA_CAUSAL_ROLES,
  CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING,
  evaluateCapaRootCauseReadiness,
  validateCapaRootCausePackage,
} from "../../lib/capa/domain/capa-root-cause-package";
import { validateCapaInvestigationPlan } from "../../lib/capa/domain/capa-investigation-plan";

const USER = "10000000-0000-4000-8000-000000000001";
const when = "2026-08-31T12:00:00.000Z";
const human = {
  source_type: "human",
  source_reference: null,
  adopted_by_user_id: null,
  adopted_at: null,
};
const disp = {
  user_id: USER,
  disposition_at: when,
  rationale: "Human review completed.",
};
function ledgerItem(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "E",
    information_class: "verified_evidence",
    statement: "Record confirms the failure.",
    evidence_status: "verified",
    assumption_status: null,
    gap_status: null,
    conflict_status: null,
    provenance: human,
    owner_user_id: null,
    information_date: null,
    source_version: null,
    context: null,
    linked_capa_objects: [],
    supporting_item_ids: [],
    contradictory_item_ids: [],
    conflict_item_ids: [],
    material_to_conclusion: false,
    critical_to_conclusion: false,
    recommended_next_step: null,
    target_date: null,
    human_disposition: disp,
    ...overrides,
  };
}
function ledger(items = [ledgerItem()]) {
  const r = validateCapaEvidenceAssumptionLedger({ items });
  if (r.status !== "valid") throw new Error(r.reason_code);
  return r.value;
}
function hypothesis(overrides: Record<string, unknown> = {}) {
  return {
    hypothesis_id: "H-1",
    statement: "Seal wear caused the failure.",
    status: "confirmed",
    causal_role: "proposed_root_cause",
    rationale: "The controlled record supports this finding.",
    responsible_user_id: USER,
    supporting_evidence_item_ids: ["E"],
    contradictory_evidence_item_ids: [],
    linked_assumption_item_ids: [],
    linked_gap_item_ids: [],
    linked_conflict_item_ids: [],
    material_to_package: true,
    provenance: human,
    ...overrides,
  };
}
function pkg(
  l = ledger(),
  hypotheses = [hypothesis()],
  root_cause_not_confirmed: unknown = null
) {
  const r = validateCapaRootCausePackage(
    { hypotheses, root_cause_not_confirmed },
    l
  );
  if (r.status !== "valid") throw new Error(r.reason_code);
  return r.value;
}
function plan(status = "completed") {
  const r = validateCapaInvestigationPlan({
    items: [
      {
        item_id: "INV-1",
        investigation_question: "Why?",
        evidence_target: "Record",
        investigation_method: "Review",
        owner_user_id: USER,
        due_date: "2026-09-30",
        sme_user_ids: [],
        dependency_item_ids: [],
        scope_relationship: "Scope",
        status,
        disposition:
          status === "dispositioned"
            ? "NOT_APPLICABLE"
            : status === "cancelled"
            ? "WITHDRAWN"
            : null,
        disposition_rationale:
          status === "dispositioned" || status === "cancelled"
            ? "Formally dispositioned."
            : null,
        draft_provenance: human,
      },
    ],
  });
  if (r.status !== "valid") throw new Error(r.reason_code);
  return r.value;
}

describe("CAPA root-cause package", () => {
  it("defines controlled hypothesis statuses and distinct causal roles", () => {
    expect(CAPA_CAUSAL_HYPOTHESIS_STATUSES).toEqual([
      "proposed",
      "confirmed",
      "rejected",
      "unresolved",
    ]);
    expect(CAPA_CAUSAL_ROLES).toEqual([
      "proposed_root_cause",
      "contributing_factor",
      "alternative_hypothesis",
    ]);
    for (const status of CAPA_CAUSAL_HYPOTHESIS_STATUSES)
      expect(
        validateCapaRootCausePackage(
          {
            hypotheses: [hypothesis({ status })],
            root_cause_not_confirmed: null,
          },
          ledger()
        ).status
      ).toBe("valid");
  });
  it("rejects duplicate hypothesis IDs and keeps support separate from contradiction", () => {
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [hypothesis(), hypothesis()],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "DUPLICATE_CAUSAL_HYPOTHESIS_ID" });
    const l = ledger([ledgerItem(), ledgerItem({ item_id: "E2" })]);
    const value = pkg(l, [
      hypothesis({ contradictory_evidence_item_ids: ["E2"] }),
    ]);
    expect(value.hypotheses[0].supporting_evidence_item_ids).toEqual(["E"]);
    expect(value.hypotheses[0].contradictory_evidence_item_ids).toEqual(["E2"]);
  });
  it("supports an attributable root-cause-not-confirmed path", () => {
    const value = pkg(ledger(), [], {
      rationale: "Available evidence did not confirm a cause.",
      next_steps: ["Continue monitoring"],
      concluded_by_user_id: USER,
      concluded_at: when,
      provenance: human,
    });
    expect(evaluateCapaRootCauseReadiness(plan(), ledger(), value)).toEqual({
      status: "ready_for_review",
    });
  });
  it("rejects both orderings of a not-confirmed conclusion with a confirmed proposed root cause", () => {
    const notConfirmed = {
      rationale: "No root cause was confirmed.",
      next_steps: ["Continue monitoring"],
      concluded_by_user_id: USER,
      concluded_at: when,
      provenance: human,
    };
    for (const hypotheses of [
      [hypothesis(), hypothesis({ hypothesis_id: "H-2", status: "proposed" })],
      [hypothesis({ hypothesis_id: "H-2", status: "proposed" }), hypothesis()],
    ])
      expect(
        validateCapaRootCausePackage(
          { hypotheses, root_cause_not_confirmed: notConfirmed },
          ledger()
        )
      ).toEqual({
        status: "invalid",
        reason_code: "CONTRADICTORY_ROOT_CAUSE_CONCLUSION",
      });
  });
  it("requires a confirmed root cause or the valid not-confirmed path for completeness", () => {
    for (const status of ["proposed", "unresolved", "rejected"])
      expect(
        evaluateCapaRootCauseReadiness(
          plan(),
          ledger(),
          pkg(ledger(), [hypothesis({ status })])
        )
      ).toMatchObject({
        reason_codes: expect.arrayContaining(["ROOT_CAUSE_PACKAGE_INCOMPLETE"]),
      });
    expect(evaluateCapaRootCauseReadiness(plan(), ledger(), pkg())).toEqual({
      status: "ready_for_review",
    });
  });
  it.each(["planned", "in_progress"])(
    "blocks open investigation status %s",
    (status) =>
      expect(
        evaluateCapaRootCauseReadiness(plan(status), ledger(), pkg()).status
      ).toBe("blocked")
  );
  it.each(["completed", "dispositioned", "cancelled"])(
    "treats %s investigation work as addressed",
    (status) =>
      expect(
        evaluateCapaRootCauseReadiness(plan(status), ledger(), pkg())
      ).toEqual({ status: "ready_for_review" })
  );
  it("maps B-02, B-03, and B-04 exactly and deterministically", () => {
    const l = ledger([
      ledgerItem(),
      ledgerItem({
        item_id: "A",
        information_class: "assumption",
        evidence_status: null,
        assumption_status: "open",
        human_disposition: null,
        material_to_conclusion: true,
      }),
      ledgerItem({
        item_id: "G",
        information_class: "missing_information",
        evidence_status: null,
        gap_status: "open",
        human_disposition: null,
        critical_to_conclusion: true,
      }),
      ledgerItem({ item_id: "E2" }),
      ledgerItem({
        item_id: "C",
        information_class: "conflicting_information",
        evidence_status: null,
        conflict_status: "open",
        human_disposition: null,
        conflict_item_ids: ["E", "E2"],
        material_to_conclusion: true,
      }),
    ]);
    expect(evaluateCapaRootCauseReadiness(plan(), l, pkg(l))).toEqual({
      status: "blocked",
      reason_codes: [
        "UNRESOLVED_CRITICAL_EVIDENCE_GAP",
        "UNRESOLVED_MATERIAL_CONTRADICTION",
        "OPEN_MATERIAL_ASSUMPTION",
      ],
      canonical_blocker_codes: ["B-02", "B-03", "B-04"],
    });
  });
  it("emits B-06 only when invalid evidence is relied upon as support", () => {
    const l = ledger([ledgerItem({ evidence_status: "rejected" })]);
    expect(evaluateCapaRootCauseReadiness(plan(), l, pkg(l))).toMatchObject({
      canonical_blocker_codes: ["B-06"],
    });
    const contradictory = pkg(
      l,
      [
        hypothesis({
          supporting_evidence_item_ids: [],
          contradictory_evidence_item_ids: ["E"],
          causal_role: "alternative_hypothesis",
          status: "rejected",
        }),
      ],
      {
        rationale: "No cause confirmed.",
        next_steps: ["Monitor"],
        concluded_by_user_id: USER,
        concluded_at: when,
        provenance: human,
      }
    );
    expect(evaluateCapaRootCauseReadiness(plan(), l, contradictory)).toEqual({
      status: "ready_for_review",
    });
  });
  it("blocks unsupported causal findings and material unresolved alternatives", () => {
    const value = pkg(ledger(), [
      hypothesis({ supporting_evidence_item_ids: [] }),
      hypothesis({
        hypothesis_id: "H-2",
        causal_role: "alternative_hypothesis",
        status: "unresolved",
      }),
    ]);
    expect(
      evaluateCapaRootCauseReadiness(plan(), ledger(), value)
    ).toMatchObject({
      reason_codes: [
        "UNSUPPORTED_CAUSAL_HYPOTHESIS",
        "UNRESOLVED_MATERIAL_ALTERNATIVE",
      ],
    });
  });
  it("keeps an AI hypothesis a proposal until attributable human adoption", () => {
    const ai = pkg(ledger(), [
      hypothesis({
        status: "confirmed",
        provenance: {
          source_type: "ai_proposal",
          source_reference: "run-1",
          adopted_by_user_id: null,
          adopted_at: null,
        },
      }),
    ]);
    expect(evaluateCapaRootCauseReadiness(plan(), ledger(), ai)).toMatchObject({
      reason_codes: ["AI_PROPOSAL_NOT_HUMAN_ADOPTED"],
    });
  });
  it.each(["confirmed", "rejected", "unresolved"])(
    "requires a responsible user for %s hypotheses",
    (status) => {
      expect(
        validateCapaRootCausePackage(
          {
            hypotheses: [hypothesis({ status, responsible_user_id: null })],
            root_cause_not_confirmed: null,
          },
          ledger()
        )
      ).toMatchObject({ reason_code: "INVALID_CAUSAL_HYPOTHESIS" });
      expect(
        validateCapaRootCausePackage(
          {
            hypotheses: [hypothesis({ status })],
            root_cause_not_confirmed: null,
          },
          ledger()
        ).status
      ).toBe("valid");
    }
  );
  it("requires a rationale for confirmed findings", () => {
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [hypothesis({ rationale: "" })],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_CAUSAL_HYPOTHESIS" });
  });
  it("rejects unknown package and hypothesis keys", () => {
    expect(
      validateCapaRootCausePackage(
        { hypotheses: [], root_cause_not_confirmed: null, approval: true },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_ROOT_CAUSE_PACKAGE_FIELDS" });
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [hypothesis({ approval: true })],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_CAUSAL_HYPOTHESIS" });
  });
  it("rejects missing, wrong-class, duplicate, and malformed hypothesis references", () => {
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [
            hypothesis({ supporting_evidence_item_ids: ["missing"] }),
          ],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_CAUSAL_REFERENCE" });
    const assumptionLedger = ledger([
      ledgerItem(),
      ledgerItem({
        item_id: "A",
        information_class: "assumption",
        evidence_status: null,
        assumption_status: "open",
        human_disposition: null,
      }),
    ]);
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [hypothesis({ supporting_evidence_item_ids: ["A"] })],
          root_cause_not_confirmed: null,
        },
        assumptionLedger
      )
    ).toMatchObject({ reason_code: "INVALID_CAUSAL_REFERENCE" });
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [
            hypothesis({ supporting_evidence_item_ids: ["E", "E"] }),
          ],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "DUPLICATE_CAUSAL_REFERENCE" });
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [hypothesis({ responsible_user_id: "user" })],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_CAUSAL_HYPOTHESIS" });
  });
  it("rejects malformed AI adoption and invalid not-confirmed provenance", () => {
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [
            hypothesis({
              provenance: {
                source_type: "ai_proposal",
                source_reference: "run-1",
                adopted_by_user_id: USER,
                adopted_at: "today",
              },
            }),
          ],
          root_cause_not_confirmed: null,
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_CAUSAL_PROVENANCE" });
    expect(
      validateCapaRootCausePackage(
        {
          hypotheses: [],
          root_cause_not_confirmed: {
            rationale: "No cause confirmed.",
            next_steps: ["Monitor"],
            concluded_by_user_id: USER,
            concluded_at: when,
            provenance: {
              source_type: "ai_proposal",
              source_reference: "run-1",
              adopted_by_user_id: USER,
              adopted_at: when,
            },
          },
        },
        ledger()
      )
    ).toMatchObject({ reason_code: "INVALID_ROOT_CAUSE_NOT_CONFIRMED" });
  });
  it("retains original provenance when an AI hypothesis is adopted", () => {
    const value = pkg(ledger(), [
      hypothesis({
        provenance: {
          source_type: "ai_proposal",
          source_reference: "run-1",
          adopted_by_user_id: USER,
          adopted_at: when,
        },
      }),
    ]);
    expect(value.hypotheses[0].provenance).toEqual({
      source_type: "ai_proposal",
      source_reference: "run-1",
      adopted_by_user_id: USER,
      adopted_at: when,
    });
  });
  it("does not map nonqualifying gap, conflict, or assumption boundaries", () => {
    const l = ledger([
      ledgerItem(),
      ledgerItem({
        item_id: "G1",
        information_class: "missing_information",
        evidence_status: null,
        gap_status: "open",
        human_disposition: null,
        critical_to_conclusion: false,
      }),
      ledgerItem({
        item_id: "G2",
        information_class: "missing_information",
        evidence_status: null,
        gap_status: "resolved",
        critical_to_conclusion: true,
      }),
      ledgerItem({ item_id: "E2" }),
      ledgerItem({
        item_id: "C1",
        information_class: "conflicting_information",
        evidence_status: null,
        conflict_status: "open",
        human_disposition: null,
        conflict_item_ids: ["E", "E2"],
        material_to_conclusion: false,
      }),
      ledgerItem({
        item_id: "C2",
        information_class: "conflicting_information",
        evidence_status: null,
        conflict_status: "resolved",
        conflict_item_ids: ["E", "E2"],
        material_to_conclusion: true,
      }),
      ledgerItem({
        item_id: "A1",
        information_class: "assumption",
        evidence_status: null,
        assumption_status: "open",
        human_disposition: null,
        material_to_conclusion: false,
      }),
      ledgerItem({
        item_id: "A2",
        information_class: "assumption",
        evidence_status: null,
        assumption_status: "supported",
        material_to_conclusion: true,
      }),
    ]);
    expect(evaluateCapaRootCauseReadiness(plan(), l, pkg(l))).toEqual({
      status: "ready_for_review",
    });
  });
  it.each(["rejected", "superseded", "unavailable"])(
    "maps relied-upon %s evidence to B-06",
    (evidence_status) => {
      const l = ledger([ledgerItem({ evidence_status })]);
      expect(evaluateCapaRootCauseReadiness(plan(), l, pkg(l))).toMatchObject({
        reason_codes: ["INVALID_EVIDENCE_RELIED_UPON"],
        canonical_blocker_codes: ["B-06"],
      });
    }
  );
  it("does not emit B-06 for unused, contradictory-only, or non-material causal support", () => {
    const l = ledger([ledgerItem({ evidence_status: "rejected" })]);
    const notConfirmed = {
      rationale: "No cause confirmed.",
      next_steps: ["Monitor"],
      concluded_by_user_id: USER,
      concluded_at: when,
      provenance: human,
    };
    const cases = [
      pkg(l, [], notConfirmed),
      pkg(
        l,
        [
          hypothesis({
            causal_role: "alternative_hypothesis",
            status: "rejected",
            supporting_evidence_item_ids: [],
            contradictory_evidence_item_ids: ["E"],
          }),
        ],
        notConfirmed
      ),
      pkg(
        l,
        [
          hypothesis({
            causal_role: "contributing_factor",
            status: "confirmed",
            material_to_package: false,
          }),
        ],
        notConfirmed
      ),
      pkg(
        l,
        [
          hypothesis({
            causal_role: "alternative_hypothesis",
            status: "confirmed",
            material_to_package: false,
          }),
        ],
        notConfirmed
      ),
    ];
    for (const value of cases) {
      const result = evaluateCapaRootCauseReadiness(plan(), l, value);
      if (result.status === "blocked") {
        expect(result.reason_codes).not.toContain(
          "INVALID_EVIDENCE_RELIED_UPON"
        );
        expect(result.canonical_blocker_codes).not.toContain("B-06");
      }
    }
  });
  it.each([
    ["proposed_root_cause", false],
    ["contributing_factor", true],
    ["alternative_hypothesis", true],
  ])(
    "emits B-06 for qualifying %s materiality %s support",
    (causal_role, material_to_package) => {
      const l = ledger([ledgerItem({ evidence_status: "unavailable" })]);
      const value = pkg(l, [
        hypothesis({ causal_role, material_to_package, status: "confirmed" }),
      ]);
      expect(evaluateCapaRootCauseReadiness(plan(), l, value)).toMatchObject({
        canonical_blocker_codes: ["B-06"],
      });
    }
  );
  it("has exact canonical mappings, deterministic deduplication, no override, and frozen output", () => {
    expect(CAPA_ROOT_CAUSE_CANONICAL_BLOCKER_MAPPING).toEqual({
      UNRESOLVED_CRITICAL_EVIDENCE_GAP: "B-02",
      UNRESOLVED_MATERIAL_CONTRADICTION: "B-03",
      OPEN_MATERIAL_ASSUMPTION: "B-04",
      INVALID_EVIDENCE_RELIED_UPON: "B-06",
    });
    expect(evaluateCapaRootCauseReadiness).toHaveLength(3);
    const result = evaluateCapaRootCauseReadiness(
      plan("planned"),
      ledger(),
      pkg()
    );
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === "blocked") {
      expect(Object.isFrozen(result.reason_codes)).toBe(true);
      expect(Object.isFrozen(result.canonical_blocker_codes)).toBe(true);
      expect(new Set(result.reason_codes).size).toBe(
        result.reason_codes.length
      );
    }
    const value = pkg();
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.hypotheses)).toBe(true);
    expect(Object.isFrozen(value.hypotheses[0].provenance)).toBe(true);
    expect(
      Object.isFrozen(value.hypotheses[0].supporting_evidence_item_ids)
    ).toBe(true);
    expect(
      Object.isFrozen(value.hypotheses[0].contradictory_evidence_item_ids)
    ).toBe(true);
    const notConfirmed = pkg(ledger(), [], {
      rationale: "No root cause was confirmed.",
      next_steps: ["Continue monitoring"],
      concluded_by_user_id: USER,
      concluded_at: when,
      provenance: human,
    }).root_cause_not_confirmed;
    expect(Object.isFrozen(notConfirmed)).toBe(true);
    expect(Object.isFrozen(notConfirmed?.next_steps)).toBe(true);
    expect(Object.isFrozen(notConfirmed?.provenance)).toBe(true);
  });
});
