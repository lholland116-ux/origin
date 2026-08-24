import { createHash } from "node:crypto";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  ControlledCode,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  ControlledVersion,
} from "../../lib/capa/ai/capa-prompt-contract";

import type {
  CapaKnowledgeArtifactId,
  CapaKnowledgeDerivative,
  CapaKnowledgeDerivativeId,
  CapaKnowledgeFingerprint,
  CapaKnowledgeIngestionId,
  CapaKnowledgeOriginalArtifact,
  CapaKnowledgePassage,
  CapaKnowledgePassageId,
  CapaKnowledgeSource,
  CapaKnowledgeSourceId,
  CapaKnowledgeSourceVersion,
  CapaKnowledgeSourceVersionId,
} from "../../lib/capa/knowledge/capa-knowledge-contract";

import {
  parseCapaDocx,
  parseCapaPdf,
  parseCapaXlsx,
} from "../../lib/capa/knowledge/capa-knowledge-extractor-adapters";

import {
  normalizeCapaKnowledgeText,
} from "../../lib/capa/knowledge/capa-knowledge-processing";

import {
  segmentCapaKnowledgeText,
} from "../../lib/capa/knowledge/capa-knowledge-segmentation";

import {
  validateCapaKnowledgeRegistration,
} from "../../lib/capa/knowledge/capa-knowledge-validator";

