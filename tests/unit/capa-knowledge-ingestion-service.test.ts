import { createHash } from "node:crypto";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ActorReference,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
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
  CapaKnowledgeDerivativeId,
  CapaKnowledgeFingerprint,
  CapaKnowledgeIngestionId,
  CapaKnowledgePassageId,
  CapaKnowledgeSource,
  CapaKnowledgeSourceId,
  CapaKnowledgeSourceVersion,
  CapaKnowledgeSourceVersionId,
} from "../../lib/capa/knowledge/capa-knowledge-contract";

import {
  CAPA_KNOWLEDGE_INGESTION_VERSION,
  CapaKnowledgeIngestionServiceError,
  ingestCapaKnowledge,
  type CapaKnowledgeIngestionCommand,
  type CapaKnowledgeIngestionDependencies,
} from "../../lib/capa/knowledge/capa-knowledge-ingestion-service";

import type {
  CapaKnowledgeRepository,
} from "../../lib/database/repositories/capa-knowledge-repository";

import type {
  TransactionContext,
  TransactionId,
} from "../../lib/database/transactions";

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;
const SOURCE_ID =
  "86f41520-3527-47ad-9c67-4a1799a55bc4" as
    CapaKnowledgeSourceId;
const SOURCE_VERSION_ID =
  "1c96db2c-0ab8-47d4-8c19-e198c14991ca" as
    CapaKnowledgeSourceVersionId;
const NOW =
  "2026-08-24T14:45:00.000Z" as
    IsoDateTime;
const ACTOR = Object.freeze({
  actor_type: "human" as const,
  actor_id:
    "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23",
}) satisfies ActorReference;
const BYTES = new TextEncoder().encode(
  "Controlled CAPA knowledge source.",
);
const DIGEST = createHash("sha256")
  .update(BYTES)
  .digest("hex") as CapaKnowledgeFingerprint;
const TRACE = Object.freeze({
  request_id: "request-1" as RequestId,
  correlation_id:
    "correlation-1" as CorrelationId,
  idempotency_key:
    "ingestion-key-1" as IdempotencyKey,
}) satisfies RequestTrace;
const TRANSACTION = Object.freeze({
  transaction_id:
    "transaction-1" as TransactionId,
  started_at: NOW,
  request_trace: TRACE,
}) satisfies TransactionContext;

function source(): CapaKnowledgeSource {
  return {
    source_id: SOURCE_ID,
    visibility: "organization",
    organization_id: ORGANIZATION_ID,
    owner: ACTOR,
    created_at: NOW,
    created_by: ACTOR,
  };
}

function sourceVersion():
  CapaKnowledgeSourceVersion {
  return {
    source_version_id: SOURCE_VERSION_ID,
    source_id: SOURCE_ID,
    organization_id: ORGANIZATION_ID,
    version_number: 1,
    source_type: "SRC-01",
    authority_class:
      "CONTROLLED_INTERNAL" as ControlledCode,
    title: "CAPA Procedure",
    issuer: "LVTChat LLC",
    jurisdiction: "US",
    language: "en",
    translation_status:
      "ORIGINAL" as ControlledCode,
    status: "draft",
    applicability_tags: [],
    origin: "INTERNAL" as ControlledCode,
    canonical_locator: "lvt://capa/procedure",
    content_fingerprint: {
      algorithm: "sha256",
      value: DIGEST,
    },
    rights: {
      rights_classification:
        "OWNED" as ControlledCode,
      retention_policy:
        "QUALITY_RECORD" as ControlledCode,
      legal_hold: false,
    },
    access_policy: {
      policy_version:
        "policy-1.0.0" as ControlledVersion,
      permitted_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      sensitivity:
        "INTERNAL" as ControlledCode,
      export_permitted: false,
      excerpt_permitted: true,
      redistribution_permitted: false,
    },
    onboarding_stage: "registered",
    processing_status: "pending",
    processing_version:
      "pending-1.0.0" as ControlledVersion,
    quality_status: "manual_review",
    quality_notes: [],
    created_at: NOW,
    created_by: ACTOR,
  };
}

