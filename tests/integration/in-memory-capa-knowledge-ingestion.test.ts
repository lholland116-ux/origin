import { createHash } from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
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
  ingestCapaKnowledge,
  type CapaKnowledgeIngestionCommand,
} from "../../lib/capa/knowledge/capa-knowledge-ingestion-service";

import {
  InMemoryCapaKnowledgeDatabase,
} from "../../lib/database/in-memory/in-memory-capa-knowledge-database";

import type {
  TransactionId,
} from "../../lib/database/transactions";

const NOW =
  "2026-08-24T15:00:00.000Z" as
    IsoDateTime;
const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;
const SOURCE_ID =
  "86f41520-3527-47ad-9c67-4a1799a55bc4" as
    CapaKnowledgeSourceId;
const VERSION_ID =
  "1c96db2c-0ab8-47d4-8c19-e198c14991ca" as
    CapaKnowledgeSourceVersionId;
const BYTES = new TextEncoder().encode(
  "Controlled knowledge for integration.",
);
const DIGEST = createHash("sha256")
  .update(BYTES)
  .digest("hex") as CapaKnowledgeFingerprint;
const TRACE = {
  request_id: "request-1" as RequestId,
  correlation_id:
    "correlation-1" as CorrelationId,
  idempotency_key:
    "knowledge-1" as IdempotencyKey,
} satisfies RequestTrace;

function source(): CapaKnowledgeSource {
  const actor = {
    actor_type: "human" as const,
    actor_id:
      "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23",
  };

  return {
    source_id: SOURCE_ID,
    visibility: "organization",
    organization_id: ORGANIZATION_ID,
    owner: actor,
    created_at: NOW,
    created_by: actor,
  };
}

function version(): CapaKnowledgeSourceVersion {
  return {
    source_version_id: VERSION_ID,
    source_id: SOURCE_ID,
    organization_id: ORGANIZATION_ID,
    version_number: 1,
    source_type: "SRC-01",
    authority_class:
      "CONTROLLED" as ControlledCode,
    title: "Controlled Procedure",
    issuer: "LVTChat LLC",
    jurisdiction: "US",
    language: "en",
    translation_status:
      "ORIGINAL" as ControlledCode,
    status: "draft",
    applicability_tags: [],
    origin: "INTERNAL" as ControlledCode,
    canonical_locator: "lvt://procedure/1",
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
    created_by: source().created_by,
  };
}

function command(): CapaKnowledgeIngestionCommand {
  return {
    scope: {
      visibility: "organization",
      organization_id: ORGANIZATION_ID,
    },
    source: source(),
    source_version: version(),
    artifact_bytes: BYTES,
    storage_reference:
      "quarantine://integration-1",
    declared_media_type: "text/plain",
    detected_media_type: "text/plain",
    extractor_id: "CAPA-TXT",
    extractor_version: "plain-text-1.0.0",
    request_trace: TRACE,
  };
}

function harness() {
  let transaction = 0;
  let passage = 0;
  const database =
    new InMemoryCapaKnowledgeDatabase({
      generate_transaction_id: () => {
        transaction += 1;
        return `transaction-${transaction}` as
          TransactionId;
      },
      now: () => new Date(NOW),
    });

  return {
    database,
    dependencies: {
      repository: database,
      transaction_manager: database,
      extraction_service: {
        async extract() {
          return {
            combined_text:
              "Controlled knowledge for integration.",
            warnings: [],
          } as never;
        },
      },
      malware_scanner: {
        async scan() {
          return {
            status: "clean" as const,
            controlled_status:
              "MALWARE_SCAN_CLEAN" as
                ControlledCode,
          };
        },
      },
      audit_recorder: database,
      ids: {
        ingestionId: () =>
          "4a649119-3779-474f-8392-82f99c80aa01" as
            CapaKnowledgeIngestionId,
        artifactId: () =>
          "4a649119-3779-474f-8392-82f99c80aa02" as
            CapaKnowledgeArtifactId,
        derivativeId: () =>
          "4a649119-3779-474f-8392-82f99c80aa03" as
            CapaKnowledgeDerivativeId,
        passageId: () => {
          passage += 1;
          return `4a649119-3779-474f-8392-${String(
            82_000_000_000 + passage,
          ).padStart(12, "0")}` as
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
  "in-memory governed CAPA knowledge ingestion",
  () => {
    it(
      "commits one complete ingestion and returns an authoritative replay",
      async () => {
        const test = harness();

        const first = await ingestCapaKnowledge(
          test.dependencies,
          command(),
        );
        const retry = await ingestCapaKnowledge(
          test.dependencies,
          command(),
        );

        expect(first.status).toBe("accepted");
        expect(retry.status)
          .toBe("already_registered");
        expect(retry.receipt.source_id)
          .toBe(first.receipt.source_id);
        expect(retry.receipt.source_version_id)
          .toBe(first.receipt.source_version_id);
        expect(test.database.inspectCounts())
          .toEqual({
            sources: 1,
            source_versions: 1,
            artifacts: 1,
            derivatives: 1,
            passages: 1,
            ingestion_audits: 1,
          });

        const stored = await test.database
          .findSourceVersionById({
            scope: command().scope,
            source_id: SOURCE_ID,
            source_version_id: VERSION_ID,
          });
        expect(stored).toMatchObject({
          status: "unverified",
          onboarding_stage: "processed",
          processing_status: "pass",
        });
      },
    );

    it(
      "rolls back every material write when audit recording fails",
      async () => {
        const test = harness();
        test.database.recordAcceptedIngestion =
          async () => {
            throw new Error("audit failed");
          };

        await expect(ingestCapaKnowledge(
          test.dependencies,
          command(),
        )).rejects.toThrow("audit failed");

        expect(test.database.inspectCounts())
          .toEqual({
            sources: 0,
            source_versions: 0,
            artifacts: 0,
            derivatives: 0,
            passages: 0,
            ingestion_audits: 0,
          });
      },
    );

    it(
      "keeps organization reads tenant safe",
      async () => {
        const test = harness();
        await ingestCapaKnowledge(
          test.dependencies,
          command(),
        );

        const outside = await test.database
          .findSourceById(
            {
              visibility: "organization",
              organization_id:
                "8f6988bb-c3a0-4ead-9abd-47a95efda579" as
                  OrganizationId,
            },
            SOURCE_ID,
          );

        expect(outside).toBeNull();
      },
    );
  },
);
