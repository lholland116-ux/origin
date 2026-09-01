import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseCapaExistingCaseResponse,
} from "../../app/capa/capa-existing-case-client";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const OTHER_CASE_ID =
  "10000000-0000-4000-8000-000000000002";

const CASE_VERSION_ID =
  "20000000-0000-4000-8000-000000000001";

const SECTION_VERSION_ID =
  "30000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "40000000-0000-4000-8000-000000000001";

const FALLBACK_CORRELATION_ID =
  "50000000-0000-4000-8000-000000000001";

function responseBody() {
  return {
    capa: {
      capa_case_id:
        CASE_ID,

      case_number:
        "CAPA-000008",

      status:
        "S10",

      record_version:
        2,

      current_version_id:
        CASE_VERSION_ID,

      created_at:
        "2026-08-27T15:43:00.000Z",

      sections: [
        {
          section_version_id:
            SECTION_VERSION_ID,

          content: {
            initiating_event:
              "Production validation intake.",

            source: {
              source_type:
                "internal",

              source_reference:
                "M5-E2E",
            },

            organization_reference:
              "LVTChat LLC",
          },
        },
      ],
    },

    correlation_id:
      CORRELATION_ID,
  };
}

describe(
  "CAPA existing-case browser parser",
  () => {
    it(
      "accepts an authoritative S10 case bound to the selected CAPA",
      () => {
        expect(
          parseCapaExistingCaseResponse(
            responseBody(),
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toEqual({
          capaCaseId:
            CASE_ID,

          caseNumber:
            "CAPA-000008",

          status:
            "S10",

          recordVersion:
            2,

          currentVersionId:
            CASE_VERSION_ID,

          sectionVersionId:
            SECTION_VERSION_ID,

          createdAt:
            "2026-08-27T15:43:00.000Z",

          initiatingEvent:
            "Production validation intake.",

          sourceType:
            "internal",

          sourceReference:
            "M5-E2E",

          organizationReference:
            "LVTChat LLC",

          correlationId:
            CORRELATION_ID,

          retrievalVerified:
            true,
        });
      },
    );

    it(
      "uses the request correlation ID when the response omits one",
      () => {
        const body = responseBody();

        const {
          correlation_id:
            _correlationId,
          ...withoutCorrelation
        } = body;

        expect(
          parseCapaExistingCaseResponse(
            withoutCorrelation,
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toMatchObject({
          correlationId:
            FALLBACK_CORRELATION_ID,
        });
      },
    );

    it(
      "rejects a response for a different CAPA case",
      () => {
        const body = responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,
                capa_case_id:
                  OTHER_CASE_ID,
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it.each([
      0,
      -1,
      1.5,
      "2",
      null,
    ])(
      "rejects invalid record version %j",
      (recordVersion) => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,
                record_version:
                  recordVersion,
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects a representation without a valid intake section",
      () => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,
                sections: [],
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects a representation without an authoritative source type",
      () => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,

                sections: [
                  {
                    section_version_id:
                      SECTION_VERSION_ID,

                    content: {
                      initiating_event:
                        "Production validation intake.",

                      source: {},
                    },
                  },
                ],
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects malformed optional controlled fields",
      () => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,

                sections: [
                  {
                    section_version_id:
                      SECTION_VERSION_ID,

                    content: {
                      initiating_event:
                        "Production validation intake.",

                      source: {
                        source_type:
                          "internal",

                        source_reference:
                          123,
                      },

                      organization_reference:
                        false,
                    },
                  },
                ],
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );
  },
);

const CONTROLLED_PLAN_ID = "30000000-0000-4000-8000-000000000010";
const CONTROLLED_LEDGER_ID = "30000000-0000-4000-8000-000000000011";
const CONTROLLED_PACKAGE_ID = "30000000-0000-4000-8000-000000000012";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const human = { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null };
function controlledPlan() { return { section_version_id: CONTROLLED_PLAN_ID, section_type: "CAPA.INVESTIGATION_PLAN",
  schema_version: "capa-investigation-plan-1.0.0", content: { items: [{ item_id: "INV-1", investigation_question: "Why?",
    evidence_target: "Record", investigation_method: "Review", owner_user_id: USER_ID, due_date: "2026-09-30",
    sme_user_ids: [], dependency_item_ids: [], scope_relationship: "Approved scope", status: "completed",
    disposition: null, disposition_rationale: null, draft_provenance: human }] } }; }
function controlledLedger() { return { section_version_id: CONTROLLED_LEDGER_ID, section_type: "CAPA.EVIDENCE_ASSUMPTION_LEDGER",
  schema_version: "capa-evidence-assumption-ledger-1.0.0", content: { items: [{ item_id: "E-1",
    information_class: "user_provided_statement", statement: "Observed condition", evidence_status: "current",
    assumption_status: null, gap_status: null, conflict_status: null, provenance: human, owner_user_id: null,
    information_date: null, source_version: null, context: null, linked_capa_objects: [], supporting_item_ids: [],
    contradictory_item_ids: [], conflict_item_ids: [], material_to_conclusion: false, critical_to_conclusion: false,
    recommended_next_step: null, target_date: null, human_disposition: null }] } }; }
function controlledPackage() { return { section_version_id: CONTROLLED_PACKAGE_ID, section_type: "CAPA.ROOT_CAUSE_PACKAGE",
  schema_version: "capa-root-cause-package-1.0.0", content: { hypotheses: [{ hypothesis_id: "H-1",
    statement: "Observed condition caused event", status: "confirmed", causal_role: "proposed_root_cause",
    rationale: "Supported", responsible_user_id: USER_ID, supporting_evidence_item_ids: ["E-1"],
    contradictory_evidence_item_ids: [], linked_assumption_item_ids: [], linked_gap_item_ids: [],
    linked_conflict_item_ids: [], material_to_package: true, provenance: human }], root_cause_not_confirmed: null } }; }
function stateBody(status: "S40" | "S50") {
  const base = responseBody(); return { ...base, capa: { ...base.capa, status,
    sections: [...base.capa.sections, controlledPlan(), ...(status === "S50" ? [controlledLedger(), controlledPackage()] : []),
      { section_type: "CAPA.UNRELATED", schema_version: "other-1", section_version_id: "30000000-0000-4000-8000-000000000099", content: { ignored: true } }] } };
}

describe("CAPA existing-case controlled section parsing", () => {
  const parse = (body: unknown) => parseCapaExistingCaseResponse(body, { expectedCaseId: CASE_ID, fallbackCorrelationId: FALLBACK_CORRELATION_ID });
  it("parses an S40 plan and retains its section identity", () => {
    expect(parse(stateBody("S40"))).toMatchObject({ investigationPlanSectionVersionId: CONTROLLED_PLAN_ID,
      investigationPlan: { items: [{ item_id: "INV-1" }] } });
  });
  it("requires one valid correctly versioned S40 plan", () => {
    const body = stateBody("S40");
    expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.filter((section) => !("section_type" in section) || section.section_type !== "CAPA.INVESTIGATION_PLAN") } })).toBeNull();
    expect(parse({ ...body, capa: { ...body.capa, sections: [...body.capa.sections, controlledPlan()] } })).toBeNull();
    expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.map((section) => "section_type" in section && section.section_type === "CAPA.INVESTIGATION_PLAN" ? { ...section, schema_version: "wrong" } : section) } })).toBeNull();
    expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.map((section) => "section_type" in section && section.section_type === "CAPA.INVESTIGATION_PLAN" ? { ...section, content: { items: "bad" } } : section) } })).toBeNull();
  });
  it("requires and validates all S50 controlled sections and retains identities", () => {
    expect(parse(stateBody("S50"))).toMatchObject({ investigationPlanSectionVersionId: CONTROLLED_PLAN_ID,
      evidenceAssumptionLedgerSectionVersionId: CONTROLLED_LEDGER_ID, rootCausePackageSectionVersionId: CONTROLLED_PACKAGE_ID });
    for (const type of ["CAPA.INVESTIGATION_PLAN", "CAPA.EVIDENCE_ASSUMPTION_LEDGER", "CAPA.ROOT_CAUSE_PACKAGE"]) {
      const body = stateBody("S50");
      expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.filter((section) => !("section_type" in section) || section.section_type !== type) } })).toBeNull();
    }
  });
  it("rejects duplicate, schema-mismatched, and malformed ledger/package sections", () => {
    for (const type of ["CAPA.EVIDENCE_ASSUMPTION_LEDGER", "CAPA.ROOT_CAUSE_PACKAGE"]) {
      const body = stateBody("S50"); const target = body.capa.sections.find((section) => "section_type" in section && section.section_type === type)!;
      expect(parse({ ...body, capa: { ...body.capa, sections: [...body.capa.sections, target] } })).toBeNull();
      expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.map((section) => section === target ? { ...section, schema_version: "wrong" } : section) } })).toBeNull();
      expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.map((section) => section === target ? { ...section, content: {} } : section) } })).toBeNull();
    }
  });
  it("cross-validates root-package references against the authoritative ledger", () => {
    const body = stateBody("S50");
    expect(parse({ ...body, capa: { ...body.capa, sections: body.capa.sections.map((section) => "section_type" in section && section.section_type === "CAPA.ROOT_CAUSE_PACKAGE" ? { ...section, content: { ...controlledPackage().content, hypotheses: controlledPackage().content.hypotheses.map((h) => ({ ...h, supporting_evidence_item_ids: ["missing"] })) } } : section) } })).toBeNull();
  });
});