function command(
  overrides: Partial<
    CapaKnowledgeIngestionCommand
  > = {},
): CapaKnowledgeIngestionCommand {
  return {
    scope: {
      visibility: "organization",
      organization_id: ORGANIZATION_ID,
    },
    source: source(),
    source_version: sourceVersion(),
    artifact_bytes: BYTES,
    storage_reference:
      "quarantine://artifact-1",
    declared_media_type: "text/plain",
    detected_media_type: "text/plain",
    extractor_id: "CAPA-TXT",
    extractor_version: "plain-text-1.0.0",
    request_trace: TRACE,
    ...overrides,
  };
}

interface Harness {
  readonly dependencies:
    CapaKnowledgeIngestionDependencies;
  readonly repository:
    Record<string, ReturnType<typeof vi.fn>>;
  readonly audit:
    ReturnType<typeof vi.fn>;
  readonly transaction:
    ReturnType<typeof vi.fn>;
  readonly extraction:
    ReturnType<typeof vi.fn>;
  readonly scan:
    ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  let passage = 0;
  const repository = {
    findSourceVersionByOriginalFingerprint:
      vi.fn().mockResolvedValue(null),
    insertSource:
      vi.fn().mockResolvedValue(undefined),
    insertSourceVersion:
      vi.fn().mockResolvedValue(undefined),
    insertOriginalArtifact:
      vi.fn().mockResolvedValue(undefined),
    insertDerivative:
      vi.fn().mockResolvedValue(undefined),
    insertPassages:
      vi.fn().mockResolvedValue(undefined),
  };
  const audit =
    vi.fn().mockResolvedValue(undefined);
  const transaction = vi.fn(
    async (
      _trace: RequestTrace,
      work: (
        transaction: TransactionContext,
      ) => Promise<unknown>,
    ) => work(TRANSACTION),
  );
  const extraction =
    vi.fn().mockResolvedValue({
      combined_text:
        "Controlled CAPA knowledge source.",
      warnings: [],
    });
  const scan =
    vi.fn().mockResolvedValue({
      status: "clean",
      controlled_status:
        "MALWARE_SCAN_CLEAN" as ControlledCode,
    });

  return {
    repository,
    audit,
    transaction,
    extraction,
    scan,
    dependencies: {
      repository:
        repository as unknown as
          CapaKnowledgeRepository,
      transaction_manager: {
        // Vitest records this generic method through a non-generic mock.
        // Keep the compatibility cast isolated to the test boundary.
        runInTransaction:
          transaction as unknown as
            CapaKnowledgeIngestionDependencies[
              "transaction_manager"
            ]["runInTransaction"],
      },
      extraction_service: {
        extract: extraction,
      },
      malware_scanner: { scan },
      audit_recorder: {
        recordAcceptedIngestion: audit,
      },
      ids: {
        ingestionId: () =>
          "ingestion-1" as
            CapaKnowledgeIngestionId,
        artifactId: () =>
          "artifact-1" as
            CapaKnowledgeArtifactId,
        derivativeId: () =>
          "derivative-1" as
            CapaKnowledgeDerivativeId,
        passageId: () => {
          passage += 1;
          return `passage-${passage}` as
            CapaKnowledgePassageId;
        },
      },
      clock: {
        now: () => new Date(NOW),
      },
    },
  };
}

