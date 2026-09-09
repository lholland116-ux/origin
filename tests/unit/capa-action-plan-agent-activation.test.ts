import { describe, expect, it } from "vitest";

import {
  createCapaAgentActivationService,
} from "../../lib/capa/ai/capa-agent-activation-service";

import type {
  CapaAgentEligibilityRequest,
} from "../../lib/capa/ai/capa-agent-contract";

import {
  createInitialCapaAgentRegistry,
} from "../../lib/capa/ai/capa-agent-registry";

import {
  CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-action-plan-advisory-contract";

describe("AG-ACTION controlled S60 activation", () => {
  it("activates only the approved AG-ACTION S60 advisory capability", () => {
    const registry = createInitialCapaAgentRegistry();

    expect(
      registry.findExact(
        "AG-ACTION",
        "ag-action-1.0.0",
      )?.status,
    ).toBe("approved");

    const service = createCapaAgentActivationService(
      registry,
    );

    const request: CapaAgentEligibilityRequest = {
      agent_id: "AG-ACTION",
      agent_version: "ag-action-1.0.0" as never,
      workflow_state: "S60" as const,
      operation: "generate_action_plan_advisory",
      active_role_ids: [
        "CAPA_OWNER" as never,
      ],
      requested_tool_ids: [
        "TOOL-CASE-READ",
        "TOOL-EVIDENCE-READ",
        "TOOL-STRUCTURED-DRAFT",
      ],
      output_schema_version:
        CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION as never,
    };

    expect(
      service.evaluate(request),
    ).toMatchObject({
      eligible: true,
      reason_code: "AGENT_ELIGIBLE",
    });

    expect(
      service.evaluate({
        ...request,
        workflow_state: "S50",
      }),
    ).toMatchObject({
      eligible: false,
      reason_code: "WORKFLOW_STATE_NOT_ELIGIBLE",
    });

    expect(
      service.evaluate({
        ...request,
        operation: "draft_action_plan",
      }),
    ).toMatchObject({
      eligible: false,
      reason_code: "OPERATION_NOT_ELIGIBLE",
    });
  });
});
