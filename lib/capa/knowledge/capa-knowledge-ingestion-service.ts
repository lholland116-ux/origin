import type {
  ActorReference,
  ControlledCode,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import type {
  CapaKnowledgeArtifactId,
  CapaKnowledgeDerivative,
  CapaKnowledgeDerivativeId,
  CapaKnowledgeFingerprint,
  CapaKnowledgeFingerprintRecord,
  CapaKnowledgeIngestionId,
  CapaKnowledgeIngestionReceipt,
  CapaKnowledgeOriginalArtifact,
  CapaKnowledgePassage as StoredCapaKnowledgePassage,
  CapaKnowledgePassageId,
  CapaKnowledgeSource,
  CapaKnowledgeSourceVersion,
} from "./capa-knowledge-contract";

import {
  validateCapaKnowledgeRegistration,
} from "./capa-knowledge-validator";

import {
  fingerprintCapaKnowledgeArtifact,
  normalizeCapaKnowledgeText,
} from "./capa-knowledge-processing";

import {
  segmentCapaKnowledgeText,
} from "./capa-knowledge-segmentation";

import type {
  CapaKnowledgeExtractionService,
} from "./capa-knowledge-extraction";

import type {
  CapaKnowledgeRepository,
  CapaKnowledgeScope,
} from "../../database/repositories/capa-knowledge-repository";

import type {
  TransactionContext,
  TransactionManager,
} from "../../database/transactions";

/**
 * Transaction-bound governed knowledge ingestion orchestration.
 *
 * This service cannot approve or activate a source. New content remains
 * unverified after controlled processing and requires attributable human
 * validation, approval and activation through separate lifecycle commands.
 *
 * Traceability: ING-001 through ING-006; SEG-001 through SEG-005.
 */

export const CAPA_KNOWLEDGE_INGESTION_VERSION =
  "capa-knowledge-ingestion-1.0.0" as
    ControlledVersion;

export type CapaKnowledgeIngestionServiceReasonCode =
  | "TENANT_SCOPE_DENIED"
  | "FINGERPRINT_MISMATCH"
  | "MALWARE_SCAN_FAILED"
  | "PROCESSING_FAILED";

export class CapaKnowledgeIngestionServiceError
  extends Error {
  readonly reason_code:
    CapaKnowledgeIngestionServiceReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeIngestionServiceReasonCode,
  ) {
    super(
      "The governed CAPA knowledge ingestion failed.",
    );
    this.name =
      "CapaKnowledgeIngestionServiceError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeMalwareScanResult {
  readonly status: "clean" | "failed";
  readonly controlled_status: ControlledCode;
}

export interface CapaKnowledgeMalwareScanner {
  scan(
    artifactBytes: Uint8Array,
  ): Promise<CapaKnowledgeMalwareScanResult>;
}

export interface CapaKnowledgeIngestionAuditInput {
  readonly ingestion_id:
    CapaKnowledgeIngestionId;
  readonly source_id:
    CapaKnowledgeSource["source_id"];
  readonly source_version_id:
    CapaKnowledgeSourceVersion["source_version_id"];
  readonly artifact_id:
    CapaKnowledgeArtifactId;
  readonly derivative_id:
    CapaKnowledgeDerivativeId;
  readonly passage_count: number;
  readonly original_fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly processing_status:
    "pass" | "pass_with_limitations";
  readonly actor: ActorReference;
  readonly occurred_at: IsoDateTime;
}

export interface CapaKnowledgeIngestionAuditRecorder {
  recordAcceptedIngestion(
    transaction: TransactionContext,
    input: CapaKnowledgeIngestionAuditInput,
  ): Promise<void>;
}

export interface CapaKnowledgeIngestionIdGenerator {
  ingestionId(): CapaKnowledgeIngestionId;
  artifactId(): CapaKnowledgeArtifactId;
  derivativeId(): CapaKnowledgeDerivativeId;
  passageId(): CapaKnowledgePassageId;
}

export interface CapaKnowledgeIngestionClock {
  now(): Date;
}

export interface CapaKnowledgeIngestionCommand {
  readonly scope: CapaKnowledgeScope;
  readonly source: CapaKnowledgeSource;
  readonly source_version:
    CapaKnowledgeSourceVersion;
  readonly artifact_bytes: Uint8Array;
  readonly storage_reference: string;
  readonly declared_media_type: string;
  readonly detected_media_type: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly request_trace: RequestTrace;
}

export type CapaKnowledgeIngestionResult =
  | {
      readonly status: "accepted";
      readonly reason_code:
        "INGESTION_ACCEPTED";
      readonly receipt:
        CapaKnowledgeIngestionReceipt;
      readonly artifact:
        CapaKnowledgeOriginalArtifact;
      readonly derivative:
        CapaKnowledgeDerivative;
      readonly passages:
        readonly StoredCapaKnowledgePassage[];
    }
  | {
      readonly status: "already_registered";
      readonly reason_code:
        "IDENTICAL_INPUT_ALREADY_REGISTERED";
      readonly receipt:
        CapaKnowledgeIngestionReceipt;
    };

export interface CapaKnowledgeIngestionDependencies {
  readonly repository:
    CapaKnowledgeRepository;
  readonly transaction_manager:
    TransactionManager;
  readonly extraction_service:
    Pick<CapaKnowledgeExtractionService, "extract">;
  readonly malware_scanner:
    CapaKnowledgeMalwareScanner;
  readonly audit_recorder:
    CapaKnowledgeIngestionAuditRecorder;
  readonly ids:
    CapaKnowledgeIngestionIdGenerator;
  readonly clock:
    CapaKnowledgeIngestionClock;
}

function fingerprintRecord(
  digestHex: string,
): CapaKnowledgeFingerprintRecord {
  return Object.freeze({
    algorithm: "sha256" as const,
    value: digestHex as
      CapaKnowledgeFingerprint,
  });
}

function organizationFields(
  scope: CapaKnowledgeScope,
): Readonly<{
  organization_id?:
    CapaKnowledgeSource["organization_id"];
}> {
  return scope.visibility === "organization"
    ? {
        organization_id:
          scope.organization_id,
      }
    : {};
}

function assertScope(
  command: CapaKnowledgeIngestionCommand,
): void {
  const sourceOrganization =
    command.source.organization_id;
  const versionOrganization =
    command.source_version.organization_id;

  const valid =
    command.scope.visibility === "organization"
      ? command.source.visibility ===
          "organization" &&
        sourceOrganization ===
          command.scope.organization_id &&
        versionOrganization ===
          command.scope.organization_id
      : command.source.visibility ===
          "approved_global" &&
        sourceOrganization === undefined &&
        versionOrganization === undefined;

  if (!valid) {
    throw new CapaKnowledgeIngestionServiceError(
      "TENANT_SCOPE_DENIED",
    );
  }
}

function isoNow(
  clock: CapaKnowledgeIngestionClock,
): IsoDateTime {
  const value = clock.now();

  if (Number.isNaN(value.getTime())) {
    throw new CapaKnowledgeIngestionServiceError(
      "PROCESSING_FAILED",
    );
  }

  return value.toISOString() as IsoDateTime;
}

function receipt(
  ingestionId: CapaKnowledgeIngestionId,
  sourceVersion:
    CapaKnowledgeSourceVersion,
  requestTrace: RequestTrace,
  originalFingerprint:
    CapaKnowledgeFingerprintRecord,
  scope: CapaKnowledgeScope,
): CapaKnowledgeIngestionReceipt {
  return Object.freeze({
    ingestion_id: ingestionId,
    source_id: sourceVersion.source_id,
    source_version_id:
      sourceVersion.source_version_id,
    ...organizationFields(scope),
    request_trace: requestTrace,
    original_fingerprint:
      originalFingerprint,
    processing_version:
      CAPA_KNOWLEDGE_INGESTION_VERSION,
    status: sourceVersion.processing_status,
  });
}

export async function ingestCapaKnowledge(
  dependencies:
    CapaKnowledgeIngestionDependencies,
  command:
    CapaKnowledgeIngestionCommand,
): Promise<CapaKnowledgeIngestionResult> {
  assertScope(command);

  const ingestionId =
    dependencies.ids.ingestionId();
  const original =
    fingerprintCapaKnowledgeArtifact(
      command.artifact_bytes,
    );
  const originalFingerprint =
    fingerprintRecord(original.digest_hex);

  const existing = await dependencies.repository
    .findSourceVersionByOriginalFingerprint({
      scope: command.scope,
      fingerprint: originalFingerprint,
    });

  if (existing !== null) {
    return Object.freeze({
      status: "already_registered" as const,
      reason_code:
        "IDENTICAL_INPUT_ALREADY_REGISTERED" as const,
      receipt: receipt(
        ingestionId,
        existing,
        command.request_trace,
        originalFingerprint,
        command.scope,
      ),
    });
  }

  const suppliedFingerprint =
    command.source_version.content_fingerprint;

  if (
    suppliedFingerprint.algorithm !== "sha256" ||
    suppliedFingerprint.value !==
      originalFingerprint.value
  ) {
    throw new CapaKnowledgeIngestionServiceError(
      "FINGERPRINT_MISMATCH",
    );
  }

  const scan = await dependencies.malware_scanner
    .scan(command.artifact_bytes);

  if (scan.status !== "clean") {
    throw new CapaKnowledgeIngestionServiceError(
      "MALWARE_SCAN_FAILED",
    );
  }

  const extracted = await dependencies
    .extraction_service.extract({
      artifact_bytes: command.artifact_bytes,
      declared_media_type:
        command.declared_media_type,
      detected_media_type:
        command.detected_media_type,
      extractor_id: command.extractor_id,
      extractor_version:
        command.extractor_version,
    });
  const normalized = normalizeCapaKnowledgeText(
    extracted.combined_text,
  );
  const segmented = segmentCapaKnowledgeText(
    command.source_version.source_version_id,
    normalized,
  );
  const createdAt = isoNow(dependencies.clock);
  const processingStatus =
    extracted.warnings.length === 0
      ? "pass" as const
      : "pass_with_limitations" as const;
  const qualityStatus = processingStatus;
  const scopeFields =
    organizationFields(command.scope);
  const artifactId =
    dependencies.ids.artifactId();
  const derivativeId =
    dependencies.ids.derivativeId();

  const source = Object.freeze({
    ...command.source,
    current_source_version_id:
      command.source_version.source_version_id,
  });
  const sourceVersion = Object.freeze({
    ...command.source_version,
    status: "unverified" as const,
    content_fingerprint:
      originalFingerprint,
    onboarding_stage: "processed" as const,
    processing_status: processingStatus,
    processing_version:
      CAPA_KNOWLEDGE_INGESTION_VERSION,
    quality_status: qualityStatus,
    quality_notes: Object.freeze([
      ...extracted.warnings,
    ]),
    approved_at: undefined,
    approved_by: undefined,
    activated_at: undefined,
    effective_at: undefined,
    created_at: createdAt,
  });

  validateCapaKnowledgeRegistration(
    source,
    sourceVersion,
  );

  const artifact: CapaKnowledgeOriginalArtifact =
    Object.freeze({
      artifact_id: artifactId,
      source_version_id:
        sourceVersion.source_version_id,
      ...scopeFields,
      media_type: command.detected_media_type,
      byte_length: original.byte_length,
      storage_reference:
        command.storage_reference,
      fingerprint: originalFingerprint,
      quarantined: true,
      malware_scan_status:
        scan.controlled_status,
      created_at: createdAt,
    });
  const normalizedFingerprint =
    fingerprintRecord(
      normalized.fingerprint.digest_hex,
    );
  const derivative: CapaKnowledgeDerivative =
    Object.freeze({
      derivative_id: derivativeId,
      source_version_id:
        sourceVersion.source_version_id,
      source_artifact_id: artifactId,
      ...scopeFields,
      kind: "normalized_text",
      engine:
        "CAPA_KNOWLEDGE_NORMALIZER" as
          ControlledCode,
      engine_version:
        normalized.processing_version as
          ControlledVersion,
      content: normalized.text,
      fingerprint: normalizedFingerprint,
      status: processingStatus,
      limitations: Object.freeze([
        ...extracted.warnings,
      ]),
      created_at: createdAt,
    });
  const passages = Object.freeze(
    segmented.passages.map(
      (passage): StoredCapaKnowledgePassage =>
        Object.freeze({
          passage_id:
            dependencies.ids.passageId(),
          source_version_id:
            sourceVersion.source_version_id,
          derivative_id: derivativeId,
          ...scopeFields,
          sequence_number:
            passage.sequence_number,
          segmentation_version:
            passage.segmentation_version as
              ControlledVersion,
          content: passage.text,
          locators: Object.freeze([{
            kind: "character_range" as const,
            label: passage.locator,
            start:
              passage.start_character_offset,
            end:
              passage.end_character_offset,
          }]),
          overlap_passage_ids:
            Object.freeze([]),
          fingerprint: fingerprintRecord(
            passage.fingerprint.digest_hex,
          ),
          quality_status: qualityStatus,
          machine_interpretable: true,
          created_at: createdAt,
        }),
    ),
  );

  const acceptedReceipt = receipt(
    ingestionId,
    sourceVersion,
    command.request_trace,
    originalFingerprint,
    command.scope,
  );

  await dependencies.transaction_manager
    .runInTransaction(
      command.request_trace,
      async (transaction) => {
        await dependencies.repository
          .insertSource(transaction, source);
        await dependencies.repository
          .insertSourceVersion(
            transaction,
            sourceVersion,
          );
        await dependencies.repository
          .insertOriginalArtifact(
            transaction,
            artifact,
          );
        await dependencies.repository
          .insertDerivative(
            transaction,
            derivative,
          );
        await dependencies.repository
          .insertPassages(
            transaction,
            passages,
          );
        await dependencies.audit_recorder
          .recordAcceptedIngestion(
            transaction,
            {
              ingestion_id: ingestionId,
              source_id: source.source_id,
              source_version_id:
                sourceVersion.source_version_id,
              artifact_id: artifactId,
              derivative_id: derivativeId,
              passage_count: passages.length,
              original_fingerprint:
                originalFingerprint,
              processing_status:
                processingStatus,
              actor: source.created_by,
              occurred_at: createdAt,
            },
          );
      },
    );

  return Object.freeze({
    status: "accepted" as const,
    reason_code:
      "INGESTION_ACCEPTED" as const,
    receipt: acceptedReceipt,
    artifact,
    derivative,
    passages,
  });
}
