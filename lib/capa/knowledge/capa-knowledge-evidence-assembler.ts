import { createHash } from "node:crypto";

import type {
  IsoDateTime,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import type {
  CapaKnowledgeFingerprintRecord,
  CapaKnowledgePassageId,
  CapaKnowledgePassageLocator,
} from "./capa-knowledge-contract";

import type {
  CapaKnowledgeEvidenceId,
  CapaKnowledgeEvidencePackage,
  CapaKnowledgeEvidencePassage,
  CapaKnowledgeRetrievalReasonCode,
  CapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeContextRole,
  CapaKnowledgeContextSelectionResult,
  CapaKnowledgeRelatedContextPassage,
} from "./capa-knowledge-context-selection";

import {
  validateCapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-validator";

/**
 * Governed evidence-package assembly for downstream prompt construction.
 * This module performs no model invocation and makes no regulatory,
 * applicability, causation, adequacy or approval conclusion.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * RET-003, RET-006 through RET-009
 * CIT-001 through CIT-008
 * KRC-AC-003 through KRC-AC-006
 */

export const CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_VERSION =
  "capa-knowledge-evidence-1.0.0" as
    ControlledVersion;

export const CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_REASON_CODES = [
  "INVALID_EVIDENCE_INPUT",
  "SELECTION_RESULT_MISMATCH",
  "INVALID_COMPLETION_TIMESTAMP",
  "INVALID_PARTIAL_REASON",
  "EVIDENCE_LIMIT_EXCEEDED",
  "INVALID_SELECTED_EVIDENCE",
  "DUPLICATE_EVIDENCE_ID",
] as const;

export type CapaKnowledgeEvidenceAssemblyReasonCode =
  (typeof CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_REASON_CODES)[number];

export class CapaKnowledgeEvidenceAssemblyError
  extends Error {
  readonly reason_code:
    CapaKnowledgeEvidenceAssemblyReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeEvidenceAssemblyReasonCode,
  ) {
    super(
      "The governed CAPA evidence package could not be assembled.",
    );
    this.name =
      "CapaKnowledgeEvidenceAssemblyError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeEvidenceContextPassage {
  readonly role:
    CapaKnowledgeContextRole;
  readonly required: boolean;
  readonly passage_id:
    CapaKnowledgePassageId;
  readonly segmentation_version:
    ControlledVersion;
  readonly content: string;
  readonly fingerprint:
    CapaKnowledgeFingerprintRecord;
  readonly locators:
    readonly CapaKnowledgePassageLocator[];
}

export interface CapaKnowledgeAssembledEvidencePassage
  extends CapaKnowledgeEvidencePassage {
  readonly relationship:
    | "supports"
    | "contradicts"
    | "defines"
    | "contextualizes"
    | "limits"
    | "alternative";
  readonly related_context:
    readonly CapaKnowledgeEvidenceContextPassage[];
}

export interface CapaKnowledgeAssembledEvidencePackage
  extends Omit<
    CapaKnowledgeEvidencePackage,
    "passages"
  > {
  readonly evidence_assembly_version:
    ControlledVersion;
  readonly passages:
    readonly CapaKnowledgeAssembledEvidencePassage[];
  readonly total_character_count: number;
}

export interface CapaKnowledgeEvidenceAssemblyInput {
  readonly request:
    CapaKnowledgeRetrievalRequest;
  readonly selection:
    CapaKnowledgeContextSelectionResult;
  readonly upstream_status:
    "complete" | "partial";
  readonly partial_reason?:
    | "PARTIAL_INDEX"
    | "RETRIEVAL_TIMEOUT"
    | "RETRIEVAL_PROVIDER_FAILURE";
  readonly warnings:
    readonly string[];
  readonly completed_at:
    IsoDateTime;
}

const PARTIAL_REASONS = new Set<string>([
  "PARTIAL_INDEX",
  "RETRIEVAL_TIMEOUT",
  "RETRIEVAL_PROVIDER_FAILURE",
]);

function fail(
  reasonCode:
    CapaKnowledgeEvidenceAssemblyReasonCode,
): never {
  throw new CapaKnowledgeEvidenceAssemblyError(
    reasonCode,
  );
}

function validIsoTimestamp(
  value: unknown,
): value is IsoDateTime {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      value,
    ) &&
    !Number.isNaN(Date.parse(value));
}

function uniqueWarnings(
  warnings: unknown,
): readonly string[] {
  if (
    !Array.isArray(warnings) ||
    warnings.length > 100 ||
    !warnings.every(
      (warning) =>
        typeof warning === "string" &&
        warning.trim().length > 0 &&
        warning.length <= 2_000,
    )
  ) {
    fail("INVALID_EVIDENCE_INPUT");
  }

  return Object.freeze(
    Array.from(new Set(warnings)),
  );
}

function deterministicUuid(
  namespace: string,
): string {
  const hexadecimal =
    createHash("sha256")
      .update(namespace, "utf8")
      .digest("hex")
      .slice(0, 32)
      .split("");

  hexadecimal[12] = "5";
  hexadecimal[16] = (
    (Number.parseInt(hexadecimal[16] as string, 16) &
      0x3) |
    0x8
  ).toString(16);

  const value = hexadecimal.join("");

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function evidenceId(
  request: CapaKnowledgeRetrievalRequest,
  passageId: CapaKnowledgePassageId,
): CapaKnowledgeEvidenceId {
  return deterministicUuid(
    `${request.retrieval_run_id}:${passageId}:${CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_VERSION}`,
  ) as CapaKnowledgeEvidenceId;
}

function limitations(
  sourceStatus: string,
  processingStatus: string,
  qualityStatus: string,
  translationStatus: string,
  qualityNotes: readonly string[],
): readonly string[] {
  const values = [...qualityNotes];

  if (sourceStatus !== "current_effective") {
    values.push(
      `Source status at retrieval: ${sourceStatus}.`,
    );
  }
  if (processingStatus === "pass_with_limitations") {
    values.push(
      "Source processing passed with limitations.",
    );
  }
  if (qualityStatus === "pass_with_limitations") {
    values.push(
      "Source quality passed with limitations.",
    );
  }
  if (
    translationStatus !== "original" &&
    translationStatus !== "verified"
  ) {
    values.push(
      `Translation status: ${translationStatus}.`,
    );
  }

  return Object.freeze(
    Array.from(new Set(values)),
  );
}

function freezeLocators(
  locators:
    readonly CapaKnowledgePassageLocator[],
): readonly CapaKnowledgePassageLocator[] {
  return Object.freeze(
    locators.map(
      (locator) =>
        Object.freeze({ ...locator }),
    ),
  );
}

/** Builds a bounded immutable evidence package for prompt assembly. */
export function assembleCapaKnowledgeEvidencePackage(
  input: CapaKnowledgeEvidenceAssemblyInput,
): CapaKnowledgeAssembledEvidencePackage {
  if (
    input === null ||
    typeof input !== "object"
  ) {
    fail("INVALID_EVIDENCE_INPUT");
  }

  const request =
    validateCapaKnowledgeRetrievalRequest(
      input.request,
    );

  if (
    !validIsoTimestamp(input.completed_at) ||
    Date.parse(input.completed_at) <
      Date.parse(request.requested_at)
  ) {
    fail("INVALID_COMPLETION_TIMESTAMP");
  }

  if (
    input.upstream_status !== "complete" &&
    input.upstream_status !== "partial"
  ) {
    fail("INVALID_EVIDENCE_INPUT");
  }

  if (
    input.upstream_status === "partial"
      ? !PARTIAL_REASONS.has(
          input.partial_reason as string,
        )
      : input.partial_reason !== undefined
  ) {
    fail("INVALID_PARTIAL_REASON");
  }

  const suppliedWarnings =
    uniqueWarnings(input.warnings);
  const selection = input.selection;

  if (
    selection === null ||
    typeof selection !== "object" ||
    !Array.isArray(selection.selected) ||
    !Array.isArray(selection.candidate_trace) ||
    !Number.isSafeInteger(
      selection.total_character_count,
    ) ||
    selection.total_character_count < 0
  ) {
    fail("INVALID_EVIDENCE_INPUT");
  }

  if (
    selection.selected.length >
      request.policy.maximum_results ||
    selection.total_character_count >
      request.policy.maximum_total_characters
  ) {
    fail("EVIDENCE_LIMIT_EXCEEDED");
  }

  const passages = selection.selected.map(
    (selected, index):
      CapaKnowledgeAssembledEvidencePassage => {
      const primary = selected.primary_passage;
      const version = selected.source_version;
      const score = selected.candidate.final_score;

      if (
        score === undefined ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 1 ||
        primary.content.trim().length === 0 ||
        primary.locators.length === 0 ||
        version.title.trim().length === 0 ||
        version.issuer.trim().length === 0 ||
        version.jurisdiction.trim().length === 0
      ) {
        fail("INVALID_SELECTED_EVIDENCE");
      }

      const relatedContext =
        selected.related_context.map(
          (related: CapaKnowledgeRelatedContextPassage):
            CapaKnowledgeEvidenceContextPassage =>
            Object.freeze({
              role: related.role,
              required: related.required,
              passage_id:
                related.passage.passage_id,
              segmentation_version:
                related.passage
                  .segmentation_version,
              content:
                related.passage.content,
              fingerprint:
                related.passage.fingerprint,
              locators: freezeLocators(
                related.passage.locators,
              ),
            }),
        );

      return Object.freeze({
        evidence_id: evidenceId(
          request,
          primary.passage_id,
        ),
        source_id: selected.source.source_id,
        source_version_id:
          version.source_version_id,
        passage_id: primary.passage_id,
        source_type: version.source_type,
        source_status_at_use:
          version.status,
        title: version.title,
        issuer: version.issuer,
        jurisdiction: version.jurisdiction,
        ...(version.edition === undefined
          ? {}
          : { edition: version.edition }),
        ...(version.document_number === undefined
          ? {}
          : {
              document_number:
                version.document_number,
            }),
        applicability_tags:
          Object.freeze([
            ...version.applicability_tags,
          ]),
        segmentation_version:
          primary.segmentation_version,
        passage_fingerprint:
          primary.fingerprint,
        locators:
          freezeLocators(primary.locators),
        content: primary.content,
        limitations: limitations(
          version.status,
          version.processing_status,
          version.quality_status,
          version.translation_status,
          version.quality_notes,
        ),
        rank: index + 1,
        relevance_score: score,
        relationship:
          selected.relationship,
        related_context:
          Object.freeze(relatedContext),
      });
    },
  );

  const evidenceIds = passages.map(
    (passage) => passage.evidence_id,
  );

  if (
    new Set(evidenceIds).size !==
      evidenceIds.length
  ) {
    fail("DUPLICATE_EVIDENCE_ID");
  }

  const recalculatedCharacterCount =
    passages.reduce(
      (total, passage) =>
        total + passage.content.length +
        passage.related_context.reduce(
          (contextTotal, context) =>
            contextTotal +
            context.content.length,
          0,
        ),
      0,
    );

  if (
    recalculatedCharacterCount !==
      selection.total_character_count ||
    recalculatedCharacterCount >
      request.policy.maximum_total_characters
  ) {
    fail("SELECTION_RESULT_MISMATCH");
  }

  const noResult = passages.length === 0;
  const outcome = noResult
    ? "no_result" as const
    : input.upstream_status;
  const reasonCode:
    CapaKnowledgeRetrievalReasonCode =
    noResult
      ? "NO_ELIGIBLE_RESULT"
      : input.upstream_status === "partial"
        ? input.partial_reason as
            CapaKnowledgeRetrievalReasonCode
        : "RETRIEVAL_COMPLETE";
  const warnings = Object.freeze([
    ...suppliedWarnings,
    ...(noResult
      ? [
          "No eligible governed knowledge passage was available; this does not establish that no requirement or evidence exists.",
        ]
      : []),
  ]);

  return Object.freeze({
    evidence_assembly_version:
      CAPA_KNOWLEDGE_EVIDENCE_ASSEMBLY_VERSION,
    retrieval_run_id:
      request.retrieval_run_id,
    collection_version_id:
      request.scope.collection_version_id,
    outcome,
    reason_code: reasonCode,
    passages: Object.freeze(passages),
    candidate_trace:
      Object.freeze([
        ...selection.candidate_trace,
      ]),
    warnings,
    total_character_count:
      recalculatedCharacterCount,
    completed_at: input.completed_at,
  });
}