import {
  createCapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";

import {
  InMemoryCapaKnowledgeConflictError,
  InMemoryCapaKnowledgeDatabase,
  InMemoryCapaKnowledgeIntegrityError,
  InMemoryCapaKnowledgeTransactionError,
} from "../../lib/database/in-memory/in-memory-capa-knowledge-database";

import {
  CapaKnowledgeRepositoryError,
} from "../../lib/database/repositories/capa-knowledge-repository";

import {
  SupabaseCapaKnowledgeRepository,
} from "../../lib/database/supabase/supabase-capa-knowledge-repository";

import {
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

import type {
  TransactionContext,
  TransactionId,
} from "../../lib/database/transactions";

const parserMocks = vi.hoisted(() => ({
  pdfGetText: vi.fn(),
  pdfDestroy: vi.fn(),
  docx: vi.fn(),
  xlsxLoad: vi.fn(),
  eachSheet: vi.fn(),
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = parserMocks.pdfGetText;
    destroy = parserMocks.pdfDestroy;
  },
}));

vi.mock("mammoth", () => ({
  default: {
    extractRawText: parserMocks.docx,
  },
}));

vi.mock("exceljs", () => ({
  default: {
    Workbook: class {
      xlsx = { load: parserMocks.xlsxLoad };
      eachSheet = parserMocks.eachSheet;
    },
  },
}));

const NOW =
  "2026-08-24T15:00:00.000Z" as IsoDateTime;
const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as OrganizationId;
const SOURCE_ID =
  "86f41520-3527-47ad-9c67-4a1799a55bc4" as CapaKnowledgeSourceId;
const VERSION_ID =
  "1c96db2c-0ab8-47d4-8c19-e198c14991ca" as CapaKnowledgeSourceVersionId;
const ARTIFACT_ID =
  "4a649119-3779-474f-8392-82f99c80aa02" as CapaKnowledgeArtifactId;
const DERIVATIVE_ID =
  "4a649119-3779-474f-8392-82f99c80aa03" as CapaKnowledgeDerivativeId;
const PASSAGE_ID =
  "4a649119-3779-474f-8392-820000000001" as CapaKnowledgePassageId;
const HASH = "a".repeat(64) as CapaKnowledgeFingerprint;
const TRACE = {
  request_id: "request-coverage" as RequestId,
  correlation_id: "correlation-coverage" as CorrelationId,
} satisfies RequestTrace;

const ACTOR = {
  actor_type: "human" as const,
  actor_id: "knowledge-owner",
};

function source(
  overrides: Readonly<Record<string, unknown>> = {},
): CapaKnowledgeSource {
  return {
    source_id: SOURCE_ID,
    visibility: "organization",
    organization_id: ORGANIZATION_ID,
    owner: ACTOR,
    created_at: NOW,
    created_by: ACTOR,
    ...overrides,
  } as unknown as CapaKnowledgeSource;
}

function version(
  overrides: Readonly<Record<string, unknown>> = {},
): CapaKnowledgeSourceVersion {
  return {
    source_version_id: VERSION_ID,
    source_id: SOURCE_ID,
    organization_id: ORGANIZATION_ID,
    version_number: 1,
    source_type: "SRC-01",
    authority_class: "CONTROLLED" as ControlledCode,
    title: "Controlled Procedure",
    issuer: "LVTChat LLC",
    jurisdiction: "US",
    language: "en",
    translation_status: "ORIGINAL" as ControlledCode,
    status: "unverified",
    applicability_tags: [],
    origin: "INTERNAL" as ControlledCode,
    canonical_locator: "lvt://procedure/coverage",
    content_fingerprint: { algorithm: "sha256", value: HASH },
    rights: {
      rights_classification: "OWNED" as ControlledCode,
      retention_policy: "QUALITY_RECORD" as ControlledCode,
      legal_hold: false,
    },
    access_policy: {
      policy_version: "policy-1.0.0" as ControlledVersion,
      permitted_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      sensitivity: "INTERNAL" as ControlledCode,
      export_permitted: false,
      excerpt_permitted: true,
      redistribution_permitted: false,
    },
    onboarding_stage: "processed",
    processing_status: "pass",
    processing_version: "processing-1.0.0" as ControlledVersion,
    quality_status: "pass",
    quality_notes: [],
    created_at: NOW,
    created_by: ACTOR,
    ...overrides,
  } as unknown as CapaKnowledgeSourceVersion;
}

function artifact(
  overrides: Readonly<Record<string, unknown>> = {},
): CapaKnowledgeOriginalArtifact {
  return {
    artifact_id: ARTIFACT_ID,
    source_version_id: VERSION_ID,
    organization_id: ORGANIZATION_ID,
    media_type: "text/plain",
    byte_length: 10,
    storage_reference: "quarantine://coverage",
    fingerprint: { algorithm: "sha256", value: HASH },
    quarantined: true,
    malware_scan_status: "CLEAN" as ControlledCode,
    created_at: NOW,
    ...overrides,
  } as unknown as CapaKnowledgeOriginalArtifact;
}

function derivative(
  overrides: Readonly<Record<string, unknown>> = {},
): CapaKnowledgeDerivative {
  return {
    derivative_id: DERIVATIVE_ID,
    source_version_id: VERSION_ID,
    source_artifact_id: ARTIFACT_ID,
    organization_id: ORGANIZATION_ID,
    kind: "normalized_text",
    engine: "NORMALIZER" as ControlledCode,
    engine_version: "1.0.0" as ControlledVersion,
    content: "controlled",
    fingerprint: { algorithm: "sha256", value: HASH },
    status: "pass",
    limitations: [],
    created_at: NOW,
    ...overrides,
  } as unknown as CapaKnowledgeDerivative;
}

function passage(
  overrides: Readonly<Record<string, unknown>> = {},
): CapaKnowledgePassage {
  return {
    passage_id: PASSAGE_ID,
    source_version_id: VERSION_ID,
    derivative_id: DERIVATIVE_ID,
    organization_id: ORGANIZATION_ID,
    sequence_number: 1,
    segmentation_version: "1.0.0" as ControlledVersion,
    content: "controlled",
    locators: [{ kind: "character_range", label: "char:0-10" }],
    overlap_passage_ids: [],
    fingerprint: { algorithm: "sha256", value: HASH },
    quality_status: "pass",
    machine_interpretable: true,
    created_at: NOW,
    ...overrides,
  } as unknown as CapaKnowledgePassage;
}

function memory(
  overrides: {
    generate_transaction_id?: () => TransactionId;
    now?: () => Date;
  } = {},
) {
  let sequence = 0;
  return new InMemoryCapaKnowledgeDatabase({
    generate_transaction_id:
      overrides.generate_transaction_id ?? (() => {
        sequence += 1;
        return `transaction-${sequence}` as TransactionId;
      }),
    now: overrides.now ?? (() => new Date(NOW)),
  });
}

async function seed(
  database: InMemoryCapaKnowledgeDatabase,
  work?: (transaction: TransactionContext) => Promise<void>,
) {
  return database.runInTransaction(TRACE, async (transaction) => {
    await database.insertSource(transaction, source());
    await database.insertSourceVersion(transaction, version());
    if (work !== undefined) await work(transaction);
  });
}

describe("CAPA knowledge concrete parser coverage", () => {
  it("executes and destroys the controlled PDF parser", async () => {
    parserMocks.pdfGetText.mockResolvedValueOnce({
      pages: [{ text: "Page one" }, { text: "Page two" }],
    });
    parserMocks.pdfDestroy.mockResolvedValueOnce(undefined);
    await expect(parseCapaPdf(new Uint8Array([1])))
      .resolves.toEqual({ pages: [{ text: "Page one" }, { text: "Page two" }] });
    expect(parserMocks.pdfDestroy).toHaveBeenCalled();
  });

  it("destroys the controlled PDF parser after failure", async () => {
    parserMocks.pdfGetText.mockRejectedValueOnce(new Error("invalid PDF"));
    parserMocks.pdfDestroy.mockResolvedValueOnce(undefined);
    await expect(parseCapaPdf(new Uint8Array([2])))
      .rejects.toThrow("invalid PDF");
    expect(parserMocks.pdfDestroy).toHaveBeenCalled();
  });

  it("maps concrete DOCX parser messages", async () => {
    parserMocks.docx.mockResolvedValueOnce({
      value: "Document body",
      messages: [{ type: "warning", message: "image omitted" }],
    });
    await expect(parseCapaDocx(new Uint8Array([3]))).resolves.toEqual({
      text: "Document body",
      warnings: ["WARNING: image omitted"],
    });
  });

  it("maps concrete XLSX cells and sheets", async () => {
    parserMocks.xlsxLoad.mockResolvedValueOnce(undefined);
    parserMocks.eachSheet.mockImplementationOnce((visit: (worksheet: {
      readonly name: string;
      eachRow(
        options: unknown,
        callback: (row: {
          eachCell(
            cellOptions: unknown,
            cellCallback: (cell: { readonly text: string }) => void,
          ): void;
        }) => void,
      ): void;
    }) => void) => {
      visit({
        name: "Risk Register",
        eachRow(_options: unknown, visitRow) {
          visitRow({
            eachCell(_cellOptions: unknown, visitCell) {
              visitCell({ text: "Risk" });
              visitCell({ text: "Control" });
            },
          });
        },
      });
    });
    await expect(parseCapaXlsx(new Uint8Array([4]))).resolves.toEqual([
      { name: "Risk Register", text: "Risk\tControl" },
    ]);
  });
});

describe("CAPA knowledge validation branch coverage", () => {
  it.each([
    { superseded_by_source_version_id: "not-a-uuid" },
    {
      supersedes_source_version_id:
        "779594ce-cb78-4818-a173-4c1e8217637f",
      superseded_by_source_version_id:
        "779594ce-cb78-4818-a173-4c1e8217637f",
    },
    { onboarding_stage: "active", approved_at: undefined, approved_by: undefined },
  ])("rejects defensive registration case %#", (override) => {
    expect(() => validateCapaKnowledgeRegistration(
      source(),
      version(override),
    )).toThrow();
  });

  it("rejects a malformed actor reference", () => {
    expect(() => validateCapaKnowledgeRegistration(
      source({ created_by: null }),
      version(),
    )).toThrowError(expect.objectContaining({
      reason_code: "INVALID_ACTOR_REFERENCE",
    }));
  });

  it("accepts a fully controlled current-effective source", () => {
    expect(() => validateCapaKnowledgeRegistration(
      source(),
      version({
        status: "current_effective",
        onboarding_stage: "active",
        effective_at: NOW,
        approved_at: NOW,
        approved_by: ACTOR,
        activated_at: NOW,
      }),
    )).not.toThrow();

    expect(() => validateCapaKnowledgeRegistration(
      source(),
      version({
        status: "current_effective",
        onboarding_stage: "active",
        effective_at: NOW,
        approved_at: NOW,
        approved_by: ACTOR,
        activated_at: NOW,
        processing_status: "pass_with_limitations",
        quality_status: "pass_with_limitations",
      }),
    )).not.toThrow();
  });

  it("rejects a normalized fingerprint without a digest", () => {
    const normalized = normalizeCapaKnowledgeText("controlled");
    expect(() => segmentCapaKnowledgeText(
      VERSION_ID,
      { ...normalized, fingerprint: { algorithm: "sha256" } } as never,
    )).toThrowError(expect.objectContaining({
      reason_code: "INVALID_NORMALIZED_TEXT",
    }));
  });
});

describe("in-memory CAPA knowledge defensive coverage", () => {
  it("supports approved-global records and fail-closed mismatched reads", async () => {
    const database = memory();
    const globalSource = source({
      visibility: "approved_global",
      organization_id: undefined,
    });
    const globalVersion = version({ organization_id: undefined });
    const globalArtifact = artifact({ organization_id: undefined });
    const globalDerivative = derivative({ organization_id: undefined });
    const globalPassage = passage({ organization_id: undefined });
    const collectionId =
      "4a649119-3779-474f-8392-820000000010";
    const collectionVersionId =
      "4a649119-3779-474f-8392-820000000011";

    await database.runInTransaction(TRACE, async (transaction) => {
      await database.insertSource(transaction, globalSource);
      await database.insertSourceVersion(transaction, globalVersion);
      await database.insertOriginalArtifact(transaction, globalArtifact);
      await database.insertDerivative(transaction, globalDerivative);
      await database.insertPassages(transaction, [globalPassage]);
      await database.insertCollectionVersion(transaction, {
        collection_id: collectionId,
        collection_version_id: collectionVersionId,
        version_number: 1,
        purpose: "global coverage",
        audience: [],
        access_policy: version().access_policy,
        source_version_ids: [VERSION_ID],
        effective_at: NOW,
        approved_by: [ACTOR],
        created_at: NOW,
      } as never);
    });

    const globalScope = { visibility: "approved_global" } as const;
    const organizationScope = {
      visibility: "organization" as const,
      organization_id: ORGANIZATION_ID,
    };
    expect(await database.findSourceById(globalScope, SOURCE_ID)).not.toBeNull();
    expect(await database.findSourceById(organizationScope, SOURCE_ID)).toBeNull();
    expect(await database.findSourceVersionById({
      scope: globalScope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
    })).not.toBeNull();
    expect(await database.findSourceVersionById({
      scope: globalScope,
      source_id: "f13a4b09-c354-4ad8-8428-d083c45dfcc3" as CapaKnowledgeSourceId,
      source_version_id: VERSION_ID,
    })).toBeNull();
    expect(await database.findSourceVersionByOriginalFingerprint({
      scope: globalScope,
      fingerprint: globalVersion.content_fingerprint,
    })).not.toBeNull();
    expect(await database.findSourceVersionByOriginalFingerprint({
      scope: globalScope,
      fingerprint: { algorithm: "sha256", value: "c".repeat(64) as CapaKnowledgeFingerprint },
    })).toBeNull();
    expect(await database.findOriginalArtifactById({
      scope: globalScope, source_id: SOURCE_ID,
      source_version_id: VERSION_ID, artifact_id: ARTIFACT_ID,
    })).not.toBeNull();
    expect(await database.findOriginalArtifactById({
      scope: globalScope, source_id: SOURCE_ID,
      source_version_id: "f72a76fd-9df0-4761-a420-a46d0a5e48a6" as CapaKnowledgeSourceVersionId,
      artifact_id: ARTIFACT_ID,
    })).toBeNull();
    expect(await database.findDerivativeById({
      scope: globalScope, source_id: SOURCE_ID,
      source_version_id: VERSION_ID, derivative_id: DERIVATIVE_ID,
    })).not.toBeNull();
    expect(await database.findDerivativeById({
      scope: organizationScope, source_id: SOURCE_ID,
      source_version_id: VERSION_ID, derivative_id: DERIVATIVE_ID,
    })).toBeNull();
    expect((await database.listPassages({
      scope: globalScope, source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID, after_sequence_number: 0, limit: 100,
    })).next_sequence_number).toBeUndefined();
    expect(await database.findPassageById(globalScope, PASSAGE_ID)).not.toBeNull();
    expect(await database.findPassageById(organizationScope, PASSAGE_ID)).toBeNull();
    expect(await database.findCollectionVersionById({
      scope: globalScope,
      collection_id: collectionId as never,
      collection_version_id: collectionVersionId as never,
    })).not.toBeNull();
    expect(await database.findCollectionVersionById({
      scope: globalScope,
      collection_id: "86fc58bf-6a1d-4611-a498-74400a39392c" as never,
      collection_version_id: collectionVersionId as never,
    })).toBeNull();
  });

  it("supports all exact reads, pagination and lifecycle outcomes", async () => {
    const database = memory();
    await seed(database, async (transaction) => {
      await database.insertOriginalArtifact(transaction, artifact());
      await database.insertDerivative(transaction, derivative());
      await database.insertPassages(transaction, [
        passage(),
        passage({
          passage_id: "4a649119-3779-474f-8392-820000000002",
          sequence_number: 2,
          fingerprint: { algorithm: "sha256", value: "b".repeat(64) },
        }),
      ]);
      await database.insertCollectionVersion(transaction, {
        collection_id: "4a649119-3779-474f-8392-820000000010",
        collection_version_id: "4a649119-3779-474f-8392-820000000011",
        organization_id: ORGANIZATION_ID,
        version_number: 1,
        purpose: "coverage",
        audience: [],
        access_policy: version().access_policy,
        source_version_ids: [VERSION_ID],
        effective_at: NOW,
        approved_by: [ACTOR],
        created_at: NOW,
      } as never);
    });

    expect(await database.findSourceVersionByOriginalFingerprint({
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      fingerprint: version().content_fingerprint,
    })).not.toBeNull();
    expect(await database.findOriginalArtifactById({
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      source_id: SOURCE_ID,
      source_version_id: VERSION_ID,
      artifact_id: ARTIFACT_ID,
    })).not.toBeNull();
    expect(await database.findDerivativeById({
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      source_id: SOURCE_ID,
      source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID,
    })).not.toBeNull();
    expect((await database.listPassages({
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID,
      limit: 1,
    })).next_sequence_number).toBe(1);
    expect(await database.findPassageById(
      { visibility: "organization", organization_id: ORGANIZATION_ID },
      PASSAGE_ID,
    )).not.toBeNull();
    expect(await database.findCollectionVersionById({
      scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
      collection_id: "4a649119-3779-474f-8392-820000000010" as never,
      collection_version_id: "4a649119-3779-474f-8392-820000000011" as never,
    })).not.toBeNull();

    const conflict = await database.runInTransaction(TRACE, (transaction) =>
      database.advanceSourceVersionLifecycle(transaction, {
        scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
        expected_record_version: 2,
        expected_status: "unverified",
        next_status: "blocked",
        updated_at: NOW,
        updated_by_actor_type: "human",
        updated_by_actor_id: "owner",
      }));
    expect(conflict).toEqual({
      status: "conflict",
      reason_code: "RECORD_VERSION_CONFLICT",
    });

    const statusConflict = await database.runInTransaction(TRACE, (transaction) =>
      database.advanceSourceVersionLifecycle(transaction, {
        scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
        expected_record_version: 1,
        expected_status: "draft",
        next_status: "blocked",
        updated_at: NOW,
        updated_by_actor_type: "human",
        updated_by_actor_id: "owner",
      }));
    expect(statusConflict).toEqual({
      status: "conflict",
      reason_code: "SOURCE_STATUS_CONFLICT",
    });

    const updated = await database.runInTransaction(TRACE, (transaction) =>
      database.advanceSourceVersionLifecycle(transaction, {
        scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
        expected_record_version: 1,
        expected_status: "unverified",
        next_status: "blocked",
        updated_at: NOW,
        updated_by_actor_type: "human",
        updated_by_actor_id: "owner",
      }));
    expect(updated.status).toBe("updated");
  });

  it("rejects invalid queries and inactive transactions", async () => {
    const database = memory();
    await expect(database.listPassages({ limit: 0 } as never))
      .rejects.toBeInstanceOf(InMemoryCapaKnowledgeIntegrityError);
    await expect(database.insertSource({} as TransactionContext, source()))
      .rejects.toBeInstanceOf(InMemoryCapaKnowledgeTransactionError);
  });

  it.each([
    { limit: 101 },
    { limit: 1.5 },
    { limit: 1, after_sequence_number: -1 },
    { limit: 1, after_sequence_number: 1.5 },
  ])("rejects malformed passage query %#", async (query) => {
    await expect(memory().listPassages(query as never))
      .rejects.toBeInstanceOf(InMemoryCapaKnowledgeIntegrityError);
  });

  it("returns a minimized conflict for a missing lifecycle target", async () => {
    const database = memory();
    const result = await database.runInTransaction(TRACE, (transaction) =>
      database.advanceSourceVersionLifecycle(transaction, {
        scope: { visibility: "organization", organization_id: ORGANIZATION_ID },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
        expected_record_version: 1,
        expected_status: "unverified",
        next_status: "blocked",
        updated_at: NOW,
        updated_by_actor_type: "human",
        updated_by_actor_id: "owner",
      }));
    expect(result).toEqual({
      status: "conflict",
      reason_code: "SOURCE_NOT_FOUND_OR_NOT_AUTHORIZED",
    });
  });

  it("rejects duplicate fingerprints within one governed scope", async () => {
    const database = memory();
    const secondSourceId =
      "d50dd1dc-5511-479f-8e9b-abbe5750f516" as CapaKnowledgeSourceId;
    const secondVersionId =
      "820a8d5f-73ee-47bf-b1f0-c0094c560ec8" as CapaKnowledgeSourceVersionId;

    await expect(database.runInTransaction(TRACE, async (transaction) => {
      await database.insertSource(transaction, source());
      await database.insertSourceVersion(transaction, version());
      await database.insertSource(transaction, source({ source_id: secondSourceId }));
      await database.insertSourceVersion(transaction, version({
        source_id: secondSourceId,
        source_version_id: secondVersionId,
      }));
    })).rejects.toBeInstanceOf(InMemoryCapaKnowledgeIntegrityError);
  });

  it("rejects duplicate passage sequence positions", async () => {
    const database = memory();
    await expect(seed(database, async (transaction) => {
      await database.insertOriginalArtifact(transaction, artifact());
      await database.insertDerivative(transaction, derivative());
      await database.insertPassages(transaction, [
        passage(),
        passage({
          passage_id: "c6a48fe4-4d70-4369-9317-eb86470c902d",
          fingerprint: { algorithm: "sha256", value: "b".repeat(64) },
        }),
      ]);
    })).rejects.toBeInstanceOf(InMemoryCapaKnowledgeIntegrityError);
  });

  it("rejects an invalid clock and duplicate active transaction identity", async () => {
    await expect(memory({ now: () => new Date("invalid") })
      .runInTransaction(TRACE, async () => undefined))
      .rejects.toBeInstanceOf(InMemoryCapaKnowledgeTransactionError);

    const database = memory({
      generate_transaction_id: () => "same" as TransactionId,
    });
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = database.runInTransaction(TRACE, async () => blocked);
    await expect(database.runInTransaction(TRACE, async () => undefined))
      .rejects.toBeInstanceOf(InMemoryCapaKnowledgeTransactionError);
    release();
    await first;
  });

  it("detects concurrent commit conflicts", async () => {
    const database = memory();
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = database.runInTransaction(TRACE, async () => blocked);
    await database.runInTransaction(TRACE, async () => undefined);
    release();
    await expect(first).rejects.toBeInstanceOf(
      InMemoryCapaKnowledgeConflictError,
    );
  });

  it("permits exact idempotent inserts and rejects conflicting identities", async () => {
    const database = memory();
    await database.runInTransaction(TRACE, async (transaction) => {
      await database.insertSource(transaction, source());
      await database.insertSource(transaction, source());
    });
    await expect(database.runInTransaction(TRACE, async (transaction) => {
      await database.insertSource(transaction, source({ owner: {
        actor_type: "human",
        actor_id: "other-owner",
      } }));
    })).rejects.toBeInstanceOf(InMemoryCapaKnowledgeIntegrityError);
  });

  it.each([
    async (database: InMemoryCapaKnowledgeDatabase, transaction: TransactionContext) => {
      await database.insertSource(transaction, source({
        current_source_version_id: VERSION_ID,
      }));
    },
    async (database: InMemoryCapaKnowledgeDatabase, transaction: TransactionContext) => {
      await database.insertSourceVersion(transaction, version());
    },
    async (database: InMemoryCapaKnowledgeDatabase, transaction: TransactionContext) => {
      await database.insertOriginalArtifact(transaction, artifact());
    },
    async (database: InMemoryCapaKnowledgeDatabase, transaction: TransactionContext) => {
      await database.insertDerivative(transaction, derivative());
    },
    async (database: InMemoryCapaKnowledgeDatabase, transaction: TransactionContext) => {
      await database.insertPassages(transaction, [passage()]);
    },
  ])("rejects incomplete committed knowledge graph %#", async (write) => {
    const database = memory();
    await expect(database.runInTransaction(TRACE, (transaction) =>
      write(database, transaction)))
      .rejects.toBeInstanceOf(InMemoryCapaKnowledgeIntegrityError);
  });

  it("exercises the development runtime knowledge transaction generator", async () => {
    const runtime = createCapaDevelopmentRuntime({
      environment: "test",
      now: () => new Date(NOW),
      generate_uuid: () => "00000000-0000-4000-8000-000000000001",
    });
    await (runtime.knowledge_repository as InMemoryCapaKnowledgeDatabase)
      .runInTransaction(TRACE, async () => undefined);
  });
});

interface SqlHarness {
  readonly sql: postgres.Sql;
  enqueue(...responses: readonly unknown[]): void;
}

function sqlHarness(): SqlHarness {
  const responses: unknown[] = [];
  const tagged = vi.fn(async () => responses.shift() ?? []);
  const transactionTagged = Object.assign(tagged, {
    json: (value: unknown) => value,
  });
  const outer = Object.assign(tagged, {
    json: (value: unknown) => value,
    begin: vi.fn(async (
      _options: unknown,
      work: (sql: postgres.TransactionSql) => Promise<unknown>,
    ) =>
      work(transactionTagged as unknown as postgres.TransactionSql)),
  });
  return {
    sql: outer as unknown as postgres.Sql,
    enqueue(...values) { responses.push(...values); },
  };
}

function databaseRow(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    source_id: SOURCE_ID,
    source_version_id: VERSION_ID,
    visibility: "approved_global",
    organization_id: null,
    current_source_version_id: null,
    owner_actor_type: "human",
    owner_actor_id: "owner",
    owner_actor_version: "1.0.0",
    version_number: 1,
    source_type: "SRC-01",
    authority_class: "controlled",
    title: "source",
    issuer: "LVT",
    publisher: "LVT",
    jurisdiction: "US",
    region: "GA",
    document_number: "DOC-1",
    edition: "1",
    language: "en",
    translation_status: "original",
    status: "unverified",
    publication_date: "2026-08-01",
    effective_at: NOW,
    retirement_at: "2027-08-24T15:00:00.000Z",
    supersedes_source_version_id: null,
    superseded_by_source_version_id: null,
    applicability_tags: [],
    origin: "uploaded",
    canonical_locator: "source://1",
    fingerprint_algorithm: "sha256",
    content_fingerprint: HASH,
    rights: {},
    access_policy: {},
    onboarding_stage: "processed",
    processing_status: "pass",
    processing_version: "1.0.0",
    quality_status: "pass",
    quality_notes: [],
    next_review_at: NOW,
    approved_at: NOW,
    approved_by_actor_type: "human",
    approved_by_actor_id: "approver",
    approved_by_actor_version: "1.0.0",
    activated_at: NOW,
    record_version: 1,
    created_at: new Date(NOW),
    created_by_actor_type: "human",
    created_by_actor_id: "creator",
    created_by_actor_version: "1.0.0",
    updated_at: NOW,
    updated_by_actor_type: "system",
    updated_by_actor_id: "system",
    updated_by_actor_version: "1.0.0",
    ...overrides,
  };
}

