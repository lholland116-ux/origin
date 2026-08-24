import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  CorrelationId,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaKnowledgeCollectionVersion,
  CapaKnowledgeDerivative,
  CapaKnowledgeOriginalArtifact,
  CapaKnowledgePassage,
  CapaKnowledgeSource,
  CapaKnowledgeSourceVersion,
} from "../../lib/capa/knowledge/capa-knowledge-contract";

import {
  CapaKnowledgeRepositoryError,
} from "../../lib/database/repositories/capa-knowledge-repository";

import {
  SupabaseCapaKnowledgeRepository,
} from "../../lib/database/supabase/supabase-capa-knowledge-repository";

import {
  SupabaseTransactionContextError,
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

import type {
  TransactionContext,
} from "../../lib/database/transactions";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as OrganizationId;
const SOURCE_ID =
  "20000000-0000-4000-8000-000000000002";
const VERSION_ID =
  "30000000-0000-4000-8000-000000000003";
const ARTIFACT_ID =
  "40000000-0000-4000-8000-000000000004";
const DERIVATIVE_ID =
  "50000000-0000-4000-8000-000000000005";
const PASSAGE_ID =
  "60000000-0000-4000-8000-000000000006";
const COLLECTION_ID =
  "70000000-0000-4000-8000-000000000007";
const COLLECTION_VERSION_ID =
  "80000000-0000-4000-8000-000000000008";
const NOW = "2026-08-24T14:00:00.000Z";
const HASH = "a".repeat(64);

interface SqlCall {
  readonly query: string;
  readonly values: readonly unknown[];
}

function trace(): RequestTrace {
  return {
    request_id:
      "90000000-0000-4000-8000-000000000009" as RequestId,
    correlation_id:
      "a0000000-0000-4000-8000-00000000000a" as CorrelationId,
  };
}

function row(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    source_id: SOURCE_ID,
    source_version_id: VERSION_ID,
    visibility: "organization",
    organization_id: ORGANIZATION_ID,
    current_source_version_id: VERSION_ID,
    owner_actor_type: "human",
    owner_actor_id: "owner-1",
    owner_actor_version: null,
    version_number: 1,
    source_type: "SRC-01",
    authority_class: "controlled",
    title: "Controlled source",
    issuer: "LVT",
    publisher: null,
    jurisdiction: "US",
    region: null,
    document_number: null,
    edition: null,
    language: "en",
    translation_status: "original",
    status: "unverified",
    publication_date: null,
    effective_at: null,
    retirement_at: null,
    supersedes_source_version_id: null,
    superseded_by_source_version_id: null,
    applicability_tags: ["CAPA"],
    origin: "uploaded",
    canonical_locator: "artifact://controlled-source",
    fingerprint_algorithm: "sha256",
    content_fingerprint: HASH,
    rights: {
      rights_classification: "owned",
      retention_policy: "controlled",
      legal_hold: false,
    },
    access_policy: {
      policy_version: "policy-1.0.0",
      permitted_role_ids: [],
      permitted_site_ids: [],
      permitted_product_ids: [],
      sensitivity: "internal",
      export_permitted: false,
      excerpt_permitted: true,
      redistribution_permitted: false,
    },
    onboarding_stage: "processed",
    processing_status: "pass",
    processing_version: "processing-1.0.0",
    quality_status: "pass",
    quality_notes: [],
    next_review_at: null,
    approved_at: null,
    approved_by_actor_type: null,
    approved_by_actor_id: null,
    approved_by_actor_version: null,
    activated_at: null,
    record_version: 1,
    created_at: NOW,
    created_by_actor_type: "human",
    created_by_actor_id: "owner-1",
    created_by_actor_version: null,
    updated_at: NOW,
    updated_by_actor_type: "human",
    updated_by_actor_id: "owner-1",
    updated_by_actor_version: null,
    ...overrides,
  };
}

function artifactRow() {
  return row({
    artifact_id: ARTIFACT_ID,
    media_type: "text/plain",
    byte_length: "12",
    storage_reference: "quarantine://artifact",
    quarantined: true,
    malware_scan_status: "pass",
  });
}

