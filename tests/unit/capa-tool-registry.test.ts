import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_AGENT_TOOL_IDS,
} from "../../lib/capa/ai/capa-agent-contract";

import {
  createInitialCapaToolRegistry,
} from "../../lib/capa/ai/capa-tool-registry";

const VERSIONS = {
  "TOOL-CASE-READ":
    "tool-case-read-1.0.0",
  "TOOL-EVIDENCE-READ":
    "tool-evidence-read-1.0.0",
  "TOOL-RETRIEVE":
    "tool-retrieve-1.0.0",
  "TOOL-STRUCTURED-DRAFT":
    "tool-structured-draft-1.0.0",
  "TOOL-FILE-EXTRACT-READ":
    "tool-file-extract-read-1.0.0",
  "TOOL-CALCULATE":
    "tool-calculate-1.0.0",
  "TOOL-REPORT-DRAFT":
    "tool-report-draft-1.0.0",
  "TOOL-FEEDBACK":
    "tool-feedback-1.0.0",
} as const;

describe(
  "initial governed CAPA tool registry",
  () => {
    it(
      "contains all eight controlled tool identities",
      () => {
        const registry =
          createInitialCapaToolRegistry();

        expect(registry.registry_version)
          .toBe(
            "capa-tool-registry-1.0.0",
          );
        expect(registry.listToolIds())
          .toEqual(CAPA_AGENT_TOOL_IDS);
        expect(Object.isFrozen(registry))
          .toBe(true);
      },
    );

    it(
      "resolves every exact controlled version",
      () => {
        const registry =
          createInitialCapaToolRegistry();

        for (const toolId of CAPA_AGENT_TOOL_IDS) {
          expect(
            registry.findExact(
              toolId,
              VERSIONS[toolId],
            ),
          ).toMatchObject({
            tool_id: toolId,
            tool_version:
              VERSIONS[toolId],
            audit_required: true,
            tenant_scope_required: true,
            direct_case_mutation: false,
            external_side_effects: false,
          });
        }
      },
    );

    it(
      "approves only the initial tenant-scoped case reader",
      () => {
        const registry =
          createInitialCapaToolRegistry();

        const statuses =
          CAPA_AGENT_TOOL_IDS.map(
            (toolId) => ({
              toolId,
              status:
                registry.findExact(
                  toolId,
                  VERSIONS[toolId],
                )?.status,
            }),
          );

        expect(
          statuses.filter(
            ({ status }) =>
              status === "approved",
          ),
        ).toEqual([
          {
            toolId: "TOOL-CASE-READ",
            status: "approved",
          },
        ]);
      },
    );

    it(
      "rejects implicit and unknown versions",
      () => {
        const registry =
          createInitialCapaToolRegistry();

        expect(
          registry.findExact(
            "TOOL-CASE-READ",
            "latest",
          ),
        ).toBeNull();
        expect(
          registry.findExact(
            "TOOL-CASE-READ",
            "tool-case-read-2.0.0",
          ),
        ).toBeNull();
      },
    );

    it(
      "keeps calculation authority narrow",
      () => {
        const calculator =
          createInitialCapaToolRegistry()
            .findExact(
              "TOOL-CALCULATE",
              VERSIONS["TOOL-CALCULATE"],
            );

        expect(calculator).toMatchObject({
          status: "evaluation",
          capability_class:
            "deterministic_compute",
          allowed_agent_ids: [
            "AG-EFFECT",
          ],
          allowed_operations: [
            "analyze_effectiveness",
          ],
          allowed_workflow_states: [
            "S100",
            "S110",
          ],
        });
      },
    );

    it(
      "keeps report drafting limited to the report agent",
      () => {
        const report =
          createInitialCapaToolRegistry()
            .findExact(
              "TOOL-REPORT-DRAFT",
              VERSIONS[
                "TOOL-REPORT-DRAFT"
              ],
            );

        expect(report).toMatchObject({
          status: "evaluation",
          allowed_agent_ids: [
            "AG-REPORT",
          ],
          allowed_operations: [
            "assemble_report_draft",
          ],
        });
      },
    );

    it(
      "freezes definition collections against runtime mutation",
      () => {
        const item =
          createInitialCapaToolRegistry()
            .findExact(
              "TOOL-CASE-READ",
              VERSIONS["TOOL-CASE-READ"],
            );

        expect(Object.isFrozen(item))
          .toBe(true);
        expect(
          Object.isFrozen(
            item?.allowed_agent_ids,
          ),
        ).toBe(true);
        expect(
          Object.isFrozen(
            item?.allowed_operations,
          ),
        ).toBe(true);
        expect(
          Object.isFrozen(
            item?.allowed_workflow_states,
          ),
        ).toBe(true);
      },
    );
  },
);
