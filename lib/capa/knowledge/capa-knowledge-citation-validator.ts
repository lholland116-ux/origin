import { createHash } from "node:crypto";

import type {
  ActorReference,
  IsoDateTime,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import type {
  CapaKnowledgeFingerprintRecord,
} from "./capa-knowledge-contract";

import {
  CAPA_KNOWLEDGE_CITATION_RELATIONSHIPS,
  type CapaKnowledgeCitationId,
  type CapaKnowledgeCitationRecord,
  type CapaKnowledgeCitationRelationship,
  type CapaKnowledgeCitationValidationStatus,
  type CapaKnowledgeClaimId,
  type CapaKnowledgeEvidenceId,
} from "./capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeAssembledEvidencePackage,
  CapaKnowledgeAssembledEvidencePassage,
} from "./capa-knowledge-evidence-assembler";

/**
 * Exact claim-specific citation construction and validation.
 *
 * Similarity and document presence never establish claim support. A caller
 * must supply an attributable relationship assessment that explicitly checks
 * modality, scope, negation and exceptions.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * CIT-001 through CIT-012
 * KRC-T-003, KRC-T-004, KRC-T-010, KRC-T-014, KRC-T-017 and KRC-T-020
 */

export const CAPA_KNOWLEDGE_CITATION_VALIDATOR_VERSION =
  "capa-knowledge-citation-validator-1.0.0" as
    ControlledVersion;

export const CAPA_KNOWLEDGE_CITATION_VALIDATION_REASON_CODES = [
  "INVALID_CITATION_INPUT",
  "INVALID_CLAIM",
  "EVIDENCE_NOT_FOUND",
  "RELATIONSHIP_MISMATCH",
  "QUOTED_TEXT_NOT_EXACT",
  "INVALID_ASSESSMENT",
  "INVALID_VALIDATION_TIMESTAMP",
] as const;

export type CapaKnowledgeCitationValidationReasonCode =
  (typeof CAPA_KNOWLEDGE_CITATION_VALIDATION_REASON_CODES)[number];

export class CapaKnowledgeCitationValidationError
  extends Error {
  readonly reason_code:
    CapaKnowledgeCitationValidationReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeCitationValidationReasonCode,
  ) {
    super(
      "The governed CAPA knowledge citation is invalid.",
    );
    this.name =
      "CapaKnowledgeCitationValidationError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeCitationAssessment {
  readonly relationship_verified:
    boolean | null;
  readonly modality_preserved:
    boolean | null;
  readonly scope_preserved:
    boolean | null;
  readonly negation_preserved:
    boolean | null;
  readonly exceptions_preserved:
    boolean | null;
  readonly source_accessible: boolean;
  readonly excerpt_permitted: boolean;
  readonly assessed_by:
    ActorReference;
  readonly assessment_version:
    ControlledVersion;
}

export interface CapaKnowledgeCitationValidationInput {
  readonly claim_id:
    CapaKnowledgeClaimId;
  readonly claim_text: string;
  readonly evidence_id:
    CapaKnowledgeEvidenceId;
  readonly relationship:
    CapaKnowledgeCitationRelationship;
  /** Exact transient excerpt. It may be fingerprinted but not rendered. */
  readonly quoted_text: string;
  readonly evidence_package:
    CapaKnowledgeAssembledEvidencePackage;
  readonly assessment:
    CapaKnowledgeCitationAssessment;
  readonly validated_at:
    IsoDateTime;
}

