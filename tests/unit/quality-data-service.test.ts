import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import { ingestQualityData, readQualityDatasetVersion } from "../../lib/quality-data/quality-data-service";
import type { QualityDataServiceDependencies } from "../../lib/quality-data/quality-data-service";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "10000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-10-16T12:00:00.000Z");
const BYTES = new TextEncoder().encode("synthetic quality source");
const TRACE = {
  request_id: "10000000-0000-4000-8000-000000000004",
  correlation_id: "10000000-0000-4000-8000-000000000005",
  idempotency_key: "quality-source-test-1",
} as RequestTrace;

function context(): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: {
      principal: { principal_type: "human", user_id: USER as never },
      session_id: "session-1" as never,
      authentication_method: "SUPABASE_SESSION" as never,
      assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-10-16T11:00:00.000Z" as never,
      expires_at: "2026-10-16T13:00:00.000Z" as never,
    },
    tenant: {
      organization_id: ORG as never,
      access_grant_id: MEMBERSHIP as never,
      access_path: "SUPABASE_MEMBERSHIP" as never,
      authorization_policy_version: "policy-1.0.0",
      resolved_at: NOW.toISOString() as never,
      role_assignments: [],
    },
  };
}

function input() {
  return {
    idempotency_key: "quality-source-test-1",
    source: {
      source_key: "fixture-source",
      source_name: "Synthetic source",
      source_type: "csv",
      original_source_version: "version-1",
      source_sha256: createHash("sha256").update(BYTES).digest("hex"),
      source_bytes: BYTES,
      media_type: "text/csv",
      storage_reference: `quality-data/${ORG}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original`,
      parser_version: "csv-1.0.0",
      schema_version: "quality-1.0.0",
    },
    dataset: {
      dataset_key: "fixture-dataset",
      dataset_name: "Synthetic dataset",
      schema_version: "quality-1.0.0",
    },
    records: [{
      source_worksheet: "Sheet1",
      source_row_number: 2,
      fields: [{ field_key: "result", value_type: "text", original_value: "pass", normalized_value: "pass", source_cell_reference: "A2" }],
    }],
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const repository = {
    persistIngestion: vi.fn().mockResolvedValue({
      status: "inserted",
      receipt: {
        status: "accepted",
        ingestion_job_id: "20000000-0000-4000-8000-000000000001",
        source_id: "20000000-0000-4000-8000-000000000002",
        source_version_id: "20000000-0000-4000-8000-000000000003",
        dataset_id: "20000000-0000-4000-8000-000000000004",
        dataset_version_id: "20000000-0000-4000-8000-000000000005",
        record_count: 1,
        field_count: 1,
        review_state: "review_required",
      },
    }),
    findDatasetVersion: vi.fn().mockResolvedValue({
      dataset: { organization_id: ORG },
      version: { dataset_version_id: "20000000-0000-4000-8000-000000000008" },
      source_versions: [], records: [], validation_outcomes: [],
    }),
  };
  const audit = { appendEvent: vi.fn().mockResolvedValue({ status: "appended", event_id: "event" }) };
  const transaction = {
    runInTransaction: vi.fn(async (_trace: RequestTrace, work: (tx: unknown) => Promise<unknown>) => work({ transaction_id: "tx" })),
  };
  const authorizer = {
    authorize: vi.fn().mockResolvedValue({
      allowed: true,
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      uploader_user_id: USER,
    }),
    authorizeRead: vi.fn().mockResolvedValue({
      allowed: true,
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      uploader_user_id: USER,
    }),
  };
  const deps = {
    repository,
    audit_repository: audit,
    transaction_manager: transaction,
    authorizer,
    ids: {
      event_id: () => "20000000-0000-4000-8000-000000000006",
      uuid: () => "20000000-0000-4000-8000-000000000007",
    },
    clock: { now: () => new Date(NOW) },
    ...overrides,
  } as unknown as QualityDataServiceDependencies;
  return { deps, repository, audit, transaction, authorizer };
}

describe("quality-data ingestion service", () => {
  it("uses server-resolved organization and uploader and audits in the same transaction", async () => {
    const test = dependencies();
    const result = await ingestQualityData(test.deps, context(), TRACE, input());
    expect(result.status).toBe("accepted");
    expect(test.repository.persistIngestion).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_id: "tx" }),
      expect.objectContaining({
        organization_id: ORG,
        membership_id: MEMBERSHIP,
        uploader_user_id: USER,
        idempotency_key: "quality-source-test-1",
      }),
    );
    expect(test.audit.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_id: "tx" }),
      expect.objectContaining({
        organization_id: ORG,
        actor: { actor_type: "human", actor_id: USER },
        action: "QUALITY_DATA_INGESTED",
        metadata: expect.objectContaining({ review_state: "review_required", human_evidence_verification: false }),
      }),
    );
  });

  it("does not persist when authorization is denied", async () => {
    const test = dependencies({ authorizer: { authorize: vi.fn().mockResolvedValue({ allowed: false, reason_code: "ACTIVE_ORG_ADMIN_REQUIRED" }) } });
    await expect(ingestQualityData(test.deps, context(), TRACE, input())).resolves.toEqual({
      status: "denied",
      reason_code: "ACTIVE_ORG_ADMIN_REQUIRED",
    });
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
    expect(test.audit.appendEvent).not.toHaveBeenCalled();
  });

  it("rejects idempotency mismatch and source hash mismatch before persistence", async () => {
    const test = dependencies();
    await expect(ingestQualityData(test.deps, context(), { ...TRACE, idempotency_key: "different" } as RequestTrace, input()))
      .resolves.toMatchObject({ status: "invalid_request", reason_code: "IDEMPOTENCY_KEY_MISMATCH" });
    await expect(ingestQualityData(test.deps, context(), TRACE, {
      ...input(), source: { ...input().source, source_sha256: "f".repeat(64) },
    })).resolves.toMatchObject({ status: "invalid_request", reason_code: "SOURCE_FINGERPRINT_MISMATCH" });
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("fails closed when the audit append fails so the transaction can roll back", async () => {
    const test = dependencies({ audit_repository: { appendEvent: vi.fn().mockRejectedValue(new Error("sensitive fixture error")) } });
    await expect(ingestQualityData(test.deps, context(), TRACE, input()))
      .rejects.toMatchObject({ reason_code: "PERSISTENCE_FAILED" });
    expect(test.transaction.runInTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("quality-data read service", () => {
  it("requires the independent read authorization before a repository read", async () => {
    const test = dependencies();
    const result = await readQualityDatasetVersion(
      test.deps,
      context(),
      "20000000-0000-4000-8000-000000000008",
    );
    expect(result.status).toBe("found");
    expect(test.authorizer.authorizeRead).toHaveBeenCalledWith(context(), NOW);
    expect(test.repository.findDatasetVersion).toHaveBeenCalledWith({
      organization_id: ORG,
      user_id: USER,
      membership_id: MEMBERSHIP,
      now: NOW.toISOString(),
    }, "20000000-0000-4000-8000-000000000008");
  });

  it("does not read through the privileged repository when read authorization is denied", async () => {
    const test = dependencies({
      authorizer: {
        authorize: vi.fn(),
        authorizeRead: vi.fn().mockResolvedValue({
          allowed: false,
          reason_code: "QUALITY_DATA_PERMISSION_DENIED",
        }),
      },
    });
    await expect(readQualityDatasetVersion(
      test.deps,
      context(),
      "20000000-0000-4000-8000-000000000008",
    )).resolves.toEqual({ status: "not_found_or_not_authorized" });
    expect(test.repository.findDatasetVersion).not.toHaveBeenCalled();
  });

  it("uses the authorization result rather than a caller-forged tenant scope", async () => {
    const test = dependencies();
    const forged = context();
    (forged.tenant as { organization_id: string }).organization_id = "10000000-0000-4000-8000-000000000099";
    await readQualityDatasetVersion(test.deps, forged, "20000000-0000-4000-8000-000000000008");
    expect(test.repository.findDatasetVersion).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      user_id: USER,
    }), "20000000-0000-4000-8000-000000000008");
  });
});
