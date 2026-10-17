import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import type { TransactionManager, TransactionWork } from "../../lib/database/transactions";
import { QUALITY_DATA_XLSX_MEDIA_TYPE } from "../../lib/quality-data/xlsx-quality-data-parser";
import { ingestQualityDataXlsx } from "../../lib/quality-data/xlsx-quality-data-ingestion";
import { SupabaseQualityDataSourceStorage } from "../../lib/database/supabase/supabase-quality-data-source-storage";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const MEMBER = "10000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-10-17T12:00:00.000Z");

function context(): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: {
      principal: { principal_type: "human", user_id: USER as never },
      session_id: "session" as never,
      authentication_method: "SUPABASE_SESSION" as never,
      assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-10-17T11:00:00.000Z" as never,
      expires_at: "2026-10-17T13:00:00.000Z" as never,
    },
    tenant: {
      organization_id: ORG as never,
      access_grant_id: MEMBER as never,
      access_path: "SUPABASE_MEMBERSHIP" as never,
      authorization_policy_version: "policy-1.0.0",
      resolved_at: NOW.toISOString() as never,
      role_assignments: [],
    },
  };
}

const mapping = {
  worksheet_name: "Inspections",
  header_row: 1,
  columns: [
    { header: "Part", field_key: "part_number", value_type: "text" as const, required: true },
    { header: "Defects", field_key: "defect_count", value_type: "number" as const, required: true, normalized_unit: "count" },
  ],
  ignored_headers: [],
};

