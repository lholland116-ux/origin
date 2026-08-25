import type {
  ActorReference,
  OrganizationId,
  RequestTrace,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "../ai/capa-prompt-contract";

import type {
  CapaKnowledgeSourceStatus,
} from "./capa-knowledge-contract";

import type {
  CapaKnowledgeCitationId,
} from "./capa-knowledge-retrieval-contract";

import type {
  CapaKnowledgeCitationReviewDisposition,
  CapaKnowledgeCitationReviewRecord,
} from "./capa-knowledge-citation-review-contract";

import {
  constructCapaKnowledgeCitationReview,
} from "./capa-knowledge-citation-review-validator";

import type {
  AppendCapaKnowledgeCitationReviewResult,
  CapaKnowledgeCitationReviewRepository,
  CapaKnowledgeStoredCitation,
} from "../../database/repositories/capa-knowledge-citation-review-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

/**
 * Provider-neutral orchestration for one attributable human citation review.
 *
 * The service never trusts a client-supplied citation snapshot or source
 * status. It reloads the immutable stored citation, resolves the exact
 * source-version status, uses trusted server time and appends the review in a
 * controlled transaction. It does not approve a CAPA or change workflow state.
 *
 * Traceability:
 * KUI-001 through KUI-010
 * CIT-001 through CIT-012
 * HRUI-E-005, HRUI-A-003 and HRUI-AT-007
 */

export const CAPA_KNOWLEDGE_CITATION_REVIEW_SERVICE_REASON_CODES = [
  "HUMAN_REVIEW_NOT_AUTHORIZED",
  "CITATION_NOT_FOUND_OR_NOT_AUTHORIZED",
  "SOURCE_STATUS_NOT_FOUND_OR_NOT_AUTHORIZED",
  "INVALID_TRUSTED_REVIEW_TIME",
  "CITATION_REVIEW_CONFLICT",
  "CITATION_REVIEW_PERSISTENCE_FAILURE",
] as const;

export type CapaKnowledgeCitationReviewServiceReasonCode =
  (typeof CAPA_KNOWLEDGE_CITATION_REVIEW_SERVICE_REASON_CODES)[number];

export class CapaKnowledgeCitationReviewServiceError extends Error {
  readonly reason_code: CapaKnowledgeCitationReviewServiceReasonCode;

  constructor(reasonCode: CapaKnowledgeCitationReviewServiceReasonCode) {
    super("The governed CAPA citation-review operation failed.");
    this.name = "CapaKnowledgeCitationReviewServiceError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeCitationHumanReviewAuthorizer {
  authorizeCitationReview(input: {
    readonly organization_id: OrganizationId;
    readonly citation_id: CapaKnowledgeCitationId;
    readonly reviewer: ActorReference;
  }): Promise<boolean>;
}

export interface CapaKnowledgeCitationReviewSourceStatusResolver {
  resolveSourceStatus(input: {
    readonly organization_id: OrganizationId;
    readonly source_id: CapaKnowledgeCitationReviewRecord["source_id"];
    readonly source_version_id:
      CapaKnowledgeCitationReviewRecord["source_version_id"];
  }): Promise<CapaKnowledgeSourceStatus | null>;
}

export interface CapaKnowledgeCitationReviewServiceDependencies {
  readonly repository: CapaKnowledgeCitationReviewRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorizer: CapaKnowledgeCitationHumanReviewAuthorizer;
  readonly source_status_resolver:
    CapaKnowledgeCitationReviewSourceStatusResolver;
  readonly now: () => Date;
}

export interface SubmitCapaKnowledgeCitationReviewInput {
  readonly organization_id: OrganizationId;
  readonly citation_id: CapaKnowledgeCitationId;
  readonly disposition: CapaKnowledgeCitationReviewDisposition;
  readonly rationale: string;
  readonly reviewed_by: ActorReference;
  readonly request_trace: RequestTrace;
  readonly review_policy_version?: ControlledVersion;
}

export interface SubmitCapaKnowledgeCitationReviewResult {
  readonly status: "recorded" | "already_recorded";
  readonly review: CapaKnowledgeCitationReviewRecord;
}

function fail(
  reasonCode: CapaKnowledgeCitationReviewServiceReasonCode,
): never {
  throw new CapaKnowledgeCitationReviewServiceError(reasonCode);
}

export class CapaKnowledgeCitationReviewService {
  constructor(
    private readonly dependencies:
      CapaKnowledgeCitationReviewServiceDependencies,
  ) {}

  async submitHumanReview(
    input: SubmitCapaKnowledgeCitationReviewInput,
  ): Promise<SubmitCapaKnowledgeCitationReviewResult> {
    if (input.reviewed_by.actor_type !== "human") {
      fail("HUMAN_REVIEW_NOT_AUTHORIZED");
    }

    let authorized: boolean;
    try {
      authorized = await this.dependencies.authorizer.authorizeCitationReview({
        organization_id: input.organization_id,
        citation_id: input.citation_id,
        reviewer: input.reviewed_by,
      });
    } catch {
      fail("HUMAN_REVIEW_NOT_AUTHORIZED");
    }

    if (!authorized) {
      fail("HUMAN_REVIEW_NOT_AUTHORIZED");
    }

    let storedCitation: CapaKnowledgeStoredCitation | null;
    try {
      storedCitation = await this.dependencies.repository.findCitationById(
        input.organization_id,
        input.citation_id,
      );
    } catch {
      fail("CITATION_REVIEW_PERSISTENCE_FAILURE");
    }

    if (storedCitation === null) {
      fail("CITATION_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    let sourceStatus: CapaKnowledgeSourceStatus | null;
    try {
      sourceStatus =
        await this.dependencies.source_status_resolver.resolveSourceStatus({
          organization_id: input.organization_id,
          source_id: storedCitation.citation.source_id,
          source_version_id: storedCitation.citation.source_version_id,
        });
    } catch {
      fail("SOURCE_STATUS_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    if (sourceStatus === null) {
      fail("SOURCE_STATUS_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    let now: Date;
    try {
      now = this.dependencies.now();
    } catch {
      fail("INVALID_TRUSTED_REVIEW_TIME");
    }
    if (Number.isNaN(now.getTime())) {
      fail("INVALID_TRUSTED_REVIEW_TIME");
    }

    const review = constructCapaKnowledgeCitationReview({
      organization_id: input.organization_id,
      citation: storedCitation.citation,
      source_status_at_review: sourceStatus,
      disposition: input.disposition,
      rationale: input.rationale,
      reviewed_at: now.toISOString() as
        CapaKnowledgeCitationReviewRecord["reviewed_at"],
      reviewed_by: input.reviewed_by,
      ...(input.review_policy_version === undefined
        ? {}
        : { review_policy_version: input.review_policy_version }),
    });

    let appendResult: AppendCapaKnowledgeCitationReviewResult;
    try {
      appendResult = await this.dependencies.transaction_manager.runInTransaction(
        input.request_trace,
        (transaction) =>
          this.dependencies.repository.appendReview(transaction, review),
      );
    } catch {
      fail("CITATION_REVIEW_PERSISTENCE_FAILURE");
    }

    if (appendResult.status === "appended") {
      return Object.freeze({ status: "recorded", review });
    }

    if (appendResult.status === "already_recorded") {
      return Object.freeze({ status: "already_recorded", review });
    }

    if (appendResult.status === "citation_not_found_or_not_authorized") {
      fail("CITATION_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    fail("CITATION_REVIEW_CONFLICT");
  }
}

export function createCapaKnowledgeCitationReviewService(
  dependencies: CapaKnowledgeCitationReviewServiceDependencies,
): CapaKnowledgeCitationReviewService {
  return new CapaKnowledgeCitationReviewService(dependencies);
}