function derivativeRow() {
  return row({
    derivative_id: DERIVATIVE_ID,
    source_artifact_id: ARTIFACT_ID,
    derivative_kind: "normalized_text",
    engine: "lvt-normalizer",
    engine_version: "1.0.0",
    content: "controlled content",
    limitations: [],
  });
}

function passageRow(sequence = 1) {
  return row({
    passage_id: `${PASSAGE_ID.slice(0, -1)}${sequence}`,
    derivative_id: DERIVATIVE_ID,
    sequence_number: sequence,
    segmentation_version: "segmenter-1.0.0",
    content: `passage ${sequence}`,
    contextual_heading: null,
    locators: [{
      kind: "character_range",
      label: `characters ${sequence}`,
      start: 0,
      end: 8,
    }],
    overlap_passage_ids: [],
    quality_status: "pass",
    machine_interpretable: true,
  });
}

interface Harness {
  readonly sql: postgres.Sql;
  readonly calls: SqlCall[];
  enqueue(...responses: readonly unknown[]): void;
}

function harness(): Harness {
  const calls: SqlCall[] = [];
  const responses: unknown[] = [];

  const tagged = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({
      query: strings.join("?").replace(/\s+/g, " ").trim(),
      values,
    });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response ?? [];
  });

  const json = (value: unknown) => value;
  const transactionTagged = Object.assign(tagged, { json });
  const outer = Object.assign(tagged, {
    json,
    begin: vi.fn(async (
      _options: string,
      work: (sql: postgres.TransactionSql) => Promise<unknown>,
    ) => work(transactionTagged as unknown as postgres.TransactionSql)),
  });

  return {
    sql: outer as unknown as postgres.Sql,
    calls,
    enqueue(...values) {
      responses.push(...values);
    },
  };
}

async function inTransaction<Result>(
  test: Harness,
  work: (transaction: TransactionContext) => Promise<Result>,
): Promise<Result> {
  return new SupabaseTransactionManager(test.sql)
    .runInTransaction(trace(), work);
}

function source(): CapaKnowledgeSource {
  return {
    source_id: SOURCE_ID,
    visibility: "organization",
    organization_id: ORGANIZATION_ID,
    owner: { actor_type: "human", actor_id: "owner-1" },
    record_version: 1,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "owner-1" },
    updated_at: NOW,
    updated_by: { actor_type: "human", actor_id: "owner-1" },
  } as unknown as CapaKnowledgeSource;
}

function sourceVersion(): CapaKnowledgeSourceVersion {
  const value = row();
  return {
    ...value,
    content_fingerprint: { algorithm: "sha256", value: HASH },
    created_by: { actor_type: "human", actor_id: "owner-1" },
    updated_by: { actor_type: "human", actor_id: "owner-1" },
  } as unknown as CapaKnowledgeSourceVersion;
}

