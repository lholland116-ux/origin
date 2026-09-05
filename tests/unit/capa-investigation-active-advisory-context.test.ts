import { describe, expect, it } from "vitest";

import type {
  CapaInvestigationActiveAdvisoryContextAssembly,
} from "../../lib/capa/ai/capa-investigation-active-advisory-context";

describe("S40 investigation-active advisory context contract", () => {
  it("separates authoritative context, server manifest, and model-safe references", () => {
    const context = {
      authoritative: {
        trust: "authoritative_server_context",
        organization_id: "org",
        capa_case_id: "case",
        case_version_id: "version",
        record_version: 4,
        workflow_state: "S40",
        actor: "user",
        active_roles: [],
        investigation_plan: { items: [] },
      },
      reference_manifest: [],
      model_safe_context: {
        trust: "model_safe_context",
        workflow_state: "S40",
        references: [],
      },
    } as unknown as
      CapaInvestigationActiveAdvisoryContextAssembly;

    expect(context.authoritative.trust).toBe(
      "authoritative_server_context",
    );
    expect(context.model_safe_context.trust).toBe(
      "model_safe_context",
    );
    expect(context.reference_manifest).toEqual([]);
  });
});
