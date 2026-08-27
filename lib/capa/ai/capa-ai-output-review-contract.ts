import type {
  ActorReference,
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaIntakeAdvisoryProposal,
  CapaIntakeAdvisoryResponse,
} from "./capa-intake-advisory-contract";

/**
 * Immutable human disposition of one governed CAPA AI advisory output.
 *
 * The review is not CAPA approval and cannot transition workflow or mutate
 * controlled CAPA content.
 *
 * Traceability:
 * URS-AI-003
 * URS-AI-004
 * URS-WF-005 through URS-WF-007
 * SRS-REV-001 through SRS-REV-006
 * HRUI-D-001 through HRUI-D-008
 * HF-01, HF-02
 */
type CapaAiOutputReviewIdentity<Name extends string> =
  string & {
    readonly __brand: Name;
  };

export type CapaAiOutputReviewId =
  CapaAiOutputReviewIdentity<
    "CapaAiOutputReviewId"
  >;

export const CAPA_AI_OUTPUT_REVIEW_DECISIONS = [
  "accept",
  "reject",
  "revise",
] as const;

export type CapaAiOutputReviewDecision =
  (typeof CAPA_AI_OUTPUT_REVIEW_DECISIONS)[number];

export const CAPA_AI_OUTPUT_REVIEW_POLICY_VERSION =
  "capa-ai-output-review-1.0.0" as
    ControlledVersion;

/**
 * Browser request.
 *
 * The browser supplies human intent and optimistic-concurrency values only.
 * Organization, reviewer authority, AI-output provenance and current CAPA
 * state are re-resolved by trusted server code.
 */
export interface CapaAiOutputReviewBrowserRequest {
  readonly decision:
    CapaAiOutputReviewDecision;

  readonly rationale?:
    string | null;

  readonly human_revision?:
    CapaIntakeAdvisoryProposal | null;

  readonly expected_case_version_id:
    CapaCaseVersionId;

  readonly expected_record_version:
    number;
}

/**
 * Immutable review record persisted after server-side authorization,
 * AI-output reload and stale-state checks.
 */
export interface CapaAiOutputReviewRecord {
  readonly review_id:
    CapaAiOutputReviewId;

  readonly organization_id:
    OrganizationId;

  readonly output_id:
    CapaIntakeAdvisoryResponse["output_id"];

  readonly capa_case_id:
    CapaCaseId;

  readonly case_version_id:
    CapaCaseVersionId;

  readonly record_version:
    number;

  readonly decision:
    CapaAiOutputReviewDecision;

  readonly rationale:
    string | null;

  readonly human_revision:
    CapaIntakeAdvisoryProposal | null;

  readonly reviewed_at:
    IsoDateTime;

  readonly reviewed_by:
    ActorReference & {
      readonly actor_type: "human";
    };

  readonly review_policy_version:
    ControlledVersion;

  readonly request_id:
    RequestId;

  readonly correlation_id:
    CorrelationId;

  readonly idempotency_key:
    IdempotencyKey;

  /**
   * Human review is deliberately separate from controlled CAPA mutation.
   */
  readonly workflow_mutated:
    false;

  readonly controlled_record_mutated:
    false;

  /**
   * Accept means accepted for this review purpose only.
   */
  readonly gate_approved:
    false;
}
