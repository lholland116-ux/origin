import type {
  ActorReference,
  OrganizationId,
} from "../domain/capa-types";

import {
  CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHMS,
  CAPA_KNOWLEDGE_ONBOARDING_STAGES,
  CAPA_KNOWLEDGE_PROCESSING_STATUSES,
  CAPA_KNOWLEDGE_QUALITY_STATUSES,
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
  CAPA_KNOWLEDGE_SOURCE_TYPES,
  CAPA_KNOWLEDGE_VISIBILITIES,
  type CapaKnowledgeFingerprintRecord,
  type CapaKnowledgeSource,
  type CapaKnowledgeSourceVersion,
} from "./capa-knowledge-contract";

/**
 * Fail-closed runtime validation for governed CAPA source registration.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * KBG-001 through KBG-009
 * ING-001 through ING-006
 * SEG-001 through SEG-005
 */

export const CAPA_KNOWLEDGE_VALIDATION_REASON_CODES = [
  "INVALID_SOURCE",
  "INVALID_SOURCE_ID",
  "INVALID_SOURCE_VERSION",
  "INVALID_SOURCE_VERSION_ID",
  "INVALID_VISIBILITY_SCOPE",
  "INVALID_VERSION_NUMBER",
  "INVALID_SOURCE_TYPE",
  "INVALID_SOURCE_METADATA",
  "INVALID_ACTOR_REFERENCE",
  "INVALID_TIMESTAMP",
  "INVALID_SOURCE_STATUS",
  "INVALID_FINGERPRINT",
  "INVALID_ONBOARDING_STAGE",
  "INVALID_PROCESSING_STATUS",
  "INVALID_QUALITY_STATUS",
  "INVALID_ACCESS_POLICY",
  "INVALID_RIGHTS_POLICY",
  "INVALID_EFFECTIVITY",
  "INVALID_SUPERSESSION",
  "APPROVAL_REQUIRED",
  "ACTIVATION_REQUIRED",
  "SOURCE_NOT_ACTIVATABLE",
] as const;

export type CapaKnowledgeValidationReasonCode =
  (typeof CAPA_KNOWLEDGE_VALIDATION_REASON_CODES)[number];

export class CapaKnowledgeValidationError
  extends Error {
  readonly reason_code:
    CapaKnowledgeValidationReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeValidationReasonCode,
  ) {
    super(
      "The governed CAPA knowledge source is invalid.",
    );
    this.name =
      "CapaKnowledgeValidationError";
    this.reason_code = reasonCode;
  }
}

export interface ValidatedCapaKnowledgeRegistration {
  readonly source:
    CapaKnowledgeSource;
  readonly source_version:
    CapaKnowledgeSourceVersion;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SHA256_PATTERN =
  /^[0-9a-f]{64}$/i;

const CONTROLLED_VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SOURCE_TYPES =
  new Set<string>(
    CAPA_KNOWLEDGE_SOURCE_TYPES,
  );
const SOURCE_STATUSES =
  new Set<string>(
    CAPA_KNOWLEDGE_SOURCE_STATUSES,
  );
const VISIBILITIES =
  new Set<string>(
    CAPA_KNOWLEDGE_VISIBILITIES,
  );
const ONBOARDING_STAGES =
  new Set<string>(
    CAPA_KNOWLEDGE_ONBOARDING_STAGES,
  );
const PROCESSING_STATUSES =
  new Set<string>(
    CAPA_KNOWLEDGE_PROCESSING_STATUSES,
  );
const QUALITY_STATUSES =
  new Set<string>(
    CAPA_KNOWLEDGE_QUALITY_STATUSES,
  );

function record(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(
  value: unknown,
  maximum = 2_000,
): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum;
}

function optionalString(
  value: unknown,
  maximum = 2_000,
): boolean {
  return value === undefined ||
    nonEmptyString(value, maximum);
}

function validUuid(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    UUID_PATTERN.test(value);
}

function validIsoTimestamp(
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      value,
    )
  ) {
    return false;
  }

  return !Number.isNaN(
    Date.parse(value),
  );
}

function optionalTimestamp(
  value: unknown,
): boolean {
  return value === undefined ||
    validIsoTimestamp(value);
}

function actorReference(
  value: unknown,
): value is ActorReference {
  const actor = record(value);

  if (actor === null) {
    return false;
  }

  return (
    actor.actor_type === "human" ||
    actor.actor_type === "service" ||
    actor.actor_type === "agent" ||
    actor.actor_type === "system"
  ) &&
    nonEmptyString(actor.actor_id, 256) &&
    optionalString(actor.actor_version, 128);
}