async function workbookBytes(part = "P-100", defects: number | string = 2): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inspections");
  sheet.addRow(["Part", "Defects"]);
  sheet.addRow([part, defects]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function trace(key = "quality-xlsx-import-1"): RequestTrace {
  return {
    request_id: "20000000-0000-4000-8000-000000000001" as never,
    correlation_id: "20000000-0000-4000-8000-000000000002" as never,
    idempotency_key: key as never,
  };
}

function dependencies(options: { authorized?: boolean; storeStatus?: "stored" | "already_matches" | "conflict" } = {}) {
  const organizationId = ORG;
  const repository = {
    persistIngestion: vi.fn().mockResolvedValue({
      status: "inserted",
      receipt: {
        status: "accepted", ingestion_job_id: "20000000-0000-4000-8000-000000000011",
        source_id: "20000000-0000-4000-8000-000000000012", source_version_id: "20000000-0000-4000-8000-000000000013",
        dataset_id: "20000000-0000-4000-8000-000000000014", dataset_version_id: "20000000-0000-4000-8000-000000000015",
        record_count: 1, field_count: 2, review_state: "review_required",
      },
    }),
    findDatasetVersion: vi.fn().mockResolvedValue(null),
  };
  const audit = {
    appendEvent: vi.fn().mockResolvedValue({ status: "appended", event_id: "event" }),
    findEventById: vi.fn().mockResolvedValue(null),
    listEventsForAggregate: vi.fn().mockResolvedValue({ events: [] }),
  };
  const transaction: TransactionManager = {
    async runInTransaction<Result>(requestTrace: RequestTrace, work: TransactionWork<Result>): Promise<Result> {
      return work({ transaction_id: "tx" as never, started_at: NOW.toISOString() as never, request_trace: requestTrace });
    },
  };
  const authorizer = {
    authorize: vi.fn().mockResolvedValue(options.authorized === false
      ? { allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" }
      : { allowed: true, organization_id: organizationId, membership_id: MEMBER, uploader_user_id: USER }),
    authorizeRead: vi.fn(),
  };
  const sourceStorage = {
    storeOriginal: vi.fn(async (input: { organization_id: string; source_key: string; original_source_version: string; bytes: Uint8Array; sha256: string; media_type: string }) => ({
      status: options.storeStatus ?? "stored",
      storage_reference: `quality-data/${input.organization_id}/${createHash("sha256").update(input.source_key).digest("hex")}/${createHash("sha256").update(input.original_source_version).digest("hex")}/original`,
    })),
  };
  return {
    dependencies: {
      repository,
      audit_repository: audit,
      transaction_manager: transaction,
      authorizer,
      source_storage: sourceStorage,
      ids: { event_id: () => "20000000-0000-4000-8000-000000000016" as never, uuid: () => "20000000-0000-4000-8000-000000000017" },
      clock: { now: () => new Date(NOW) },
    },
    repository,
    audit,
    authorizer,
    sourceStorage,
  };
}

function request(bytes: Uint8Array) {
  return {
    idempotency_key: "quality-xlsx-import-1",
    source: { source_key: "line-a-inspections", source_name: "Line A inspections.xlsx", original_source_version: "revision-1", bytes },
    dataset: { dataset_key: "line-a-inspections", dataset_name: "Line A inspections", schema_version: "manufacturing-inspection-1.0.0" },
    mapping,
  };
}

describe("quality-data XLSX ingestion service", () => {
  it("persists deterministic typed records and source references through the governed service", async () => {
    const test = dependencies({ storeStatus: "already_matches" });
    const bytes = await workbookBytes();
    const result = await ingestQualityDataXlsx(test.dependencies, context(), trace(), request(bytes));
    expect(result.status).toBe("accepted");
    expect(test.authorizer.authorize).toHaveBeenCalledTimes(2);
    expect(test.sourceStorage.storeOriginal).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG,
      source_key: "line-a-inspections",
      original_source_version: "revision-1",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
    }));
    const persisted = test.repository.persistIngestion.mock.calls[0]?.[1];
    expect(persisted?.organization_id).toBe(ORG);
    expect(persisted?.command.source.source_type).toBe("xlsx");
    expect(persisted?.command.source.source_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(persisted?.command.records[0]).toEqual({
      source_worksheet: "Inspections",
      source_row_number: 2,
      fields: [
        { field_key: "part_number", value_type: "text", original_value: "P-100", normalized_value: "P-100", source_cell_reference: "A2" },
        { field_key: "defect_count", value_type: "number", original_value: 2, normalized_value: 2, normalized_unit: "count", source_cell_reference: "B2" },
      ],
    });
    expect(persisted?.command.source.storage_reference).toMatch(new RegExp(`^quality-data/${ORG}/[0-9a-f]{64}/[0-9a-f]{64}/original$`));
    expect(test.audit.appendEvent).toHaveBeenCalledTimes(1);
  });

  it("denies before parsing or service-role storage access", async () => {
    const test = dependencies({ authorized: false });
    const result = await ingestQualityDataXlsx(test.dependencies, context(), trace(), request(new Uint8Array([1, 2, 3])));
    expect(result).toEqual({ status: "denied", reason_code: "QUALITY_DATA_PERMISSION_DENIED" });
    expect(test.sourceStorage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("rejects client-supplied organization ownership before authorization or Storage access", async () => {
    const test = dependencies();
    const result = await ingestQualityDataXlsx(
      test.dependencies,
      context(),
      trace(),
      { ...request(await workbookBytes()), organization_id: "30000000-0000-4000-8000-000000000099" },
    );
    expect(result).toMatchObject({ status: "invalid_request", reason_code: "INVALID_XLSX_IMPORT_REQUEST" });
    expect(test.authorizer.authorize).not.toHaveBeenCalled();
    expect(test.sourceStorage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("returns bounded cell diagnostics and stores/persists nothing for invalid data", async () => {
    const test = dependencies();
    const result = await ingestQualityDataXlsx(test.dependencies, context(), trace(), request(await workbookBytes("P-100", "2")));
    expect(result).toMatchObject({ status: "invalid_request", reason_code: "XLSX_VALIDATION_FAILED" });
    if (result.status === "invalid_request") expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "XLSX_VALUE_TYPE_MISMATCH", row_number: 2, cell_reference: "B2", field_key: "defect_count",
    }));
    expect(test.sourceStorage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("rejects a conflicting immutable source object without a database import", async () => {
    const test = dependencies({ storeStatus: "conflict" });
    const result = await ingestQualityDataXlsx(test.dependencies, context(), trace(), request(await workbookBytes()));
    expect(result).toEqual({ status: "conflict", reason_code: "SOURCE_CONFLICT" });
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("uses the private bucket, immutable upload, and byte verification for an identical storage replay", async () => {
    const bytes = await workbookBytes();
    const blob = new Blob([Buffer.from(bytes)]);
    const upload = vi.fn().mockResolvedValue({ error: { statusCode: 409 } });
    const download = vi.fn().mockResolvedValue({ data: blob, error: null });
    const from = vi.fn().mockReturnValue({ upload, download });
    const adapter = new SupabaseQualityDataSourceStorage({ storage: { from } });
    const input = {
      organization_id: ORG,
      source_key: "line-a-inspections",
      original_source_version: "revision-1",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
    };
    const first = await adapter.storeOriginal(input);
    const second = await adapter.storeOriginal(input);
    expect(first.status).toBe("already_matches");
    expect(second.storage_reference).toBe(first.storage_reference);
    expect(from).toHaveBeenCalledWith("quality-data-sources");
    expect(upload).toHaveBeenCalledWith(first.storage_reference, expect.any(Buffer), expect.objectContaining({ upsert: false, contentType: QUALITY_DATA_XLSX_MEDIA_TYPE }));
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("rejects object-path content conflicts without overwriting stored bytes", async () => {
    const bytes = await workbookBytes();
    const upload = vi.fn().mockResolvedValue({ error: { statusCode: 409 } });
    const download = vi.fn().mockResolvedValue({ data: new Blob([Buffer.from("different")]), error: null });
    const adapter = new SupabaseQualityDataSourceStorage({ storage: { from: () => ({ upload, download }) } });
    await expect(adapter.storeOriginal({
      organization_id: ORG, source_key: "line-a-inspections", original_source_version: "revision-1",
      bytes, sha256: createHash("sha256").update(bytes).digest("hex"), media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
    })).resolves.toMatchObject({ status: "conflict" });
    expect(upload.mock.calls[0]?.[2]).toMatchObject({ upsert: false });
  });

  it("rejects checksum or MIME mismatches before writing to private Storage", async () => {
    const bytes = await workbookBytes();
    const upload = vi.fn();
    const adapter = new SupabaseQualityDataSourceStorage({ storage: { from: () => ({ upload, download: vi.fn() }) } });
    const base = {
      organization_id: ORG,
      source_key: "line-a-inspections",
      original_source_version: "revision-1",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: QUALITY_DATA_XLSX_MEDIA_TYPE,
    };
    await expect(adapter.storeOriginal({ ...base, sha256: "0".repeat(64) })).rejects.toThrow("request is invalid");
    await expect(adapter.storeOriginal({ ...base, media_type: "application/octet-stream" })).rejects.toThrow("request is invalid");
    expect(upload).not.toHaveBeenCalled();
  });
});
