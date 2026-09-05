import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_AGENT_IDS,
  CAPA_AGENT_PROHIBITIONS,
} from "../../lib/capa/ai/capa-agent-contract";

import {
  createInitialCapaAgentRegistry,
} from "../../lib/capa/ai/capa-agent-registry";

describe(
  "initial controlled CAPA agent registry",
  () => {
    it(
      "contains every approved logical identity exactly once",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        expect(
          registry.listAgentIds(),
        ).toEqual(CAPA_AGENT_IDS);
        expect(
          new Set(
            registry.listAgentIds(),
          ).size,
        ).toBe(CAPA_AGENT_IDS.length);
      },
    );

    it(
      "exposes an exact immutable registry version",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        expect(
          registry.registry_version,
        ).toBe(
          "capa-agent-registry-1.1.0",
        );
        expect(Object.isFrozen(registry))
          .toBe(true);
      },
    );

    it(
      "makes only AG-INTAKE, AG-PLAN, and AG-RCA runtime approved",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        const statuses =
          CAPA_AGENT_IDS.map((agentId) => {
            const version =
              agentId === "AG-CAPA-ORCH"
                ? "ag-capa-orch-1.0.0"
                : `${agentId.toLowerCase()}-1.0.0`;

            return registry.findExact(
              agentId,
              version,
            )?.status;
          });

        expect(
          statuses.filter(
            (status) =>
              status === "approved",
          ),
        ).toEqual(["approved", "approved", "approved"]);
      },
    );

    it("keeps the approved AG-PLAN S30 activation bindings exact", () => {
      const plan = createInitialCapaAgentRegistry().findExact(
        "AG-PLAN",
        "ag-plan-1.0.0",
      );

      expect(plan).toMatchObject({
        logical_agent_id: "AG-PLAN",
        agent_version: "ag-plan-1.0.0",
        status: "approved",
        eligible_states: ["S30"],
        allowed_operations: ["draft_investigation_plan"],
        allowed_requester_roles: ["CAPA_OWNER", "CAPA_CONTRIBUTOR"],
        allowed_tools: [
          "TOOL-CASE-READ",
          "TOOL-STRUCTURED-DRAFT",
          "TOOL-FEEDBACK",
        ],
        output_schema_version: "capa_investigation_plan_draft-1.0.0",
        activation_capabilities: [{
          eligible_states: ["S30"],
          operation: "draft_investigation_plan",
          allowed_tools: [
            "TOOL-CASE-READ",
            "TOOL-STRUCTURED-DRAFT",
            "TOOL-FEEDBACK",
          ],
          output_schema_version: "capa_investigation_plan_draft-1.0.0",
        }],
      });
    });

    it("keeps the approved AG-RCA S40 activation binding exact and frozen", () => {
      const rca = createInitialCapaAgentRegistry().findExact(
        "AG-RCA",
        "ag-rca-1.0.0",
      );

      expect(rca).toMatchObject({
        logical_agent_id: "AG-RCA",
        agent_version: "ag-rca-1.0.0",
        status: "approved",
        activation_capabilities: [{
          eligible_states: ["S40"],
          operation: "facilitate_root_cause",
          output_schema_version: "capa_investigation_analysis_draft-1.0.0",
          allowed_tools: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"],
        }],
      });
      expect(rca?.activation_capabilities).toHaveLength(1);
      expect(rca?.activation_capabilities[0]?.allowed_tools).not.toContain(
        "TOOL-RETRIEVE",
      );
      expect(rca?.activation_capabilities[0]?.allowed_tools).not.toContain(
        "TOOL-EVIDENCE-READ",
      );
      expect(rca?.activation_capabilities[0]?.allowed_tools).not.toContain(
        "TOOL-FEEDBACK",
      );
      expect(Object.isFrozen(rca?.activation_capabilities)).toBe(true);
      expect(Object.isFrozen(rca?.activation_capabilities[0])).toBe(true);
      expect(Object.isFrozen(rca?.activation_capabilities[0]?.eligible_states)).toBe(true);
      expect(Object.isFrozen(rca?.activation_capabilities[0]?.allowed_tools)).toBe(true);
    });

    it(
      "resolves AG-INTAKE only by exact version",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        const intake = registry.findExact(
          "AG-INTAKE",
          "ag-intake-1.0.0",
        );

        expect(intake).toMatchObject({
          logical_agent_id:
            "AG-INTAKE",
          status: "approved",
          eligible_states: [
            "S00",
            "S10",
            "S20",
          ],
          allowed_operations: [
            "draft_intake_analysis",
          ],
          allowed_requester_roles: [
            "CAPA_OWNER",
            "CAPA_CONTRIBUTOR",
          ],
        });

        expect(
          registry.findExact(
            "AG-INTAKE",
            "latest",
          ),
        ).toBeNull();
      },
    );

    it("binds AG-INTAKE S10 and S20 capabilities without broadening tools", () => {
      const intake = createInitialCapaAgentRegistry().findExact("AG-INTAKE", "ag-intake-1.0.0");
      expect(intake?.activation_capabilities).toHaveLength(2);
      expect(intake?.activation_capabilities[0]).toMatchObject({ eligible_states: ["S00", "S10"], operation: "draft_intake_analysis", output_schema_version: "capa-intake-draft-output-1.0.0" });
      expect(intake?.activation_capabilities[1]).toMatchObject({ eligible_states: ["S20"], operation: "analyze_containment_impact_risk", output_schema_version: "capa-containment-risk-advisory-1.0.0", allowed_tools: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"] });
      expect(intake?.activation_capabilities[1].allowed_tools).not.toContain("TOOL-RETRIEVE");
      expect(intake?.activation_capabilities[1].allowed_tools).not.toContain("TOOL-FEEDBACK");
      expect(Object.isFrozen(intake?.activation_capabilities)).toBe(true);
      expect(Object.isFrozen(intake?.activation_capabilities[0])).toBe(true);
    });

    it(
      "does not grant organization administrators case-agent access",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        for (
          const agentId
          of CAPA_AGENT_IDS
        ) {
          const versions = [
            "ag-capa-orch-1.0.0",
            `${agentId.toLowerCase()}-1.0.0`,
          ];

          const item = versions
            .map((version) =>
              registry.findExact(
                agentId,
                version,
              ),
            )
            .find(
              (definition) =>
                definition !== null,
            );

          expect(item).not.toBeNull();
          expect(
            item?.allowed_requester_roles,
          ).not.toContain(
            "CAPA_ORG_ADMIN",
          );
        }
      },
    );

    it(
      "applies every common authority prohibition to every agent",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        for (
          const agentId
          of CAPA_AGENT_IDS
        ) {
          const version =
            agentId === "AG-CAPA-ORCH"
              ? "ag-capa-orch-1.0.0"
              : `${agentId.toLowerCase()}-1.0.0`;
          const item = registry.findExact(
            agentId,
            version,
          );

          expect(item?.prohibitions)
            .toEqual(
              CAPA_AGENT_PROHIBITIONS,
            );
        }
      },
    );

    it(
      "keeps specialized tool permissions narrow",
      () => {
        const registry =
          createInitialCapaAgentRegistry();

        expect(
          registry.findExact(
            "AG-EFFECT",
            "ag-effect-1.0.0",
          )?.allowed_tools,
        ).toContain("TOOL-CALCULATE");

        expect(
          registry.findExact(
            "AG-INTAKE",
            "ag-intake-1.0.0",
          )?.allowed_tools,
        ).not.toContain(
          "TOOL-CALCULATE",
        );

        expect(
          registry.findExact(
            "AG-REPORT",
            "ag-report-1.0.0",
          )?.allowed_tools,
        ).toContain(
          "TOOL-REPORT-DRAFT",
        );
      },
    );
  },
);
