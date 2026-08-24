import type {
  ActorReference,
  IsoDateTime,
} from "../domain/capa-types";

import {
  CAPA_KNOWLEDGE_SOURCE_TYPES,
  type CapaKnowledgeCollectionVersion,
  type CapaKnowledgePassage,
  type CapaKnowledgeSource,
  type CapaKnowledgeSourceVersion,
} from "./capa-knowledge-contract";

import {
  CAPA_KNOWLEDGE_RETRIEVAL_METHODS,
  type CapaKnowledgeCandidateExclusionReason,
  type CapaKnowledgeRetrievalRequest,
} from "./capa-knowledge-retrieval-contract";

/**
 * Fail-closed validation and pre-disclosure eligibility for governed CAPA
 * retrieval.
 *
 * Primary source:
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 *
 * Traceability:
 * IDX-001, IDX-005 through IDX-008
 * RET-001 through RET-003, RET-008 through RET-011
 * KRC-AC-002, KRC-AC-003 and KRC-AC-006
 */

export const CAPA_KNOWLEDGE_RETRIEVAL_VALIDATION_REASON_CODES = [
  "INVALID_RETRIEVAL_REQUEST",
  "INVALID_RETRIEVAL_ID",
  "INVALID_REQUEST_TRACE",
  "INVALID_RETRIEVAL_SCOPE",
  "INVALID_RETRIEVAL_ACTOR",
  "INVALID_COLLECTION_REFERENCE",
  "INVALID_QUERY",
  "INVALID_QUERY_FINGERPRINT",
  "INVALID_RETRIEVAL_FILTERS",
  "INVALID_RETRIEVAL_POLICY",
  "INVALID_TIMESTAMP",
] as const;

export type CapaKnowledgeRetrievalValidationReasonCode =
  (typeof CAPA_KNOWLEDGE_RETRIEVAL_VALIDATION_REASON_CODES)[number];

export class CapaKnowledgeRetrievalValidationError
  extends Error {
  readonly reason_code:
    CapaKnowledgeRetrievalValidationReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeRetrievalValidationReasonCode,
  ) {
    super(
      "The governed CAPA knowledge retrieval request is invalid.",
    );
    this.name =
      "CapaKnowledgeRetrievalValidationError";
    this.reason_code = reasonCode;
  }
}

export type CapaKnowledgeEligibilityDecision =
  | {
      readonly eligible: true;
    }
  | {
      readonly eligible: false;
      readonly reason_code:
        CapaKnowledgeCandidateExclusionReason;
    };