function fingerprint(
  value: unknown,
): value is CapaKnowledgeFingerprintRecord {
  const candidate = record(value);

  return candidate !== null &&
    CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHMS
      .includes(
        candidate.algorithm as "sha256",
      ) &&
    typeof candidate.value === "string" &&
    SHA256_PATTERN.test(candidate.value);
}

function stringArray(
  value: unknown,
  maximumItems = 1_000,
): value is readonly string[] {
  return Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every(
      (item) => nonEmptyString(item),
    );
}

function accessPolicy(
  value: unknown,
): boolean {
  const policy = record(value);

  return policy !== null &&
    nonEmptyString(
      policy.policy_version,
      128,
    ) &&
    CONTROLLED_VERSION_PATTERN.test(
      policy.policy_version as string,
    ) &&
    stringArray(policy.permitted_role_ids) &&
    stringArray(policy.permitted_site_ids) &&
    stringArray(policy.permitted_product_ids) &&
    nonEmptyString(policy.sensitivity, 128) &&
    typeof policy.export_permitted ===
      "boolean" &&
    typeof policy.excerpt_permitted ===
      "boolean" &&
    typeof policy.redistribution_permitted ===
      "boolean";
}

function rightsPolicy(
  value: unknown,
): boolean {
  const rights = record(value);

  return rights !== null &&
    nonEmptyString(
      rights.rights_classification,
      128,
    ) &&
    optionalString(
      rights.license_reference,
    ) &&
    nonEmptyString(
      rights.retention_policy,
      128,
    ) &&
    typeof rights.legal_hold ===
      "boolean";
}

function fail(
  reason:
    CapaKnowledgeValidationReasonCode,
): never {
  throw new CapaKnowledgeValidationError(
    reason,
  );
}