describe(
  "controlled CAPA knowledge ingestion service",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "processes and persists one unverified source atomically in order",
      async () => {
        const test = harness();
        const result = await ingestCapaKnowledge(
          test.dependencies,
          command(),
        );

        expect(result.status).toBe("accepted");
        if (result.status !== "accepted") {
          throw new Error("Expected accepted ingestion.");
        }

        expect(result.receipt).toMatchObject({
          ingestion_id: "ingestion-1",
          source_id: SOURCE_ID,
          source_version_id: SOURCE_VERSION_ID,
          organization_id: ORGANIZATION_ID,
          original_fingerprint: {
            algorithm: "sha256",
            value: DIGEST,
          },
          processing_version:
            CAPA_KNOWLEDGE_INGESTION_VERSION,
          status: "pass",
        });
        expect(result.artifact).toMatchObject({
          artifact_id: "artifact-1",
          quarantined: true,
          malware_scan_status:
            "MALWARE_SCAN_CLEAN",
          byte_length: BYTES.byteLength,
        });
        expect(result.derivative).toMatchObject({
          derivative_id: "derivative-1",
          kind: "normalized_text",
          content:
            "Controlled CAPA knowledge source.",
          status: "pass",
        });
        expect(result.passages).toHaveLength(1);
        expect(result.passages[0]).toMatchObject({
          passage_id: "passage-1",
          sequence_number: 1,
          quality_status: "pass",
          machine_interpretable: true,
          overlap_passage_ids: [],
          locators: [{
            kind: "character_range",
            start: 0,
            end: 33,
          }],
        });

        expect(test.transaction)
          .toHaveBeenCalledWith(
            TRACE,
            expect.any(Function),
          );
        expect(test.repository.insertSource)
          .toHaveBeenCalledWith(
            TRANSACTION,
            expect.objectContaining({
              current_source_version_id:
                SOURCE_VERSION_ID,
            }),
          );
        expect(test.repository.insertSourceVersion)
          .toHaveBeenCalledWith(
            TRANSACTION,
            expect.objectContaining({
              status: "unverified",
              onboarding_stage: "processed",
              approved_at: undefined,
              activated_at: undefined,
            }),
          );
        expect(test.audit).toHaveBeenCalledWith(
          TRANSACTION,
          expect.objectContaining({
            passage_count: 1,
            processing_status: "pass",
          }),
        );

        const sourceOrder =
          test.repository.insertSource
            .mock.invocationCallOrder[0];
        const versionOrder =
          test.repository.insertSourceVersion
            .mock.invocationCallOrder[0];
        const artifactOrder =
          test.repository.insertOriginalArtifact
            .mock.invocationCallOrder[0];
        const derivativeOrder =
          test.repository.insertDerivative
            .mock.invocationCallOrder[0];
        const passageOrder =
          test.repository.insertPassages
            .mock.invocationCallOrder[0];
        const auditOrder =
          test.audit.mock.invocationCallOrder[0];

        expect(sourceOrder).toBeLessThan(
          versionOrder!,
        );
        expect(versionOrder).toBeLessThan(
          artifactOrder!,
        );
        expect(artifactOrder).toBeLessThan(
          derivativeOrder!,
        );
        expect(derivativeOrder).toBeLessThan(
          passageOrder!,
        );
        expect(passageOrder).toBeLessThan(
          auditOrder!,
        );
      },
    );

    it(
      "returns the authoritative exact-fingerprint replay without processing or writes",
      async () => {
        const test = harness();
        test.repository
          .findSourceVersionByOriginalFingerprint
          .mockResolvedValue(sourceVersion());

        const result = await ingestCapaKnowledge(
          test.dependencies,
          command(),
        );

        expect(result).toMatchObject({
          status: "already_registered",
          reason_code:
            "IDENTICAL_INPUT_ALREADY_REGISTERED",
          receipt: {
            source_id: SOURCE_ID,
            source_version_id: SOURCE_VERSION_ID,
            original_fingerprint: {
              value: DIGEST,
            },
          },
        });
        expect(test.scan).not.toHaveBeenCalled();
        expect(test.extraction).not.toHaveBeenCalled();
        expect(test.transaction)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "records parser limitations and requires later human review",
      async () => {
        const test = harness();
        test.extraction.mockResolvedValue({
          combined_text: "Extracted with warning",
          warnings: ["IMAGE_CONTENT_OMITTED"],
        });

        const result = await ingestCapaKnowledge(
          test.dependencies,
          command(),
        );

        expect(result.status).toBe("accepted");
        if (result.status !== "accepted") {
          throw new Error("Expected accepted ingestion.");
        }
        expect(result.receipt.status)
          .toBe("pass_with_limitations");
        expect(result.derivative.limitations)
          .toEqual(["IMAGE_CONTENT_OMITTED"]);
        expect(result.passages[0]?.quality_status)
          .toBe("pass_with_limitations");
        expect(test.repository.insertSourceVersion)
          .toHaveBeenCalledWith(
            TRANSACTION,
            expect.objectContaining({
              status: "unverified",
              quality_notes: [
                "IMAGE_CONTENT_OMITTED",
              ],
            }),
          );
      },
    );

    it(
      "denies a cross-organization command before lookup or processing",
      async () => {
        const test = harness();
        const other =
          "8f6988bb-c3a0-4ead-9abd-47a95efda579" as
            OrganizationId;

        await expect(ingestCapaKnowledge(
          test.dependencies,
          command({
            scope: {
              visibility: "organization",
              organization_id: other,
            },
          }),
        )).rejects.toMatchObject({
          reason_code: "TENANT_SCOPE_DENIED",
        });
        expect(test.repository
          .findSourceVersionByOriginalFingerprint)
          .not.toHaveBeenCalled();
        expect(test.scan).not.toHaveBeenCalled();
      },
    );

    it(
      "supports an explicitly approved-global scope without a tenant id",
      async () => {
        const test = harness();
        const globalSource = {
          ...source(),
          visibility: "approved_global" as const,
          organization_id: undefined,
        };
        const globalVersion = {
          ...sourceVersion(),
          organization_id: undefined,
        };

        const result = await ingestCapaKnowledge(
          test.dependencies,
          command({
            scope: {
              visibility: "approved_global",
            },
            source: globalSource,
            source_version: globalVersion,
          }),
        );

        expect(result.receipt)
          .not.toHaveProperty("organization_id");
      },
    );

    it(
      "rejects a supplied fingerprint mismatch before scanning",
      async () => {
        const test = harness();
        const version = {
          ...sourceVersion(),
          content_fingerprint: {
            algorithm: "sha256" as const,
            value: "a".repeat(64) as
              CapaKnowledgeFingerprint,
          },
        };

        await expect(ingestCapaKnowledge(
          test.dependencies,
          command({ source_version: version }),
        )).rejects.toMatchObject({
          reason_code: "FINGERPRINT_MISMATCH",
        });
        expect(test.scan).not.toHaveBeenCalled();
        expect(test.transaction)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "blocks malware before extraction and persistence",
      async () => {
        const test = harness();
        test.scan.mockResolvedValue({
          status: "failed",
          controlled_status:
            "MALWARE_SCAN_FAILED" as ControlledCode,
        });

        await expect(ingestCapaKnowledge(
          test.dependencies,
          command(),
        )).rejects.toMatchObject({
          reason_code: "MALWARE_SCAN_FAILED",
        });
        expect(test.extraction).not.toHaveBeenCalled();
        expect(test.transaction)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "propagates a transaction failure so the adapter rolls back every write",
      async () => {
        const test = harness();
        const failure =
          new Error("audit append failed");
        test.audit.mockRejectedValue(failure);

        await expect(ingestCapaKnowledge(
          test.dependencies,
          command(),
        )).rejects.toBe(failure);
        expect(test.repository.insertPassages)
          .toHaveBeenCalledOnce();
        expect(test.audit).toHaveBeenCalledOnce();
      },
    );

    it(
      "fails closed on an invalid server clock",
      async () => {
        const test = harness();
        const dependencies = {
          ...test.dependencies,
          clock: {
            now: () => new Date(Number.NaN),
          },
        };

        await expect(ingestCapaKnowledge(
          dependencies,
          command(),
        )).rejects.toMatchObject({
          reason_code: "PROCESSING_FAILED",
        });
        expect(test.transaction)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "provides a stable named controlled error",
      () => {
        const error =
          new CapaKnowledgeIngestionServiceError(
            "PROCESSING_FAILED",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeIngestionServiceError",
        );
        expect(error.message).toBe(
          "The governed CAPA knowledge ingestion failed.",
        );
      },
    );
  },
);
