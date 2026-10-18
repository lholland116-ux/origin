import { describe, expect, it, vi } from "vitest";
import { handleQualityDataAiInterpretationPost, handleQualityDataExternalAiOptInPost, handleQualityDataIntelligencePost, handleQualityDataIntelligenceReviewPost, type QualityDataAiApiDependencies } from "../../lib/quality-data/quality-data-ai-api";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import { parseQualityDataAiGate } from "../../lib/quality-data/quality-data-ai-gate";
import { parseQualityDataPilotGate } from "../../lib/quality-data/quality-data-pilot-gate";

const USER = "11000000-0000-4000-8000-000000000001";
const ORG = "11000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "11000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-10-18T12:00:00.000Z");

function context(): CapaRequestContext {
  return { owner_user_id: USER as never, authentication: { principal: { principal_type: "human", user_id: USER as never }, session_id: "session" as never,
    authentication_method: "SUPABASE_SESSION" as never, assurance_level: "SINGLE_FACTOR" as never, authenticated_at: "2026-10-18T10:00:00.000Z" as never, expires_at: "2026-10-18T14:00:00.000Z" as never },
    tenant: { organization_id: ORG as never, access_grant_id: MEMBERSHIP as never, access_path: "SUPABASE_MEMBERSHIP" as never, authorization_policy_version: "p", resolved_at: NOW.toISOString() as never, role_assignments: [] } };
}

function dependencies(overrides: Partial<QualityDataAiApiDependencies> = {}): QualityDataAiApiDependencies {
  return {
    get_session_facts: vi.fn(async () => ({ verified_user_id: USER, authenticated_at: "2026-10-18T10:00:00.000Z", expires_at_epoch_seconds: NOW.getTime() / 1000 + 7200 })),
    resolve_context: vi.fn(async () => context()),
    get_ai_dependencies: vi.fn(() => null), get_control_dependencies: vi.fn(() => null), now: () => new Date(NOW),
    generate_uuid: (() => { let counter = 10; return () => `11000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`; })(),
    configured_app_url: "https://app.example", quality_data_pilot_gate: parseQualityDataPilotGate("true", ORG),
    ai_gate: parseQualityDataAiGate("true", ORG),
    rate_limiter: { consume: vi.fn(async () => "allowed" as const), acquireParseSlot: vi.fn(async () => "unavailable" as const) },
    ...overrides,
  };
}

function post(path: string, body = "{}") { return new Request(`https://app.example${path}`, { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body }); }

describe("Stage 3C HTTP boundary", () => {
  it("does not construct or call a model when the AI feature gate is absent or misconfigured", async () => {
    const disabled = dependencies({ ai_gate: undefined });
    const response = await handleQualityDataAiInterpretationPost(post("/api/quality-data/ai-analysis"), disabled);
    expect(response.status).toBe(404);
    expect(disabled.get_ai_dependencies).not.toHaveBeenCalled();
    const malformed = dependencies({ ai_gate: parseQualityDataAiGate("true", "bad-org") });
    expect((await handleQualityDataAiInterpretationPost(post("/api/quality-data/ai-analysis"), malformed)).status).toBe(404);
  });

  it("fails closed on origin, session, pilot, rate limiter, and unavailable provider dependencies", async () => {
    const origin = dependencies();
    expect((await handleQualityDataAiInterpretationPost(new Request("https://app.example/x", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), origin)).status).toBe(403);
    const noSession = dependencies({ get_session_facts: vi.fn(async () => null) });
    expect((await handleQualityDataAiInterpretationPost(post("/api/quality-data/ai-analysis"), noSession)).status).toBe(401);
    const pilotOff = dependencies({ quality_data_pilot_gate: undefined });
    expect((await handleQualityDataAiInterpretationPost(post("/api/quality-data/ai-analysis"), pilotOff)).status).toBe(404);
    const rateFail = dependencies({ rate_limiter: { consume: vi.fn(async () => "unavailable" as const), acquireParseSlot: vi.fn(async () => "unavailable" as const) } });
    expect((await handleQualityDataAiInterpretationPost(post("/api/quality-data/ai-analysis"), rateFail)).status).toBe(503);
    const noClient = dependencies({ get_ai_dependencies: vi.fn(() => null) });
    expect((await handleQualityDataAiInterpretationPost(post("/api/quality-data/ai-analysis"), noClient)).status).toBe(503);
  });

  it("fails closed when the external-transfer control repository is unavailable", async () => {
    const missingService = dependencies({ ai_gate: undefined });
    const body = JSON.stringify({ schema_version: "quality-data-external-ai-opt-in-1.0.0", decision: "enabled", expected_transition_number: 0, rationale: "Authorized transfer" });
    const response = await handleQualityDataExternalAiOptInPost(post("/api/quality-data/external-ai-opt-in", body), missingService);
    expect(response.status).toBe(503);
    expect(missingService.rate_limiter.consume).not.toHaveBeenCalled();
  });
});

describe("Stage 3D authenticated intelligence API boundary", () => {
  const runId = "61000000-0000-4000-8000-000000000001";
  const reviewBody = JSON.stringify({
    schema_version: "quality-data-intelligence-review-1.0.0", report_id: runId, finding_key: "possible_cause:0",
    expected_transition_number: 0, decision: "follow_up_requested", rationale: "Review the synthetic finding.",
  });

  it("keeps report creation unreachable when either pilot gate is disabled and requires a request idempotency key", async () => {
    const disabled = dependencies({ quality_data_pilot_gate: undefined, get_stage3d_dependencies: vi.fn(() => null) });
    expect((await handleQualityDataIntelligencePost(post("/api/quality-data/intelligence", "{}"), disabled)).status).toBe(404);
    expect(disabled.get_stage3d_dependencies).not.toHaveBeenCalled();

    const noKey = dependencies({ get_stage3d_dependencies: vi.fn(() => null) });
    expect((await handleQualityDataIntelligencePost(post("/api/quality-data/intelligence", "{}"), noKey)).status).toBe(400);
    expect(noKey.get_stage3d_dependencies).not.toHaveBeenCalled();
  });

  it("requires the distinct human reviewer authorization and does not construct a model client", async () => {
    const base = {
      quality_data: { authorizer: { authorizeRead: vi.fn(async () => ({ allowed: true, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER })),
        authorizeIntelligenceReview: vi.fn(async () => ({ allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" })) },
        clock: { now: () => new Date(NOW) }, repository: { findApprovedDatasetVersion: vi.fn() } },
      repository: { findReport: vi.fn() }, audit_repository: {}, transaction_manager: {}, authorizer: {
        authorizeRead: vi.fn(async () => ({ allowed: true, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER })),
        authorizeIntelligenceReview: vi.fn(async () => ({ allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" })),
      }, ids: {}, clock: { now: () => new Date(NOW) },
    };
    const getStage3d = vi.fn(() => base as never);
    const getAi = vi.fn(() => null);
    const deps = dependencies({ get_stage3d_dependencies: getStage3d, get_ai_dependencies: getAi });
    const request = new Request(`https://app.example/api/quality-data/intelligence/${runId}/review`, {
      method: "POST", headers: { origin: "https://app.example", "content-type": "application/json", "idempotency-key": "review-once" }, body: reviewBody,
    });
    const response = await handleQualityDataIntelligenceReviewPost(request, runId, deps);
    expect(response.status).toBe(403);
    expect(getAi).not.toHaveBeenCalled();
    expect(base.repository.findReport).not.toHaveBeenCalled();
  });
});