describe("Supabase CAPA knowledge repository", () => {
  it("reads an organization source without cross-tenant fallback", async () => {
    const test = harness();
    test.enqueue([row()]);
    const result = await new SupabaseCapaKnowledgeRepository(test.sql)
      .findSourceById(
        { visibility: "organization", organization_id: ORGANIZATION_ID },
        SOURCE_ID as never,
      );
    expect(result?.source_id).toBe(SOURCE_ID);
    expect(test.calls[0]?.query).toContain("organization_id = ?");
    expect(test.calls[0]?.values).toContain(ORGANIZATION_ID);
  });

  it("reads approved-global sources only through null organization scope", async () => {
    const test = harness();
    test.enqueue([row({ visibility: "approved_global", organization_id: null })]);
    await new SupabaseCapaKnowledgeRepository(test.sql)
      .findSourceById({ visibility: "approved_global" }, SOURCE_ID as never);
    expect(test.calls[0]?.query).toContain("organization_id is null");
  });

  it("returns null for an absent source", async () => {
    const test = harness();
    test.enqueue([]);
    await expect(new SupabaseCapaKnowledgeRepository(test.sql)
      .findSourceById({ visibility: "approved_global" }, SOURCE_ID as never))
      .resolves.toBeNull();
  });

  it("maps an exact source version and fingerprint lookup", async () => {
    const test = harness();
    test.enqueue([row()], [row()]);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    const lookup = {
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      source_id: SOURCE_ID,
      source_version_id: VERSION_ID,
    } as const;
    expect((await repository.findSourceVersionById(lookup as never))?.title)
      .toBe("Controlled source");
    expect((await repository.findSourceVersionByOriginalFingerprint({
      scope: lookup.scope,
      fingerprint: { algorithm: "sha256", value: HASH },
    } as never))?.content_fingerprint.value).toBe(HASH);
  });

  it("maps exact artifact and derivative reads", async () => {
    const test = harness();
    test.enqueue([artifactRow()], [derivativeRow()]);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    const base = {
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      source_id: SOURCE_ID,
      source_version_id: VERSION_ID,
    } as const;
    expect((await repository.findOriginalArtifactById({
      ...base,
      artifact_id: ARTIFACT_ID,
    } as never))?.byte_length).toBe(12);
    expect((await repository.findDerivativeById({
      ...base,
      derivative_id: DERIVATIVE_ID,
    } as never))?.kind).toBe("normalized_text");
  });

  it("returns a bounded passage page with continuation", async () => {
    const test = harness();
    test.enqueue([passageRow(1), passageRow(2)]);
    const result = await new SupabaseCapaKnowledgeRepository(test.sql)
      .listPassages({
        scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
        source_version_id: VERSION_ID,
        derivative_id: DERIVATIVE_ID,
        limit: 1,
      } as never);
    expect(result.passages).toHaveLength(1);
    expect(result.next_sequence_number).toBe(1);
  });

  it.each([0, 101, 1.5])("rejects invalid passage limit %s", async (limit) => {
    const test = harness();
    await expect(new SupabaseCapaKnowledgeRepository(test.sql)
      .listPassages({
        scope: { visibility: "approved_global" },
        source_version_id: VERSION_ID,
        derivative_id: DERIVATIVE_ID,
        limit,
      } as never)).rejects.toBeInstanceOf(CapaKnowledgeRepositoryError);
  });

  it("reads a passage and collection with exact source membership", async () => {
    const test = harness();
    test.enqueue(
      [passageRow()],
      [row({
        collection_id: COLLECTION_ID,
        collection_version_id: COLLECTION_VERSION_ID,
        purpose: "CAPA retrieval",
        audience: ["CAPA_OWNER"],
        effective_at: NOW,
        retired_at: null,
        approved_by: [{ actor_type: "human", actor_id: "approver-1" }],
      })],
      [{ source_version_id: VERSION_ID }],
    );
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    expect((await repository.findPassageById(
      { visibility: "organization", organization_id: ORGANIZATION_ID },
      PASSAGE_ID as never,
    ))?.content).toBe("passage 1");
    expect((await repository.findCollectionVersionById({
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      collection_id: COLLECTION_ID,
      collection_version_id: COLLECTION_VERSION_ID,
    } as never))?.source_version_ids).toEqual([VERSION_ID]);
  });

  it("requires an active Supabase transaction for material writes", async () => {
    const test = harness();
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    await expect(repository.insertSource({} as TransactionContext, source()))
      .rejects.toBeInstanceOf(SupabaseTransactionContextError);
  });

  it("inserts each governed material class in the active transaction", async () => {
    const test = harness();
    test.enqueue([], [], [], [], [], []);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    const artifact = {
      artifact_id: ARTIFACT_ID,
      source_version_id: VERSION_ID,
      organization_id: ORGANIZATION_ID,
      media_type: "text/plain",
      byte_length: 12,
      storage_reference: "quarantine://artifact",
      fingerprint: { algorithm: "sha256", value: HASH },
      quarantined: true,
      malware_scan_status: "pass",
      created_at: NOW,
    } as unknown as CapaKnowledgeOriginalArtifact;
    const derivative = {
      derivative_id: DERIVATIVE_ID,
      source_version_id: VERSION_ID,
      source_artifact_id: ARTIFACT_ID,
      organization_id: ORGANIZATION_ID,
      kind: "normalized_text",
      engine: "normalizer",
      engine_version: "1.0.0",
      content: "controlled",
      fingerprint: { algorithm: "sha256", value: HASH },
      status: "pass",
      limitations: [],
      created_at: NOW,
    } as unknown as CapaKnowledgeDerivative;
    const passage = {
      passage_id: PASSAGE_ID,
      source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID,
      organization_id: ORGANIZATION_ID,
      sequence_number: 1,
      segmentation_version: "1.0.0",
      content: "controlled",
      locators: [{ kind: "character_range", label: "characters 0-10" }],
      overlap_passage_ids: [],
      fingerprint: { algorithm: "sha256", value: HASH },
      quality_status: "pass",
      machine_interpretable: true,
      created_at: NOW,
    } as unknown as CapaKnowledgePassage;

    await inTransaction(test, async (transaction) => {
      await repository.insertSource(transaction, source());
      await repository.insertSourceVersion(transaction, sourceVersion());
      await repository.insertOriginalArtifact(transaction, artifact);
      await repository.insertDerivative(transaction, derivative);
      await repository.insertPassages(transaction, [passage]);
      await repository.insertCollectionVersion(transaction, {
        collection_id: COLLECTION_ID,
        collection_version_id: COLLECTION_VERSION_ID,
        organization_id: ORGANIZATION_ID,
        version_number: 1,
        purpose: "retrieval",
        audience: [],
        access_policy: {},
        source_version_ids: [],
        effective_at: NOW,
        approved_by: [{ actor_type: "human", actor_id: "approver-1" }],
        created_at: NOW,
      } as unknown as CapaKnowledgeCollectionVersion);
    });

    expect(test.calls.map((call) => call.query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("insert into public.capa_knowledge_sources"),
        expect.stringContaining("insert into public.capa_knowledge_source_versions"),
        expect.stringContaining("insert into public.capa_knowledge_original_artifacts"),
        expect.stringContaining("insert into public.capa_knowledge_derivatives"),
        expect.stringContaining("insert into public.capa_knowledge_passages"),
        expect.stringContaining("insert into public.capa_knowledge_collection_versions"),
      ]),
    );
  });

  it("reports lifecycle update success", async () => {
    const test = harness();
    test.enqueue([row({ status: "current_effective", record_version: 2 })]);
    const result = await inTransaction(test, (transaction) =>
      new SupabaseCapaKnowledgeRepository(test.sql)
        .advanceSourceVersionLifecycle(transaction, {
          scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
          source_id: SOURCE_ID,
          source_version_id: VERSION_ID,
          expected_record_version: 1,
          expected_status: "unverified",
          next_status: "current_effective",
          updated_at: "2026-08-24T15:00:00.000Z",
          updated_by_actor_type: "human",
          updated_by_actor_id: "approver-1",
        } as never));
    expect(result.status).toBe("updated");
  });

  it.each([
    [[], "SOURCE_NOT_FOUND_OR_NOT_AUTHORIZED"],
    [[{ record_version: 2, status: "unverified" }], "RECORD_VERSION_CONFLICT"],
    [[{ record_version: 1, status: "draft" }], "SOURCE_STATUS_CONFLICT"],
  ] as const)("reports a controlled lifecycle conflict", async (current, reason) => {
    const test = harness();
    test.enqueue([], current);
    const result = await inTransaction(test, (transaction) =>
      new SupabaseCapaKnowledgeRepository(test.sql)
        .advanceSourceVersionLifecycle(transaction, {
          scope: { visibility: "approved_global" },
          source_id: SOURCE_ID,
          source_version_id: VERSION_ID,
          expected_record_version: 1,
          expected_status: "unverified",
          next_status: "blocked",
          updated_at: "2026-08-24T15:00:00.000Z",
          updated_by_actor_type: "system",
          updated_by_actor_id: "knowledge-service",
        } as never));
    expect(result).toEqual({ status: "conflict", reason_code: reason });
  });
});
