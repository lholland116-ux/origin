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
          "capa-agent-registry-1.0.0",
        );
        expect(Object.isFrozen(registry))
          .toBe(true);
      },
    );

    it(
      "makes only AG-INTAKE runtime approved",
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
        ).toEqual(["approved"]);
      },
    );

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