async function sqlTransaction<Result>(
  test: SqlHarness,
  work: (transaction: TransactionContext) => Promise<Result>,
) {
  return new SupabaseTransactionManager(test.sql)
    .runInTransaction(TRACE, work);
}

describe("Supabase CAPA knowledge defensive coverage", () => {
  it("returns an approved-global material collection", async () => {
    const test = sqlHarness();
    test.enqueue(
      [databaseRow({
        organization_id: null,
        collection_id: "4a649119-3779-474f-8392-820000000010",
        collection_version_id: "4a649119-3779-474f-8392-820000000011",
        purpose: "global coverage",
        audience: [],
        retired_at: null,
        approved_by: [ACTOR],
      })],
      [{ source_version_id: VERSION_ID }],
    );
    const result = await new SupabaseCapaKnowledgeRepository(test.sql)
      .findCollectionVersionById({
        scope: { visibility: "approved_global" },
        collection_id:
          "4a649119-3779-474f-8392-820000000010" as never,
        collection_version_id:
          "4a649119-3779-474f-8392-820000000011" as never,
      });
    expect(result).toMatchObject({
      source_version_ids: [VERSION_ID],
    });
  });

  it("returns null for organization-scoped missing material records", async () => {
    const test = sqlHarness();
    test.enqueue([], [], [], [], []);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    const scope = {
      visibility: "organization" as const,
      organization_id: ORGANIZATION_ID,
    };
    expect(await repository.findSourceVersionById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
    })).toBeNull();
    expect(await repository.findSourceVersionByOriginalFingerprint({
      scope, fingerprint: { algorithm: "sha256", value: HASH },
    })).toBeNull();
    expect(await repository.findOriginalArtifactById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
      artifact_id: ARTIFACT_ID,
    })).toBeNull();
    expect(await repository.findDerivativeById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID,
    })).toBeNull();
    expect(await repository.findCollectionVersionById({
      scope,
      collection_id: "4a649119-3779-474f-8392-820000000010" as never,
      collection_version_id: "4a649119-3779-474f-8392-820000000011" as never,
    })).toBeNull();
  });

  it("covers organization-scoped reads and a material collection", async () => {
    const test = sqlHarness();
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    const organizationRow = databaseRow({ organization_id: ORGANIZATION_ID });
    const passageRow = databaseRow({
      organization_id: ORGANIZATION_ID,
      passage_id: PASSAGE_ID,
      derivative_id: DERIVATIVE_ID,
      sequence_number: 1,
      segmentation_version: "1.0.0",
      content: "controlled",
      contextual_heading: "Heading",
      locators: [],
      overlap_passage_ids: [],
      machine_interpretable: true,
    });
    const collectionRow = databaseRow({
      organization_id: ORGANIZATION_ID,
      collection_id: "4a649119-3779-474f-8392-820000000010",
      collection_version_id: "4a649119-3779-474f-8392-820000000011",
      purpose: "coverage",
      audience: [],
      retired_at: "2027-08-24T15:00:00.000Z",
      approved_by: [ACTOR],
    });
    test.enqueue(
      [organizationRow],
      [organizationRow],
      [organizationRow],
      [databaseRow({
        organization_id: ORGANIZATION_ID,
        artifact_id: ARTIFACT_ID,
        media_type: "text/plain",
        byte_length: 1,
        storage_reference: "q://1",
        quarantined: true,
        malware_scan_status: "pass",
      })],
      [databaseRow({
        organization_id: ORGANIZATION_ID,
        derivative_id: DERIVATIVE_ID,
        source_artifact_id: ARTIFACT_ID,
        derivative_kind: "normalized_text",
        engine: "engine",
        engine_version: "1",
        content: "text",
        limitations: [],
      })],
      [passageRow],
      [passageRow],
      [collectionRow],
      [{ source_version_id: VERSION_ID }],
    );
    const scope = {
      visibility: "organization" as const,
      organization_id: ORGANIZATION_ID,
    };
    expect(await repository.findSourceById(scope, SOURCE_ID)).not.toBeNull();
    expect(await repository.findSourceVersionById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
    })).not.toBeNull();
    expect(await repository.findSourceVersionByOriginalFingerprint({
      scope, fingerprint: { algorithm: "sha256", value: HASH },
    })).not.toBeNull();
    expect(await repository.findOriginalArtifactById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
      artifact_id: ARTIFACT_ID,
    })).not.toBeNull();
    expect(await repository.findDerivativeById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID,
    })).not.toBeNull();
    expect((await repository.listPassages({
      scope, source_version_id: VERSION_ID, derivative_id: DERIVATIVE_ID,
      limit: 1,
    })).passages).toHaveLength(1);
    expect(await repository.findPassageById(scope, PASSAGE_ID)).not.toBeNull();
    expect(await repository.findCollectionVersionById({
      scope,
      collection_id: "4a649119-3779-474f-8392-820000000010" as never,
      collection_version_id: "4a649119-3779-474f-8392-820000000011" as never,
    })).toMatchObject({ retired_at: "2027-08-24T15:00:00.000Z" });
  });

  it("covers approved-global reads and empty results", async () => {
    const test = sqlHarness();
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    test.enqueue(
      [databaseRow()],
      [databaseRow()],
      [databaseRow({ artifact_id: ARTIFACT_ID, media_type: "text/plain",
        byte_length: 1, storage_reference: "q://1", quarantined: true,
        malware_scan_status: "pass" })],
      [databaseRow({ derivative_id: DERIVATIVE_ID,
        source_artifact_id: ARTIFACT_ID, derivative_kind: "normalized_text",
        engine: "engine", engine_version: "1", content: "text",
        limitations: [] })],
      [],
      [],
      [],
    );
    const scope = { visibility: "approved_global" } as const;
    expect(await repository.findSourceVersionById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
    })).not.toBeNull();
    expect(await repository.findSourceVersionByOriginalFingerprint({
      scope, fingerprint: { algorithm: "sha256", value: HASH },
    })).not.toBeNull();
    expect(await repository.findOriginalArtifactById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
      artifact_id: ARTIFACT_ID,
    })).not.toBeNull();
    expect(await repository.findDerivativeById({
      scope, source_id: SOURCE_ID, source_version_id: VERSION_ID,
      derivative_id: DERIVATIVE_ID,
    })).not.toBeNull();
    expect((await repository.listPassages({
      scope, source_version_id: VERSION_ID, derivative_id: DERIVATIVE_ID,
      after_sequence_number: 1, limit: 1,
    })).passages).toEqual([]);
    expect(await repository.findPassageById(scope, PASSAGE_ID)).toBeNull();
    expect(await repository.findCollectionVersionById({
      scope,
      collection_id: "4a649119-3779-474f-8392-820000000010",
      collection_version_id: "4a649119-3779-474f-8392-820000000011",
    } as never)).toBeNull();
  });

  it.each([
    { created_at: "invalid" },
    { version_number: -1 },
    { rights: [] },
    { quality_notes: {} },
    { created_by_actor_type: "invalid" },
  ])("rejects malformed database row %#", async (override) => {
    const test = sqlHarness();
    test.enqueue([databaseRow(override)]);
    await expect(new SupabaseCapaKnowledgeRepository(test.sql)
      .findSourceVersionById({
        scope: { visibility: "approved_global" },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
      })).rejects.toBeInstanceOf(CapaKnowledgeRepositoryError);
  });

  it("inserts collection membership and rejects multiple update rows", async () => {
    const test = sqlHarness();
    test.enqueue([], [], [databaseRow(), databaseRow()]);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    await sqlTransaction(test, async (transaction) => {
      await repository.insertCollectionVersion(transaction, {
        collection_id: "4a649119-3779-474f-8392-820000000010",
        collection_version_id: "4a649119-3779-474f-8392-820000000011",
        version_number: 1,
        purpose: "coverage",
        audience: [],
        access_policy: version().access_policy,
        source_version_ids: [VERSION_ID],
        effective_at: NOW,
        approved_by: [ACTOR],
        created_at: NOW,
      } as never);
      await expect(repository.advanceSourceVersionLifecycle(transaction, {
        scope: { visibility: "approved_global" },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
        expected_record_version: 1,
        expected_status: "unverified",
        next_status: "blocked",
        updated_at: NOW,
        updated_by_actor_type: "system",
        updated_by_actor_id: "system",
      })).rejects.toBeInstanceOf(CapaKnowledgeRepositoryError);
    });
  });

  it("writes every governed material record with populated optional metadata", async () => {
    const test = sqlHarness();
    test.enqueue([], [], [], [], [], [], [], []);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    await sqlTransaction(test, async (transaction) => {
      await repository.insertSource(transaction, source({
        current_source_version_id: VERSION_ID,
        owner: { ...ACTOR, actor_version: "1.0.0" },
        created_by: { ...ACTOR, actor_version: "1.0.0" },
      }));
      await repository.insertSourceVersion(transaction, version({
        publisher: "LVTChat",
        region: "GA",
        document_number: "DOC-1",
        edition: "1",
        publication_date: "2026-08-01",
        effective_at: NOW,
        retirement_at: "2027-08-24T15:00:00.000Z",
        supersedes_source_version_id:
          "1e48f484-b705-4741-9734-306147a2f437",
        superseded_by_source_version_id:
          "37714fd2-d2c4-4771-9576-e47b9cd3fa52",
        next_review_at: NOW,
        approved_at: NOW,
        approved_by: { ...ACTOR, actor_version: "1.0.0" },
        activated_at: NOW,
        created_by: { ...ACTOR, actor_version: "1.0.0" },
      }));
      await repository.insertOriginalArtifact(transaction, artifact());
      await repository.insertDerivative(transaction, derivative());
      await repository.insertPassages(transaction, [
        passage({ contextual_heading: "Controlled heading" }),
      ]);
      await repository.insertCollectionVersion(transaction, {
        collection_id: "4a649119-3779-474f-8392-820000000010",
        collection_version_id: "4a649119-3779-474f-8392-820000000011",
        organization_id: ORGANIZATION_ID,
        version_number: 1,
        purpose: "coverage",
        audience: [],
        access_policy: version().access_policy,
        source_version_ids: [VERSION_ID],
        effective_at: NOW,
        retired_at: "2027-08-24T15:00:00.000Z",
        approved_by: [ACTOR],
        created_at: NOW,
      } as never);
    });
  });

  it("writes approved-global material with omitted optional metadata", async () => {
    const test = sqlHarness();
    test.enqueue([], [], [], [], [], [], []);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    await sqlTransaction(test, async (transaction) => {
      await repository.insertSource(transaction, source({
        visibility: "approved_global",
        organization_id: undefined,
        current_source_version_id: undefined,
        owner: ACTOR,
        created_by: ACTOR,
      }));
      await repository.insertSourceVersion(transaction, version({
        organization_id: undefined,
        publisher: undefined,
        region: undefined,
        document_number: undefined,
        edition: undefined,
        publication_date: undefined,
        effective_at: undefined,
        retirement_at: undefined,
        supersedes_source_version_id: undefined,
        superseded_by_source_version_id: undefined,
        next_review_at: undefined,
        approved_at: undefined,
        approved_by: undefined,
        activated_at: undefined,
        created_by: ACTOR,
      }));
      await repository.insertOriginalArtifact(transaction, artifact({
        organization_id: undefined,
      }));
      await repository.insertDerivative(transaction, derivative({
        organization_id: undefined,
      }));
      await repository.insertPassages(transaction, [passage({
        organization_id: undefined,
        contextual_heading: undefined,
      })]);
      await repository.insertCollectionVersion(transaction, {
        collection_id: "4a649119-3779-474f-8392-820000000010",
        collection_version_id: "4a649119-3779-474f-8392-820000000011",
        version_number: 1,
        purpose: "global coverage",
        audience: [],
        access_policy: version().access_policy,
        source_version_ids: [VERSION_ID],
        effective_at: NOW,
        approved_by: [ACTOR],
        created_at: NOW,
      } as never);
    });
  });

  it("returns a fail-closed organization lifecycle miss", async () => {
    const test = sqlHarness();
    test.enqueue([], []);
    const repository = new SupabaseCapaKnowledgeRepository(test.sql);
    await sqlTransaction(test, async (transaction) => {
      await expect(repository.advanceSourceVersionLifecycle(transaction, {
        scope: {
          visibility: "organization",
          organization_id: ORGANIZATION_ID,
        },
        source_id: SOURCE_ID,
        source_version_id: VERSION_ID,
        expected_record_version: 1,
        expected_status: "unverified",
        next_status: "blocked",
        updated_at: NOW,
        updated_by_actor_type: "human",
        updated_by_actor_id: "owner",
        updated_by_actor_version: "1.0.0",
      })).resolves.toEqual({
        status: "conflict",
        reason_code: "SOURCE_NOT_FOUND_OR_NOT_AUTHORIZED",
      });
    });
  });
});