export interface CapaKnowledgeEligibilityInput {
  readonly request:
    CapaKnowledgeRetrievalRequest;
  readonly collection:
    CapaKnowledgeCollectionVersion;
  readonly source:
    CapaKnowledgeSource;
  readonly source_version:
    CapaKnowledgeSourceVersion;
  readonly passage:
    CapaKnowledgePassage;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTROLLED_VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SOURCE_TYPES =
  new Set<string>(
    CAPA_KNOWLEDGE_SOURCE_TYPES,
  );

const RETRIEVAL_METHODS =
  new Set<string>(
    CAPA_KNOWLEDGE_RETRIEVAL_METHODS,
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

function validUuid(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    UUID_PATTERN.test(value);
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
  value: unknown,
): value is ActorReference {
  const actor = record(value);

  return actor !== null &&
    ["human", "service", "agent", "system"].includes(
      actor.actor_type as string,
    ) &&
    nonEmptyString(actor.actor_id, 256) &&
    (
      actor.actor_version === undefined ||
      nonEmptyString(
        actor.actor_version,
        128,
      )
    );
}

function uniqueStringArray(
  value: unknown,
  maximumItems = 1_000,
): value is readonly string[] {
  return Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every(
      (item) => nonEmptyString(item, 256),
    ) &&
    new Set(value).size === value.length;
}

function version(
  value: unknown,
): value is string {
  return nonEmptyString(value, 128) &&
    CONTROLLED_VERSION_PATTERN.test(value);
}

function positiveInteger(
  value: unknown,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= maximum;
}

function score(
  value: unknown,
): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;
}

function fail(
  reason:
    CapaKnowledgeRetrievalValidationReasonCode,
): never {
  throw new CapaKnowledgeRetrievalValidationError(
    reason,
  );
}

/**
 * Validates the complete trusted application request before any provider,
 * index, repository or passage-content operation is attempted.
 */
export function validateCapaKnowledgeRetrievalRequest(
  input: unknown,
): CapaKnowledgeRetrievalRequest {
  const request = record(input);

  if (request === null) {
    fail("INVALID_RETRIEVAL_REQUEST");
  }

  if (
    !validUuid(request.retrieval_run_id) ||
    !validUuid(request.query_id) ||
    request.retrieval_run_id ===
      request.query_id
  ) {
    fail("INVALID_RETRIEVAL_ID");
  }

  const trace = record(request.request_trace);

  if (
    trace === null ||
    !nonEmptyString(trace.request_id, 256) ||
    !nonEmptyString(
      trace.correlation_id,
      256,
    ) ||
    (
      trace.idempotency_key !== undefined &&
      !nonEmptyString(
        trace.idempotency_key,
        256,
      )
    )
  ) {
    fail("INVALID_REQUEST_TRACE");
  }

  const scope = record(request.scope);

  if (
    scope === null ||
    !validUuid(scope.organization_id) ||
    typeof scope.approved_global_sources_permitted !==
      "boolean" ||
    !uniqueStringArray(scope.active_role_ids, 100) ||
    scope.active_role_ids.length === 0 ||
    !uniqueStringArray(scope.permitted_site_ids, 1_000) ||
    !uniqueStringArray(
      scope.permitted_product_ids,
      1_000,
    )
  ) {
    fail("INVALID_RETRIEVAL_SCOPE");
  }

  if (!actorReference(scope.actor)) {
    fail("INVALID_RETRIEVAL_ACTOR");
  }

  if (
    !validUuid(scope.collection_id) ||
    !validUuid(scope.collection_version_id) ||
    scope.collection_id ===
      scope.collection_version_id
  ) {
    fail("INVALID_COLLECTION_REFERENCE");
  }

  if (
    !nonEmptyString(request.task_type, 128) ||
    !nonEmptyString(request.query_text, 8_000)
  ) {
    fail("INVALID_QUERY");
  }

  const fingerprint =
    record(request.query_fingerprint);

  if (
    fingerprint === null ||
    fingerprint.algorithm !== "sha256" ||
    typeof fingerprint.value !== "string" ||
    !/^[0-9a-f]{64}$/i.test(
      fingerprint.value,
    )
  ) {
    fail("INVALID_QUERY_FINGERPRINT");
  }

  const filters = record(request.filters);

  if (
    filters === null ||
    !validIsoTimestamp(filters.effective_at) ||
    typeof filters.historical_source_versions_permitted !==
      "boolean" ||
    (
      filters.source_types !== undefined &&
      (
        !uniqueStringArray(
          filters.source_types,
          CAPA_KNOWLEDGE_SOURCE_TYPES.length,
        ) ||
        !filters.source_types.every(
          (sourceType) =>
            SOURCE_TYPES.has(sourceType),
        )
      )
    ) ||
    (
      filters.jurisdictions !== undefined &&
      !uniqueStringArray(
        filters.jurisdictions,
        100,
      )
    ) ||
    (
      filters.applicability_tags !== undefined &&
      !uniqueStringArray(
        filters.applicability_tags,
        1_000,
      )
    )
  ) {
    fail("INVALID_RETRIEVAL_FILTERS");
  }

  const policy = record(request.policy);

  if (
    policy === null ||
    !version(policy.retrieval_policy_version) ||
    !version(
      policy.source_precedence_policy_version,
    ) ||
    !version(policy.query_construction_version) ||
    !version(policy.ranking_policy_version) ||
    !version(policy.citation_policy_version) ||
    !RETRIEVAL_METHODS.has(
      policy.retrieval_method as string,
    ) ||
    !positiveInteger(
      policy.maximum_candidates,
      1_000,
    ) ||
    !positiveInteger(
      policy.maximum_results,
      100,
    ) ||
    (policy.maximum_results as number) >
      (policy.maximum_candidates as number) ||
    !positiveInteger(
      policy.maximum_total_characters,
      200_000,
    ) ||
    !score(policy.minimum_relevance_score)
  ) {
    fail("INVALID_RETRIEVAL_POLICY");
  }

  if (!validIsoTimestamp(request.requested_at)) {
    fail("INVALID_TIMESTAMP");
  }

  return input as CapaKnowledgeRetrievalRequest;
}

function excluded(
  reasonCode:
    CapaKnowledgeCandidateExclusionReason,
): CapaKnowledgeEligibilityDecision {
  return Object.freeze({
    eligible: false,
    reason_code: reasonCode,
  });
}

function allowlistPermits(
  allowlist: readonly string[],
  actual: readonly string[],
): boolean {
  return allowlist.length === 0 ||
    actual.some(
      (value) => allowlist.includes(value),
    );
}

function organizationMatches(
  expected: string,
  actual: string | undefined,
  globalPermitted: boolean,
): boolean {
  return actual === undefined
    ? globalPermitted
    : actual === expected;
}

/**
 * Evaluates one material passage before content disclosure. The caller must
 * use only eligible passages and retain excluded decisions in candidate trace.
 */
export function evaluateCapaKnowledgeRetrievalEligibility(
  input: CapaKnowledgeEligibilityInput,
): CapaKnowledgeEligibilityDecision {
  const {
    request,
    collection,
    source,
    source_version: sourceVersion,
    passage,
  } = input;
  const scope = request.scope;
  const globalPermitted =
    scope.approved_global_sources_permitted;

  if (
    collection.collection_id !==
      scope.collection_id ||
    collection.collection_version_id !==
      scope.collection_version_id ||
    !organizationMatches(
      scope.organization_id,
      collection.organization_id,
      globalPermitted,
    ) ||
    Date.parse(collection.effective_at) >
      Date.parse(request.filters.effective_at) ||
    (
      collection.retired_at !== undefined &&
      Date.parse(collection.retired_at) <=
        Date.parse(request.filters.effective_at)
    )
  ) {
    return excluded(
      "COLLECTION_VERSION_MISMATCH",
    );
  }

  if (
    !organizationMatches(
      scope.organization_id,
      source.organization_id,
      globalPermitted,
    ) ||
    !organizationMatches(
      scope.organization_id,
      sourceVersion.organization_id,
      globalPermitted,
    ) ||
    !organizationMatches(
      scope.organization_id,
      passage.organization_id,
      globalPermitted,
    )
  ) {
    return excluded(
      "TENANT_SCOPE_MISMATCH",
    );
  }

  if (
    sourceVersion.source_id !== source.source_id ||
    passage.source_version_id !==
      sourceVersion.source_version_id ||
    !collection.source_version_ids.includes(
      sourceVersion.source_version_id,
    )
  ) {
    return excluded(
      "COLLECTION_VERSION_MISMATCH",
    );
  }

  const historicalEligible =
    request.filters
      .historical_source_versions_permitted &&
    sourceVersion.status === "superseded";

  if (
    sourceVersion.status !==
      "current_effective" &&
    !historicalEligible ||
    sourceVersion.onboarding_stage !== "active" ||
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
  ) {
    return excluded(
      "SOURCE_STATUS_INELIGIBLE",
    );
  }

  if (
    sourceVersion.effective_at === undefined ||
    Date.parse(sourceVersion.effective_at) >
      Date.parse(request.filters.effective_at) ||
    (
      sourceVersion.retirement_at !== undefined &&
      Date.parse(sourceVersion.retirement_at) <=
        Date.parse(request.filters.effective_at) &&
      !historicalEligible
    )
  ) {
    return excluded("EFFECTIVITY_MISMATCH");
  }

  if (
    !allowlistPermits(
      sourceVersion.access_policy
        .permitted_role_ids,
      scope.active_role_ids,
    )
  ) {
    return excluded("ROLE_ACCESS_DENIED");
  }

  if (
    !allowlistPermits(
      sourceVersion.access_policy
        .permitted_site_ids,
      scope.permitted_site_ids,
    ) ||
    !allowlistPermits(
      sourceVersion.access_policy
        .permitted_product_ids,
      scope.permitted_product_ids,
    )
  ) {
    return excluded(
      "APPLICABILITY_MISMATCH",
    );
  }

  if (
    !sourceVersion.access_policy.excerpt_permitted
  ) {
    return excluded("LICENSE_ACCESS_DENIED");
  }

  const filters = request.filters;

  if (
    filters.source_types !== undefined &&
    !filters.source_types.includes(
      sourceVersion.source_type,
    )
  ) {
    return excluded(
      "APPLICABILITY_MISMATCH",
    );
  }

  if (
    filters.jurisdictions !== undefined &&
    !filters.jurisdictions.includes(
      sourceVersion.jurisdiction,
    )
  ) {
    return excluded(
      "JURISDICTION_MISMATCH",
    );
  }

  if (
    filters.applicability_tags !== undefined &&
    !filters.applicability_tags.some(
      (tag) =>
        sourceVersion.applicability_tags
          .includes(tag),
    )
  ) {
    return excluded(
      "APPLICABILITY_MISMATCH",
    );
  }

  if (
    passage.quality_status !== "pass" &&
    passage.quality_status !==
      "pass_with_limitations"
  ) {
    return excluded(
      "PASSAGE_QUALITY_INELIGIBLE",
    );
  }

  if (!passage.machine_interpretable) {
    return excluded(
      "PASSAGE_NOT_MACHINE_INTERPRETABLE",
    );
  }

  if (
    passage.content.trim().length === 0 ||
    passage.locators.length === 0
  ) {
    return excluded(
      passage.content.trim().length === 0
        ? "PASSAGE_UNAVAILABLE"
        : "LOCATOR_VALIDATION_FAILED",
    );
  }

  return Object.freeze({
    eligible: true,
  });
}
