import { describe, expect, it, vi } from "vitest";
import type { CapaRequestContext, SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";
import { parseQualityDataPilotGate } from "../../lib/quality-data/quality-data-pilot-gate";
import { handleQualityDataAnalysisPost, handleQualityDataSignalDetectionPost, handleQualityDataVersionApprovalGet, handleQualityDataVersionApprovalPost, type QualityDataStage3AApiDependencies } from "../../lib/quality-data/quality-data-stage3a-api";
import type { QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import type { TransactionContext, TransactionManager } from "../../lib/database/transactions";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const USER = "12000000-0000-4000-8000-000000000001";
const ORG = "12000000-0000-4000-8000-000000000002";
const MEMBER = "12000000-0000-4000-8000-000000000003";
const VERSION = "12000000-0000-4000-8000-000000000004";

const facts: SupabaseCapaSessionFacts = {
  verified_user_id: USER,
  authenticated_at: "2026-10-18T11:00:00.000Z",
  expires_at_epoch_seconds: Date.parse("2026-10-18T13:00:00.000Z") / 1000,
};
const context: CapaRequestContext = {
  owner_user_id: USER as never,
  authentication: {
    principal: { principal_type: "human", user_id: USER as never }, session_id: "session" as never,
    authentication_method: "SUPABASE_SESSION" as never, assurance_level: "SINGLE_FACTOR" as never,
    authenticated_at: facts.authenticated_at as never, expires_at: "2026-10-18T13:00:00.000Z" as never,
  },
  tenant: {
    organization_id: ORG as never, access_grant_id: MEMBER as never, access_path: "SUPABASE_MEMBERSHIP" as never,
    authorization_policy_version: "policy-1.0.0", resolved_at: NOW.toISOString() as never,
    role_assignments: [{ role_assignment_id: "12000000-0000-4000-8000-000000000005" as never, role_id: "CAPA_ORG_ADMIN" as never, scope: "ORGANIZATION" as never, effective_at: "2026-10-18T10:00:00.000Z" as never }],
  },
};

function service(): QualityDataStage3AServiceDependencies {
  return {
    repository: {
      appendVersionApproval: vi.fn(async () => ({ status: "applied", state: {
        organization_id: ORG, dataset_id: "12000000-0000-4000-8000-000000000006", dataset_version_id: VERSION,
        decision: "approved", approval_event_id: "12000000-0000-4000-8000-000000000007", transition_number: 1,
        reviewer_user_id: USER, reviewer_membership_id: MEMBER, occurred_at: NOW.toISOString(), rationale: "Approved",
      } })),
      findApprovedDatasetVersion: vi.fn(async () => ({ status: "not_approved", decision: "none" })),
      findVersionApprovalSummary: vi.fn(async () => ({
        dataset_id: "12000000-0000-4000-8000-000000000006", dataset_version_id: VERSION,
        current_decision: null, transition_number: 0, current_event: null,
      })),
    } as never,
    audit_repository: { appendEvent: vi.fn(async (_tx, event) => ({ status: "appended", event_id: event.event_id })) } as never,
    transaction_manager: { runInTransaction: async <Result>(_trace: RequestTrace, work: (transaction: TransactionContext) => Promise<Result>): Promise<Result> => work({ transaction_id: "tx" as never, started_at: NOW.toISOString() as never, request_trace: {} as never }) } satisfies TransactionManager,
    authorizer: {
      authorizeRead: vi.fn(async () => ({ allowed: true, organization_id: ORG, membership_id: MEMBER, uploader_user_id: USER })),
      authorizeApproval: vi.fn(async () => ({ allowed: true, organization_id: ORG, membership_id: MEMBER, uploader_user_id: USER })),
    } as never,
    ids: { audit_event_id: () => "12000000-0000-4000-8000-000000000008" as never, uuid: () => "12000000-0000-4000-8000-000000000009" },
    clock: { now: () => new Date(NOW) },
  };
}

function dependencies(options: { enabled?: boolean; service?: QualityDataStage3AServiceDependencies; rate?: "allowed" | "limited" | "unavailable" } = {}): QualityDataStage3AApiDependencies {
  return {
    get_session_facts: async () => facts,
    resolve_context: async () => context,
    get_service_dependencies: vi.fn(() => options.service ?? service()),
    now: () => new Date(NOW),
    generate_uuid: (() => crypto.randomUUID()),
    configured_app_url: "https://lvtchat.test",
    pilot_gate: options.enabled === false ? parseQualityDataPilotGate("false", undefined) : parseQualityDataPilotGate("true", ORG),
    rate_limiter: { consume: vi.fn(async () => options.rate ?? "allowed"), acquireParseSlot: vi.fn() } as never,
  };
}

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://lvtchat.test${path}`, {
    method: "POST",
    headers: { origin: "https://lvtchat.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Stage 3A quality-data API controls", () => {
  it("keeps approval and analysis unavailable when the pilot gate is disabled", async () => {
    const deps = dependencies({ enabled: false });
    const body = { schema_version: "quality-analysis-request-1.0.0", dataset_version_id: VERSION, time_window: { kind: "all_records_in_dataset_version" }, metrics: [{ metric_id: "complete", kind: "field_completeness", field_key: "reject_count" }] };
    const response = await handleQualityDataAnalysisPost(request("/api/quality-data/analysis", body), deps);
    expect(response.status).toBe(404);
    expect(deps.get_service_dependencies).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before resolving a service", async () => {
    const deps = dependencies();
    const crossSite = request("/api/quality-data/analysis", {}, { origin: "https://attacker.test", "sec-fetch-site": "cross-site" });
    expect((await handleQualityDataAnalysisPost(crossSite, deps)).status).toBe(403);
    expect(deps.get_service_dependencies).not.toHaveBeenCalled();
  });

  it("uses the exact server-resolved organization and rate-limits analysis", async () => {
    const deps = dependencies({ rate: "limited" });
    const response = await handleQualityDataAnalysisPost(request("/api/quality-data/analysis", {}), deps);
    expect(response.status).toBe(429);
    expect(deps.rate_limiter.consume).toHaveBeenCalledWith(USER, "analysis", NOW.getTime());
  });

  it("applies the existing pilot gate, read authorization, and shared analysis rate limit to signal detection", async () => {
    const body = {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION,
      signals: [{ signal_id: "repeats", kind: "recurring_category", semantic_role: "defect_code", field_key: "defect_code", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }],
    };
    const disabled = dependencies({ enabled: false });
    expect((await handleQualityDataSignalDetectionPost(request("/api/quality-data/signals", body), disabled)).status).toBe(404);
    expect(disabled.get_service_dependencies).not.toHaveBeenCalled();

    const crossSite = dependencies();
    const forgedOrigin = request("/api/quality-data/signals", body, { origin: "https://attacker.test", "sec-fetch-site": "cross-site" });
    expect((await handleQualityDataSignalDetectionPost(forgedOrigin, crossSite)).status).toBe(403);
    expect(crossSite.get_service_dependencies).not.toHaveBeenCalled();

    const deniedService = service();
    vi.mocked(deniedService.authorizer.authorizeRead).mockResolvedValue({ allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" });
    const denied = dependencies({ service: deniedService });
    expect((await handleQualityDataSignalDetectionPost(request("/api/quality-data/signals", body), denied)).status).toBe(403);
    expect(deniedService.repository.findApprovedDatasetVersion).not.toHaveBeenCalled();

    const limited = dependencies({ rate: "limited" });
    expect((await handleQualityDataSignalDetectionPost(request("/api/quality-data/signals", body), limited)).status).toBe(429);
    expect(limited.rate_limiter.consume).toHaveBeenCalledWith(USER, "analysis", NOW.getTime());
  });

  it("fails closed on rejected or revoked versions through the signal API", async () => {
    const backing = service();
    const response = await handleQualityDataSignalDetectionPost(request("/api/quality-data/signals", {
      schema_version: "quality-signal-request-1.0.0", dataset_version_id: VERSION,
      signals: [{ signal_id: "repeats", kind: "recurring_category", semantic_role: "defect_code", field_key: "defect_code", minimum_occurrences: 2, minimum_sample_size: 3, time_window: { kind: "all_records_in_dataset_version" } }],
    }), dependencies({ service: backing }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("dataset_not_approved");
  });

  it("requires idempotent explicit approval and maps transition conflict safely", async () => {
    const backing = service();
    const apiDeps = dependencies({ service: backing });
    const body = {
      schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: VERSION,
      decision: "approved", expected_transition_number: 0, rationale: "Ready for analysis",
    };
    const noKey = await handleQualityDataVersionApprovalPost(request("/api/quality-data/versions/x/approval", body), VERSION, apiDeps);
    expect(noKey.status).toBe(400);
    const conflictService = service();
    vi.mocked(conflictService.repository.appendVersionApproval).mockResolvedValueOnce({ status: "conflict", reason_code: "STALE_TRANSITION" });
    const conflict = await handleQualityDataVersionApprovalPost(request("/api/quality-data/versions/x/approval", body, { "idempotency-key": "approval-key" }), VERSION, dependencies({ service: conflictService }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("approval_conflict");
  });

  it("serves the current approval transition only to an authenticated same-origin approver", async () => {
    const deps = dependencies();
    const get = new Request(`https://lvtchat.test/api/quality-data/versions/${VERSION}/approval`, {
      method: "GET", headers: { origin: "https://lvtchat.test" },
    });
    const response = await handleQualityDataVersionApprovalGet(get, VERSION, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "found", approval: { transition_number: 0, current_decision: null } });
    expect(deps.rate_limiter.consume).toHaveBeenCalledWith(USER, "approval", NOW.getTime());

    const noFetchMetadata = new Request(get.url, { method: "GET" });
    expect((await handleQualityDataVersionApprovalGet(noFetchMetadata, VERSION, dependencies())).status).toBe(403);
  });

  it("bounds JSON request processing before parsing large bodies", async () => {
    const deps = dependencies();
    const huge = request("/api/quality-data/analysis", { data: "x".repeat(33_000) });
    expect((await handleQualityDataAnalysisPost(huge, deps)).status).toBe(413);
  });
});
