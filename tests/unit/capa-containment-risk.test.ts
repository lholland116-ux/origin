import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
  CAPA_CONTAINMENT_RISK_SECTION_TYPE,
  validateCapaContainmentRiskContent,
} from "../../lib/capa/domain/capa-containment-risk";

function validContainmentRisk() {
  return {
    actions: [
      {
        action_id:
          "containment-action-001",
        action_type:
          "containment",
        description:
          "Place potentially affected inventory on controlled hold.",
        owner_user_id:
          "quality-user-001",
        action_date:
          "2026-08-29",
        target_date:
          "2026-08-29",
        completed_date: null,
        status:
          "in_progress",
        rationale:
          "Prevent unintended use while extent is investigated.",
        supporting_evidence_references:
          ["hold-record-001"],
      },
    ],
    impact_scope: {
      products: [
        "Device family A",
      ],
      processes: [
        "Machining operation 40",
      ],
      data: [],
      customers: [],
      patients: [],
    },
    risk_evaluation: {
      method:
        "Organization Risk Procedure QP-17",
      terminology_version:
        "revision-6",
      result:
        "Further evaluation required",
      rationale:
        "Distribution status and functional impact remain unresolved.",
    },
    missing_risk_information: [
      "Distribution exposure has not yet been confirmed.",
    ],
    escalations: [
      {
        process:
          "Regulatory assessment",
        reference:
          "RA-2026-001",
        status:
          "open",
        rationale:
          "Separate qualified assessment is required.",
      },
    ],
  };
}

describe(
  "controlled CAPA containment and risk contract",
  () => {
    it(
      "exposes stable controlled identifiers",
      () => {
        expect(
          CAPA_CONTAINMENT_RISK_SECTION_TYPE,
        ).toBe(
          "CAPA.CONTAINMENT_RISK",
        );

        expect(
          CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
        ).toBe(
          "capa-containment-risk-1.0.0",
        );
      },
    );

    it(
      "accepts organization-specific risk terminology",
      () => {
        const result =
          validateCapaContainmentRiskContent(
            validContainmentRisk(),
          );

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            result.value
              .risk_evaluation
              ?.method,
          ).toBe(
            "Organization Risk Procedure QP-17",
          );
        }
      },
    );

    it(
      "allows an incomplete working S20 record without treating it as accepted",
      () => {
        const result =
          validateCapaContainmentRiskContent({
            actions: [],
            impact_scope: {
              products: [],
              processes: [],
              data: [],
              customers: [],
              patients: [],
            },
            risk_evaluation: null,
            missing_risk_information: [
              "Initial impact assessment is pending.",
            ],
            escalations: [],
          });

        expect(result.status)
          .toBe("valid");
      },
    );

    it(
      "keeps immediate correction distinct from containment",
      () => {
        const value =
          validContainmentRisk();

        const result =
          validateCapaContainmentRiskContent({
            ...value,
            actions: [
              {
                ...value.actions[0],
                action_id:
                  "correction-001",
                action_type:
                  "correction",
              },
              {
                ...value.actions[0],
                action_id:
                  "containment-001",
                action_type:
                  "containment",
              },
            ],
          });

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            result.value.actions.map(
              (action) =>
                action.action_type,
            ),
          ).toEqual([
            "correction",
            "containment",
          ]);
        }
      },
    );

    it(
      "rejects duplicate action identities",
      () => {
        const value =
          validContainmentRisk();

        const result =
          validateCapaContainmentRiskContent({
            ...value,
            actions: [
              value.actions[0],
              {
                ...value.actions[0],
              },
            ],
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "DUPLICATE_CONTAINMENT_ACTION_ID",
        });
      },
    );

    it(
      "requires completed actions to carry a completion date",
      () => {
        const value =
          validContainmentRisk();

        const result =
          validateCapaContainmentRiskContent({
            ...value,
            actions: [
              {
                ...value.actions[0],
                status: "completed",
                completed_date: null,
              },
            ],
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_CONTAINMENT_ACTIONS",
        });
      },
    );

    it(
      "rejects a field that could falsely encode autonomous AI risk approval",
      () => {
        const result =
          validateCapaContainmentRiskContent({
            ...validContainmentRisk(),
            ai_risk_approved: true,
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_CONTAINMENT_RISK_FIELDS",
        });
      },
    );
  },
);
