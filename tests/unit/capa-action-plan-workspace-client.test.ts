import { describe, expect, it, vi } from "vitest";
import {
  loadActionPlanWorkspace,
  parseCapaActionPlanWorkspaceLoad,
  saveActionPlanWorkspace,
} from "../../app/capa/capa-action-plan-workspace-client";

const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const CORRELATION = "40000000-0000-4000-8000-000000000001";
const PLAN = { items: [], effectiveness_checks: [] };
const WORKSPACE = { draft_revision: 2, case_version_id: VERSION, record_version: 4, action_plan: PLAN, updated_at: "2026-09-09T12:00:00.000Z" };
const RETURN_RESPONSE = {
  schema_version: "capa-action-plan-review-return-response-draft-1.0.0",
  response_narrative: "The returned review comments were addressed.",
  return_transition_audit_event_id: "50000000-0000-4000-8000-000000000001",
  source_case_version_id: "30000000-0000-4000-8000-000000000002",
  resulting_case_version_id: VERSION,
  responded_by: { actor_type: "human", actor_id: "40000000-0000-4000-8000-000000000001" },
  responded_at: "2026-09-09T12:00:00.000Z",
};

describe("S60 action-plan workspace browser client", () => {
  it("parses an absent load and hydrates a saved workspace", async () => {
    await expect(loadActionPlanWorkspace(CASE, async () => new Response(JSON.stringify({ workspace: null, correlation_id: CORRELATION }), { status: 200 }))).resolves.toMatchObject({ status: "loaded", workspace: null });
    expect(parseCapaActionPlanWorkspaceLoad({ workspace: WORKSPACE, correlation_id: CORRELATION })).toMatchObject({ status: "loaded", workspace: { draft_revision: 2, action_plan: PLAN } });
  });

  it("sends only the editable request and preserves the returned revision", async () => {
    let sent: RequestInit | undefined;
    const result = await saveActionPlanWorkspace(CASE, { expected_draft_revision: 2, action_plan: PLAN }, async (_url, init) => { sent = init; return new Response(JSON.stringify({ workspace: WORKSPACE, correlation_id: CORRELATION }), { status: 200 }); });
    expect(result).toMatchObject({ status: "saved", workspace: { draft_revision: 2 } });
    expect(JSON.parse(String(sent?.body))).toEqual({ expected_draft_revision: 2, action_plan: PLAN });
    expect(JSON.stringify(sent?.body)).not.toContain("organization_id");
  });

  it("round-trips a server-bound return response and sends only its editable narrative", async () => {
    const sent: RequestInit[] = [];
    const result = await loadActionPlanWorkspace(CASE, async (_url, init) => new Response(JSON.stringify({ workspace: { ...WORKSPACE, action_plan_return_response: RETURN_RESPONSE }, correlation_id: CORRELATION }), { status: 200 }));
    expect(result).toMatchObject({ status: "loaded", workspace: { action_plan_return_response: { editable: { response_narrative: RETURN_RESPONSE.response_narrative }, metadata: { return_transition_audit_event_id: RETURN_RESPONSE.return_transition_audit_event_id } } } });
    const saved = await saveActionPlanWorkspace(CASE, { expected_draft_revision: 2, action_plan: PLAN, action_plan_return_response: { response_narrative: RETURN_RESPONSE.response_narrative } }, async (_url, init) => { if (init !== undefined) sent.push(init); return new Response(JSON.stringify({ workspace: { ...WORKSPACE, action_plan_return_response: RETURN_RESPONSE }, correlation_id: CORRELATION }), { status: 200 }); });
    expect(saved).toMatchObject({ status: "saved", workspace: { action_plan_return_response: { editable: { response_narrative: RETURN_RESPONSE.response_narrative } } } });
    expect(JSON.parse(String(sent[0]?.body))).toEqual({ expected_draft_revision: 2, action_plan: PLAN, action_plan_return_response: { response_narrative: RETURN_RESPONSE.response_narrative } });
  });

  it("maps controlled failures and does not retry a stale write", async () => {
    for (const code of ["INVALID_CAPA_ACTION_PLAN_WORKSPACE_REQUEST", "CAPA_ACTION_PLAN_WORKSPACE_ACCESS_DENIED", "CAPA_ACTION_PLAN_WORKSPACE_CASE_STATE_CONFLICT", "WORKFLOW_MUTATION_DETECTED", "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", "CAPA_INTERNAL_ERROR"]) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code, correlation_id: CORRELATION } }), { status: code === "CAPA_ACTION_PLAN_WORKSPACE_ACCESS_DENIED" ? 403 : code === "INVALID_CAPA_ACTION_PLAN_WORKSPACE_REQUEST" ? 400 : 409 }));
      const result = await saveActionPlanWorkspace(CASE, { expected_draft_revision: 2, action_plan: PLAN }, fetcher as typeof fetch);
      expect(result).toMatchObject({ status: "failed", code });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed for malformed success responses and network failures", async () => {
    expect(parseCapaActionPlanWorkspaceLoad({ workspace: { ...WORKSPACE, draft_revision: 0 }, correlation_id: CORRELATION })).toMatchObject({ status: "failed", code: "INVALID_WORKSPACE_RESPONSE" });
    await expect(loadActionPlanWorkspace(CASE, async () => { throw new Error("network"); })).resolves.toMatchObject({ status: "failed", code: null });
  });
});
