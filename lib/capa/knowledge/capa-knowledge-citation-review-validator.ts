import { createHash } from "node:crypto";

import type {
  ActorReference,
  IsoDateTime,
  OrganizationId,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import {
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
  type CapaKnowledgeSourceStatus,
} from "./capa-knowledge-contract";

import type {
  CapaKnowledgeCitationRecord,
} from "./capa-knowledge-retrieval-contract";

import {
  CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS,
  CAPA_KNOWLEDGE_CITATION_REVIEW_POLICY_VERSION,
  type CapaKnowledgeCitationReviewDisposition,
  type CapaKnowledgeCitationReviewId,
  type CapaKnowledgeCitationReviewRecord,
} from "./capa-knowledge-citation-review-contract";

/**
 * Validates and constructs one human citation-review event.
 *
 * This boundary validates attribution and review invariants. Authorization
 * to review the tenant-bound citation must be established by trusted server
 * code before invocation.
 *
 * Traceability:
 * KUI-003, KUI-006 through KUI-008
 * CIT-005, CIT-007 and CIT-009
 */

export const CAPA_KNOWLEDGE_CITATION_REVIEW_REASON_CODES = [
  "INVALID_REVIEW_INPUT",
  "INVALID_ORGANIZATION",
  "INVALID_CITATION",
  "HUMAN_REVIEW_REQUIRED",
  "INVALID_DISPOSITION",
  "RATIONALE_REQUIRED",
  "INVALID_REVIEW_TIMESTAMP",
  "INVALID_REVIEW_POLICY_VERSION",
  "VALID_DISPOSITION_NOT_PERMITTED",
] as const;

export type CapaKnowledgeCitationReviewReasonCode =
  (typeof CAPA_KNOWLEDGE_CITATION_REVIEW_REASON_CODES)[number];

export class CapaKnowledgeCitationReviewValidationError
  extends Error {
  readonly reason_code:
    CapaKnowledgeCitationReviewReasonCode;

  constructor(
    reasonCode: CapaKnowledgeCitationReviewReasonCode,
  ) {
    super("The governed CAPA citation review is invalid.");
    this.name =
      "CapaKnowledgeCitationReviewValidationError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeCitationReviewInput {
  readonly organization_id:
    OrganizationId;
  readonly citation:
    CapaKnowledgeCitationRecord;
  readonly source_status_at_review:
    CapaKnowledgeSourceStatus;
  readonly disposition:
    CapaKnowledgeCitationReviewDisposition;
  readonly rationale: string;
  readonly reviewed_at:
    IsoDateTime;
  readonly reviewed_by:
    ActorReference;
  readonly review_policy_version?:
    ControlledVersion;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const DISPOSITIONS = new Set<string>(
  CAPA_KNOWLEDGE_CITATION_REVIEW_DISPOSITIONS,
);

const SOURCE_STATUSES = new Set<string>(
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
);

function fail(
  reasonCode: CapaKnowledgeCitationReviewReasonCode,
): never {
  throw new CapaKnowledgeCitationReviewValidationError(
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

function validCitation(
  citation: unknown,
): citation is CapaKnowledgeCitationRecord {
  if (
    citation === null ||
    typeof citation !== "object" ||
    Array.isArray(citation)
  ) {
    return false;
  }

  const value = citation as Record<string, unknown>;
  const ids = [
    value.citation_id,
    value.claim_id,
    value.evidence_id,
    value.source_id,
    value.source_version_id,
    value.passage_id,
    value.retrieval_run_id,
  ];

  return ids.every(
    (id) =>
      typeof id === "string" &&
      UUID_PATTERN.test(id),
  ) &&
    typeof value.validator_version === "string" &&
    VERSION_PATTERN.test(value.validator_version) &&
    validIsoTimestamp(value.validated_at) &&
    typeof value.validation_status === "string" &&
    typeof value.source_status_at_use === "string";
}

function deterministicReviewId(
  input: CapaKnowledgeCitationReviewInput,
  policyVersion: ControlledVersion,
): CapaKnowledgeCitationReviewId {
  const hexadecimal = createHash("sha256")
    .update(
      [
        input.organization_id,
        input.citation.citation_id,
        input.disposition,
        input.rationale,
        input.reviewed_at,
        input.reviewed_by.actor_id,
        policyVersion,
      ].join(":"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)
    .split("");

  hexadecimal[12] = "5";
  hexadecimal[16] = (
    (Number.parseInt(hexadecimal[16] as string, 16) & 0x3) |
    0x8
  ).toString(16);
  const value = hexadecimal.join("");

  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-") as CapaKnowledgeCitationReviewId;
}

export function constructCapaKnowledgeCitationReview(
  input: CapaKnowledgeCitationReviewInput,
): CapaKnowledgeCitationReviewRecord {
  if (
    input === null ||
    typeof input !== "object"
  ) {
    fail("INVALID_REVIEW_INPUT");
  }

  if (
    typeof input.organization_id !== "string" ||
    !UUID_PATTERN.test(input.organization_id)
  ) {
    fail("INVALID_ORGANIZATION");
  }

  if (!validCitation(input.citation)) {
    fail("INVALID_CITATION");
  }

  if (
    input.reviewed_by === null ||
    typeof input.reviewed_by !== "object" ||
    input.reviewed_by.actor_type !== "human" ||
    typeof input.reviewed_by.actor_id !== "string" ||
    input.reviewed_by.actor_id.trim().length === 0 ||
    input.reviewed_by.actor_id.length > 256
  ) {
    fail("HUMAN_REVIEW_REQUIRED");
  }

  if (
    typeof input.disposition !== "string" ||
    !DISPOSITIONS.has(input.disposition)
  ) {
    fail("INVALID_DISPOSITION");
  }

  if (
    typeof input.rationale !== "string" ||
    input.rationale.trim() !== input.rationale ||
    input.rationale.length < 3 ||
    input.rationale.length > 2_000
  ) {
    fail("RATIONALE_REQUIRED");
  }

  if (
    !validIsoTimestamp(input.reviewed_at) ||
    Date.parse(input.reviewed_at) <
      Date.parse(input.citation.validated_at)
  ) {
    fail("INVALID_REVIEW_TIMESTAMP");
  }

  const policyVersion =
    input.review_policy_version ??
      CAPA_KNOWLEDGE_CITATION_REVIEW_POLICY_VERSION;

  if (
    typeof policyVersion !== "string" ||
    !VERSION_PATTERN.test(policyVersion)
  ) {
    fail("INVALID_REVIEW_POLICY_VERSION");
  }

  if (
    typeof input.source_status_at_review !== "string" ||
    !SOURCE_STATUSES.has(input.source_status_at_review)
  ) {
    fail("INVALID_REVIEW_INPUT");
  }

  if (
    input.disposition === "valid" &&
    (
      input.citation.validation_status !== "valid" ||
      input.source_status_at_review !== "current_effective"
    )
  ) {
    fail("VALID_DISPOSITION_NOT_PERMITTED");
  }

  const humanReviewer = Object.freeze({
    ...input.reviewed_by,
    actor_type: "human" as const,
  });

  return Object.freeze({
    citation_review_id:
      deterministicReviewId(input, policyVersion),
    organization_id: input.organization_id,
    citation_id: input.citation.citation_id,
    claim_id: input.citation.claim_id,
    source_id: input.citation.source_id,
    source_version_id:
      input.citation.source_version_id,
    passage_id: input.citation.passage_id,
    retrieval_run_id:
      input.citation.retrieval_run_id,
    citation_validator_version:
      input.citation.validator_version,
    machine_validation_status:
      input.citation.validation_status,
    source_status_at_review:
      input.source_status_at_review,
    disposition: input.disposition,
    rationale: input.rationale,
    requires_expert_review:
      input.disposition === "needs_expert_review",
    reviewed_at: input.reviewed_at,
    reviewed_by: humanReviewer,
    review_policy_version: policyVersion,
  } satisfies CapaKnowledgeCitationReviewRecord);
}
