import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import type { CapaRequestContext, SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";
import type { QualityDataXlsxApiDependencies, QualityDataXlsxApiRateLimiter } from "../../lib/quality-data/quality-data-xlsx-api";
import { handleQualityDataXlsxEligibilityGet, handleQualityDataXlsxPost, InMemoryQualityDataXlsxApiRateLimiter } from "../../lib/quality-data/quality-data-xlsx-api";
import { QUALITY_DATA_XLSX_MEDIA_TYPE } from "../../lib/quality-data/xlsx-quality-data-parser";
import type { QualityDataXlsxIngestionDependencies } from "../../lib/quality-data/xlsx-quality-data-ingestion";

const USER = "30000000-0000-4000-8000-000000000001";
const ORG = "30000000-0000-4000-8000-000000000002";
const MEMBER = "30000000-0000-4000-8000-000000000003";
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

async function workbook(): Promise<Uint8Array> {
  const value = new ExcelJS.Workbook();
  const sheet = value.addWorksheet("Inspections");
  sheet.addRow(["Part", "Defects", "Lot Date"]);
  sheet.addRow(["P-01", 2, new Date("2026-10-16T00:00:00.000Z")]);
  return new Uint8Array(await value.xlsx.writeBuffer());
}

const mapping = {
  worksheet_name: "Inspections",
  header_row: 1,
  columns: [
    { header: "Part", field_key: "part_number", value_type: "text", required: true },
    { header: "Defects", field_key: "defect_count", value_type: "number", required: true },
    { header: "Lot Date", field_key: "lot_date", value_type: "date", required: false },
  ],
  ignored_headers: [],
};

function formFor(bytes: Uint8Array, action: "inspect" | "preview" | "ingest", extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("file", new File([Buffer.from(bytes)], "inspections.xlsx", { type: QUALITY_DATA_XLSX_MEDIA_TYPE }));
  if (action !== "inspect") form.append("mapping", JSON.stringify(mapping));
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  return form;
}

function harness(options: { authenticated?: boolean; authorized?: boolean; rateLimiter?: QualityDataXlsxApiRateLimiter } = {}) {
  const repository = {
    persistIngestion: vi.fn().mockResolvedValue({
      status: "inserted",
      receipt: {
        status: "accepted", ingestion_job_id: "40000000-0000-4000-8000-000000000011",
        source_id: "40000000-0000-4000-8000-000000000012", source_version_id: "40000000-0000-4000-8000-000000000013",
        dataset_id: "40000000-0000-4000-8000-000000000014", dataset_version_id: "40000000-0000-4000-8000-000000000015",
        record_count: 1, field_count: 3, review_state: "review_required",
      },
    }),
    findDatasetVersion: vi.fn().mockResolvedValue(null),
  };
  const audit = { appendEvent: vi.fn().mockResolvedValue({ status: "appended" }), findEventById: vi.fn(), listEventsForAggregate: vi.fn() };
  const authorizer = {
    authorize: vi.fn().mockResolvedValue(options.authorized === false
      ? { allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" }
      : { allowed: true, organization_id: ORG, membership_id: MEMBER, uploader_user_id: USER }),
    authorizeRead: vi.fn(),
  };
  const storage = {
    storeOriginal: vi.fn(async (input: { organization_id: string; source_key: string; original_source_version: string; bytes: Uint8Array; sha256: string; media_type: string }) => ({
      status: "stored" as const,
      storage_reference: `quality-data/${input.organization_id}/source/version/original`,
    })),
  };
  const ingestionDependencies: QualityDataXlsxIngestionDependencies = {
    repository,
    audit_repository: audit as never,
    transaction_manager: { async runInTransaction<RequestResult>(requestTrace: RequestTrace, work: (transaction: never) => Promise<RequestResult>) {
      return work({ transaction_id: "tx" as never, started_at: NOW.toISOString() as never, request_trace: requestTrace } as never);
    } },
    authorizer,
    ids: { event_id: () => "40000000-0000-4000-8000-000000000016" as never, uuid: () => "40000000-0000-4000-8000-000000000017" },
    clock: { now: () => new Date(NOW) },
    source_storage: storage,
  };
  const facts: SupabaseCapaSessionFacts = {
    verified_user_id: USER,
    authenticated_at: NOW.toISOString(),
    expires_at_epoch_seconds: Math.floor(NOW.getTime() / 1_000) + 3_600,
    verified_aal: "aal1",
  };
  const dependencies: QualityDataXlsxApiDependencies = {
    get_session_facts: vi.fn().mockResolvedValue(options.authenticated === false ? null : facts),
    resolve_context: vi.fn().mockResolvedValue(context()),
    get_ingestion_dependencies: vi.fn().mockReturnValue(ingestionDependencies),
    now: () => new Date(NOW),
    generate_uuid: (() => {
      let value = 0;
      return () => `40000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
    })(),
    rate_limiter: options.rateLimiter,
  };
  return { dependencies, ingestionDependencies, repository, authorizer, storage };
}

function request(action: string, form: FormData, idempotencyKey?: string): Request {
  return new Request(`https://app.test/api/quality-data/xlsx?action=${action}`, {
    method: "POST",
    headers: { origin: "https://app.test", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: form,
  });
}

describe("authenticated quality-data XLSX API integration", () => {
  it("returns only a server-authorized capability flag without tenant identifiers", async () => {
    const test = harness();
    const allowed = await handleQualityDataXlsxEligibilityGet(test.dependencies);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ can_ingest: true });
    const denied = harness({ authorized: false });
    expect((await handleQualityDataXlsxEligibilityGet(denied.dependencies)).status).toBe(403);
  });

  it("authenticates and authorizes before reading or storing an uploaded workbook", async () => {
    const test = harness({ authenticated: false });
    const response = await handleQualityDataXlsxPost(request("preview", formFor(await workbook(), "preview")), test.dependencies);
    expect(response.status).toBe(401);
    expect(test.dependencies.get_ingestion_dependencies).not.toHaveBeenCalled();
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("denies a user without server-resolved ingest permission before parsing", async () => {
    const test = harness({ authorized: false });
    const response = await handleQualityDataXlsxPost(request("preview", formFor(await workbook(), "preview")), test.dependencies);
    expect(response.status).toBe(403);
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser submissions before authentication or upload processing", async () => {
    const test = harness();
    const crossOrigin = new Request("https://app.test/api/quality-data/xlsx?action=preview", {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "multipart/form-data; boundary=x" },
      body: "not-read",
    });
    expect((await handleQualityDataXlsxPost(crossOrigin, test.dependencies)).status).toBe(403);
    expect(test.dependencies.get_session_facts).not.toHaveBeenCalled();
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
  });

  it("inspects worksheets and only returns headers for a selected sheet and row", async () => {
    const test = harness();
    const bytes = await workbook();
    const inventory = await handleQualityDataXlsxPost(request("inspect", formFor(bytes, "inspect")), test.dependencies);
    expect(inventory.status).toBe(200);
    expect(await inventory.json()).toMatchObject({ worksheets: [{ name: "Inspections", visible: true }] });
    const headersForm = formFor(bytes, "inspect", { worksheet: "Inspections", header_row: "1" });
    const headers = await handleQualityDataXlsxPost(request("inspect", headersForm), test.dependencies);
    expect(await headers.json()).toMatchObject({ headers: [
      { column_reference: "A1", value: "Part" },
      { column_reference: "B1", value: "Defects" },
      { column_reference: "C1", value: "Lot Date" },
    ] });
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("previews mapped data without returning values or writing to Storage/database", async () => {
    const test = harness();
    const response = await handleQualityDataXlsxPost(request("preview", formFor(await workbook(), "preview")), test.dependencies);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "valid", record_count: 1, field_count: 3, review_state: "review_required" });
    expect(JSON.stringify(body)).not.toContain("P-01");
    expect(JSON.stringify(body)).not.toContain(ORG);
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("rejects forged tenant fields and oversized uploads before ingestion", async () => {
    const test = harness();
    const forged = formFor(await workbook(), "preview");
    forged.append("organization_id", "foreign-tenant");
    expect((await handleQualityDataXlsxPost(request("preview", forged), test.dependencies)).status).toBe(400);
    const oversized = new Request("https://app.test/api/quality-data/xlsx?action=preview", {
      method: "POST",
      headers: { origin: "https://app.test", "content-type": "multipart/form-data; boundary=x", "content-length": String(10 * 1024 * 1024 + 65 * 1024) },
      body: "x",
    });
    expect((await handleQualityDataXlsxPost(oversized, test.dependencies)).status).toBe(413);
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("returns bounded structural diagnostics without source values when validation fails", async () => {
    const test = harness();
    const bad = new ExcelJS.Workbook();
    const sheet = bad.addWorksheet("Inspections");
    sheet.addRow(["Part", "Defects", "Lot Date"]);
    sheet.addRow(["P-01", "two", new Date("2026-10-16T00:00:00.000Z")]);
    const bytes = new Uint8Array(await bad.xlsx.writeBuffer());
    const response = await handleQualityDataXlsxPost(request("preview", formFor(bytes, "preview")), test.dependencies);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ code: "XLSX_VALUE_TYPE_MISMATCH", cell_reference: "B2", field_key: "defect_count" }));
    expect(JSON.stringify(body)).not.toContain("two");
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("submits through the existing idempotent service with server-derived source version and provenance", async () => {
    const test = harness();
    const bytes = await workbook();
    const form = formFor(bytes, "ingest", { dataset_key: "line-a", dataset_name: "Line A inspection", source_key: "upload:stable-1" });
    const response = await handleQualityDataXlsxPost(request("ingest", form, "quality-api-import-1"), test.dependencies);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ status: "accepted", review_state: "review_required", receipt: { record_count: 1, field_count: 3 } });
    expect(body.source).toEqual({
      source_name: "inspections.xlsx",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      original_source_version: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(JSON.stringify(body)).not.toContain(ORG);
    expect(test.storage.storeOriginal).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: ORG,
      source_key: "upload:stable-1",
      original_source_version: createHash("sha256").update(bytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }));
    expect(test.repository.persistIngestion).toHaveBeenCalledTimes(1);
    expect(test.authorizer.authorize).toHaveBeenCalledTimes(3);
  });

  it("does not buffer uploads after a rate-limit response", async () => {
    const test = harness({ rateLimiter: {
      consume: () => false,
      acquireParseSlot: vi.fn(() => () => undefined),
    } });
    const response = await handleQualityDataXlsxPost(request("preview", formFor(await workbook(), "preview")), test.dependencies);
    expect(response.status).toBe(429);
    expect(test.storage.storeOriginal).not.toHaveBeenCalled();
    expect(test.repository.persistIngestion).not.toHaveBeenCalled();
  });

  it("maps the same idempotency key to a safe already-registered response on retry", async () => {
    const test = harness();
    const bytes = await workbook();
    const receipt = {
      status: "accepted",
      ingestion_job_id: "40000000-0000-4000-8000-000000000011",
      source_id: "40000000-0000-4000-8000-000000000012",
      source_version_id: "40000000-0000-4000-8000-000000000013",
      dataset_id: "40000000-0000-4000-8000-000000000014",
      dataset_version_id: "40000000-0000-4000-8000-000000000015",
      record_count: 1,
      field_count: 3,
      review_state: "review_required",
    };
    test.repository.persistIngestion
      .mockResolvedValueOnce({ status: "inserted", receipt })
      .mockResolvedValueOnce({ status: "already_registered", receipt: { ...receipt, status: "already_registered" } });
    const firstForm = formFor(bytes, "ingest", { dataset_key: "line-a", dataset_name: "Line A", source_key: "upload:stable-1" });
    const replayForm = formFor(bytes, "ingest", { dataset_key: "line-a", dataset_name: "Line A", source_key: "upload:stable-1" });
    expect((await handleQualityDataXlsxPost(request("ingest", firstForm, "same-key"), test.dependencies)).status).toBe(201);
    const replay = await handleQualityDataXlsxPost(request("ingest", replayForm, "same-key"), test.dependencies);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ status: "already_registered", review_state: "review_required" });
    expect(test.repository.persistIngestion).toHaveBeenCalledTimes(2);
    expect(test.repository.persistIngestion.mock.calls.map((call) => call[1].idempotency_key)).toEqual(["same-key", "same-key"]);
  });

  it("requires an idempotency key and enforces bounded process-local request limits", async () => {
    const test = harness();
    const form = formFor(await workbook(), "ingest", { dataset_key: "line-a", dataset_name: "Line A", source_key: "upload:stable-1" });
    expect((await handleQualityDataXlsxPost(request("ingest", form), test.dependencies)).status).toBe(400);
    const limiter = new InMemoryQualityDataXlsxApiRateLimiter();
    for (let index = 0; index < 5; index += 1) expect(limiter.consume(USER, "ingest", NOW.getTime())).toBe(true);
    expect(limiter.consume(USER, "ingest", NOW.getTime())).toBe(false);
    expect(limiter.acquireParseSlot()).toBeTypeOf("function");
  });
});