export interface CapaKnowledgeValidatedCitation {
  readonly citation:
    CapaKnowledgeCitationRecord;
  readonly claim_text: string;
  readonly quoted_text?: string;
  readonly validation_findings:
    readonly string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const RELATIONSHIPS =
  new Set<string>(
    CAPA_KNOWLEDGE_CITATION_RELATIONSHIPS,
  );

function fail(
  reasonCode:
    CapaKnowledgeCitationValidationReasonCode,
): never {
  throw new CapaKnowledgeCitationValidationError(
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

function actorReference(
  actor: unknown,
): actor is ActorReference {
  if (
    typeof actor !== "object" ||
    actor === null ||
    Array.isArray(actor)
  ) {
    return false;
  }

  const value = actor as
    Record<string, unknown>;

  return ["human", "service", "agent", "system"].includes(
    value.actor_type as string,
  ) &&
    typeof value.actor_id === "string" &&
    value.actor_id.trim().length > 0 &&
    value.actor_id.length <= 256 &&
    (
      value.actor_version === undefined ||
      (
        typeof value.actor_version === "string" &&
        VERSION_PATTERN.test(
          value.actor_version,
        )
      )
    );
}

function fingerprint(
  value: string,
): CapaKnowledgeFingerprintRecord {
  return Object.freeze({
    algorithm: "sha256" as const,
    value:
      createHash("sha256")
        .update(value, "utf8")
        .digest("hex") as
          CapaKnowledgeFingerprintRecord["value"],
  });
}

function deterministicCitationId(
  input: CapaKnowledgeCitationValidationInput,
): CapaKnowledgeCitationId {
  const hexadecimal = createHash("sha256")
    .update(
      [
        input.evidence_package.retrieval_run_id,
        input.claim_id,
        input.evidence_id,
        input.relationship,
        CAPA_KNOWLEDGE_CITATION_VALIDATOR_VERSION,
      ].join(":"),
      "utf8",
    )
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
  ].join("-") as CapaKnowledgeCitationId;
}

function validateAssessment(
  assessment:
    CapaKnowledgeCitationAssessment,
): void {
  if (
    assessment === null ||
    typeof assessment !== "object"
  ) {
    fail("INVALID_ASSESSMENT");
  }

  const checks = [
    assessment.relationship_verified,
    assessment.modality_preserved,
    assessment.scope_preserved,
    assessment.negation_preserved,
    assessment.exceptions_preserved,
  ];

  if (
    checks.some(
      (check) =>
        check !== true &&
        check !== false &&
        check !== null,
    ) ||
    typeof assessment.source_accessible !==
      "boolean" ||
    typeof assessment.excerpt_permitted !==
      "boolean" ||
    !actorReference(assessment.assessed_by) ||
    typeof assessment.assessment_version !==
      "string" ||
    !VERSION_PATTERN.test(
      assessment.assessment_version,
    )
  ) {
    fail("INVALID_ASSESSMENT");
  }
}

function validationStatus(
  evidence:
    CapaKnowledgeAssembledEvidencePassage,
  assessment:
    CapaKnowledgeCitationAssessment,
): CapaKnowledgeCitationValidationStatus {
  if (!assessment.source_accessible) {
    return "inaccessible";
  }
  if (!assessment.excerpt_permitted) {
    return "rights_restricted";
  }
  if (
    evidence.source_status_at_use === "superseded" ||
    evidence.source_status_at_use === "withdrawn"
  ) {
    return "superseded_impact";
  }

  const checks = [
    assessment.relationship_verified,
    assessment.modality_preserved,
    assessment.scope_preserved,
    assessment.negation_preserved,
    assessment.exceptions_preserved,
  ];

  if (checks.some((check) => check === null)) {
    return "unresolved";
  }

  return checks.every((check) => check)
    ? "valid"
    : "invalid";
}

function findings(
  status:
    CapaKnowledgeCitationValidationStatus,
  assessment:
    CapaKnowledgeCitationAssessment,
): readonly string[] {
  const values: string[] = [];

  if (!assessment.relationship_verified) {
    values.push(
      assessment.relationship_verified === null
        ? "Citation relationship remains unresolved."
        : "The passage does not verify the stated citation relationship.",
    );
  }
  if (assessment.modality_preserved === false) {
    values.push(
      "Claim modality is stronger or different than the passage.",
    );
  }
  if (assessment.scope_preserved === false) {
    values.push(
      "Claim scope is not preserved by the passage.",
    );
  }
  if (assessment.negation_preserved === false) {
    values.push(
      "Claim negation is not preserved by the passage.",
    );
  }
  if (assessment.exceptions_preserved === false) {
    values.push(
      "Claim omits or changes a material exception.",
    );
  }
  if (status === "inaccessible") {
    values.push(
      "Source is not currently accessible to the requester.",
    );
  }
  if (status === "rights_restricted") {
    values.push(
      "Source rights prohibit excerpt rendering.",
    );
  }
  if (status === "superseded_impact") {
    values.push(
      "Source status requires supersession or withdrawal impact review.",
    );
  }

  return Object.freeze(values);
}

function renderedLabel(
  evidence:
    CapaKnowledgeAssembledEvidencePassage,
): string {
  const identity = [
    evidence.title,
    evidence.issuer,
    evidence.document_number,
    evidence.edition,
  ].filter(
    (value): value is string =>
      value !== undefined &&
      value.trim().length > 0,
  ).join(" — ");
  const locator = evidence.locators.map(
    (value) => value.label,
  ).join(", ");
  const statusWarning =
    evidence.source_status_at_use ===
      "current_effective"
      ? ""
      : ` [${evidence.source_status_at_use}]`;

  return `${identity}; ${locator}${statusWarning}`;
}

/** Constructs and validates one exact claim-specific citation. */
export function constructAndValidateCapaKnowledgeCitation(
  input: CapaKnowledgeCitationValidationInput,
): CapaKnowledgeValidatedCitation {
  if (
    input === null ||
    typeof input !== "object"
  ) {
    fail("INVALID_CITATION_INPUT");
  }

  if (
    typeof input.claim_id !== "string" ||
    !UUID_PATTERN.test(input.claim_id) ||
    typeof input.claim_text !== "string" ||
    input.claim_text.trim().length === 0 ||
    input.claim_text.length > 8_000
  ) {
    fail("INVALID_CLAIM");
  }

  if (
    typeof input.evidence_id !== "string" ||
    !UUID_PATTERN.test(input.evidence_id) ||
    !RELATIONSHIPS.has(input.relationship)
  ) {
    fail("INVALID_CITATION_INPUT");
  }

  if (
    input.evidence_package === null ||
    typeof input.evidence_package !== "object" ||
    !Array.isArray(
      input.evidence_package.passages,
    ) ||
    !validIsoTimestamp(
      input.evidence_package.completed_at,
    )
  ) {
    fail("INVALID_CITATION_INPUT");
  }

  const evidence =
    input.evidence_package.passages.find(
      (passage) =>
        passage.evidence_id ===
          input.evidence_id,
    );

  if (evidence === undefined) {
    fail("EVIDENCE_NOT_FOUND");
  }

  if (
    typeof evidence.content !== "string" ||
    !Array.isArray(evidence.locators) ||
    evidence.locators.length === 0
  ) {
    fail("INVALID_CITATION_INPUT");
  }

  if (evidence.relationship !== input.relationship) {
    fail("RELATIONSHIP_MISMATCH");
  }

  if (
    typeof input.quoted_text !== "string" ||
    input.quoted_text.trim().length === 0 ||
    input.quoted_text.length > 4_000 ||
    !evidence.content.includes(
      input.quoted_text,
    )
  ) {
    fail("QUOTED_TEXT_NOT_EXACT");
  }

  validateAssessment(input.assessment);

  if (
    !validIsoTimestamp(input.validated_at) ||
    Date.parse(input.validated_at) <
      Date.parse(
        input.evidence_package.completed_at,
      )
  ) {
    fail("INVALID_VALIDATION_TIMESTAMP");
  }

  const status = validationStatus(
    evidence,
    input.assessment,
  );
  const citation = Object.freeze({
    citation_id:
      deterministicCitationId(input),
    claim_id: input.claim_id,
    evidence_id: evidence.evidence_id,
    source_id: evidence.source_id,
    source_version_id:
      evidence.source_version_id,
    passage_id: evidence.passage_id,
    segmentation_version:
      evidence.segmentation_version,
    locators: evidence.locators,
    quoted_text_fingerprint:
      fingerprint(input.quoted_text),
    relationship: input.relationship,
    retrieval_run_id:
      input.evidence_package.retrieval_run_id,
    retrieval_rank: evidence.rank,
    source_status_at_use:
      evidence.source_status_at_use,
    validation_status: status,
    validator_version:
      CAPA_KNOWLEDGE_CITATION_VALIDATOR_VERSION,
    validated_at: input.validated_at,
    validated_by:
      input.assessment.assessed_by,
    rendered_label:
      renderedLabel(evidence),
  } satisfies CapaKnowledgeCitationRecord);

  return Object.freeze({
    citation,
    claim_text: input.claim_text,
    ...(input.assessment.source_accessible &&
      input.assessment.excerpt_permitted
      ? { quoted_text: input.quoted_text }
      : {}),
    validation_findings:
      findings(status, input.assessment),
  });
}