export function validateCapaKnowledgeRegistration(
  sourceInput: unknown,
  sourceVersionInput: unknown,
): ValidatedCapaKnowledgeRegistration {
  const source = record(sourceInput);
  const sourceVersion =
    record(sourceVersionInput);

  if (source === null) {
    fail("INVALID_SOURCE");
  }

  if (!validUuid(source.source_id)) {
    fail("INVALID_SOURCE_ID");
  }

  if (
    !VISIBILITIES.has(
      source.visibility as string,
    )
  ) {
    fail("INVALID_VISIBILITY_SCOPE");
  }

  if (
    !actorReference(source.owner) ||
    !actorReference(source.created_by)
  ) {
    fail("INVALID_ACTOR_REFERENCE");
  }

  if (!validIsoTimestamp(source.created_at)) {
    fail("INVALID_TIMESTAMP");
  }

  if (sourceVersion === null) {
    fail("INVALID_SOURCE_VERSION");
  }

  if (
    !validUuid(
      sourceVersion.source_version_id,
    ) ||
    sourceVersion.source_version_id ===
      source.source_id
  ) {
    fail("INVALID_SOURCE_VERSION_ID");
  }

  if (
    sourceVersion.source_id !==
      source.source_id
  ) {
    fail("INVALID_SOURCE_VERSION_ID");
  }

  const organizationId =
    source.organization_id;
  const versionOrganizationId =
    sourceVersion.organization_id;

  if (
    source.visibility === "organization"
      ? !validUuid(organizationId) ||
        versionOrganizationId !==
          organizationId
      : organizationId !== undefined ||
        versionOrganizationId !== undefined
  ) {
    fail("INVALID_VISIBILITY_SCOPE");
  }

  if (
    !Number.isSafeInteger(
      sourceVersion.version_number,
    ) ||
    (sourceVersion.version_number as number) < 1
  ) {
    fail("INVALID_VERSION_NUMBER");
  }

  if (
    !SOURCE_TYPES.has(
      sourceVersion.source_type as string,
    )
  ) {
    fail("INVALID_SOURCE_TYPE");
  }

  if (
    !nonEmptyString(sourceVersion.title) ||
    !nonEmptyString(sourceVersion.issuer) ||
    !optionalString(sourceVersion.publisher) ||
    !nonEmptyString(sourceVersion.jurisdiction, 256) ||
    !optionalString(sourceVersion.region, 256) ||
    !optionalString(sourceVersion.document_number, 256) ||
    !optionalString(sourceVersion.edition, 256) ||
    !nonEmptyString(sourceVersion.language, 64) ||
    !nonEmptyString(sourceVersion.translation_status, 128) ||
    !nonEmptyString(sourceVersion.authority_class, 128) ||
    !nonEmptyString(sourceVersion.origin, 128) ||
    !nonEmptyString(sourceVersion.canonical_locator, 4_000) ||
    !stringArray(sourceVersion.applicability_tags) ||
    !stringArray(sourceVersion.quality_notes)
  ) {
    fail("INVALID_SOURCE_METADATA");
  }

  if (
    !SOURCE_STATUSES.has(
      sourceVersion.status as string,
    )
  ) {
    fail("INVALID_SOURCE_STATUS");
  }

  if (
    !fingerprint(
      sourceVersion.content_fingerprint,
    )
  ) {
    fail("INVALID_FINGERPRINT");
  }

  if (
    !ONBOARDING_STAGES.has(
      sourceVersion.onboarding_stage as string,
    )
  ) {
    fail("INVALID_ONBOARDING_STAGE");
  }

  if (
    !PROCESSING_STATUSES.has(
      sourceVersion.processing_status as string,
    ) ||
    !nonEmptyString(
      sourceVersion.processing_version,
      128,
    ) ||
    !CONTROLLED_VERSION_PATTERN.test(
      sourceVersion.processing_version as string,
    )
  ) {
    fail("INVALID_PROCESSING_STATUS");
  }

  if (
    !QUALITY_STATUSES.has(
      sourceVersion.quality_status as string,
    )
  ) {
    fail("INVALID_QUALITY_STATUS");
  }

  if (!accessPolicy(sourceVersion.access_policy)) {
    fail("INVALID_ACCESS_POLICY");
  }

  if (!rightsPolicy(sourceVersion.rights)) {
    fail("INVALID_RIGHTS_POLICY");
  }

  if (
    !optionalTimestamp(sourceVersion.effective_at) ||
    !optionalTimestamp(sourceVersion.retirement_at) ||
    !optionalTimestamp(sourceVersion.next_review_at) ||
    !optionalTimestamp(sourceVersion.approved_at) ||
    !optionalTimestamp(sourceVersion.activated_at) ||
    !validIsoTimestamp(sourceVersion.created_at)
  ) {
    fail("INVALID_TIMESTAMP");
  }

  if (
    sourceVersion.effective_at !== undefined &&
    sourceVersion.retirement_at !== undefined &&
    Date.parse(sourceVersion.retirement_at as string) <=
      Date.parse(sourceVersion.effective_at as string)
  ) {
    fail("INVALID_EFFECTIVITY");
  }

  if (
    sourceVersion.supersedes_source_version_id !== undefined &&
    !validUuid(
      sourceVersion.supersedes_source_version_id,
    )
  ) {
    fail("INVALID_SUPERSESSION");
  }

  if (
    sourceVersion.superseded_by_source_version_id !== undefined &&
    !validUuid(
      sourceVersion.superseded_by_source_version_id,
    )
  ) {
    fail("INVALID_SUPERSESSION");
  }

  if (
    sourceVersion.supersedes_source_version_id !== undefined &&
    sourceVersion.supersedes_source_version_id ===
      sourceVersion.superseded_by_source_version_id
  ) {
    fail("INVALID_SUPERSESSION");
  }

  const approved =
    sourceVersion.approved_at !== undefined &&
    actorReference(sourceVersion.approved_by);

  if (
    sourceVersion.onboarding_stage === "approved" &&
    !approved
  ) {
    fail("APPROVAL_REQUIRED");
  }

  if (
    sourceVersion.onboarding_stage === "active" &&
    !approved
  ) {
    fail("APPROVAL_REQUIRED");
  }

  if (
    sourceVersion.onboarding_stage === "active" &&
    sourceVersion.activated_at === undefined
  ) {
    fail("ACTIVATION_REQUIRED");
  }

  if (
    sourceVersion.status === "current_effective" &&
    (
      sourceVersion.onboarding_stage !== "active" ||
      sourceVersion.activated_at === undefined ||
      sourceVersion.effective_at === undefined ||
      !approved ||
      (
        sourceVersion.processing_status !== "pass" &&
        sourceVersion.processing_status !==
          "pass_with_limitations"
      ) ||
      (
        sourceVersion.quality_status !== "pass" &&
        sourceVersion.quality_status !==
          "pass_with_limitations"
      )
    )
  ) {
    fail("SOURCE_NOT_ACTIVATABLE");
  }

  if (
    sourceVersion.status === "superseded" &&
    sourceVersion.superseded_by_source_version_id ===
      undefined
  ) {
    fail("INVALID_SUPERSESSION");
  }

  return Object.freeze({
    source:
      sourceInput as CapaKnowledgeSource,
    source_version:
      sourceVersionInput as
        CapaKnowledgeSourceVersion,
  });
}

export function assertCapaKnowledgeOrganizationScope(
  expectedOrganizationId:
    OrganizationId,
  source:
    CapaKnowledgeSource,
): void {
  if (
    source.visibility !== "organization" ||
    source.organization_id !==
      expectedOrganizationId
  ) {
    fail("INVALID_VISIBILITY_SCOPE");
  }
}
