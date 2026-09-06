import { describe, expect, it } from "vitest";

import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_PROPOSAL_FIELDS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES,
  type RawCapaRootCauseReviewAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-contract";

describe("CAPA S50 root-cause review advisory contract", () => {
  it("publishes the governed AG-REVIEW packet identity and fields", () => {
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT).toBe(
      "review_packet_draft",
    );
    expect(
      CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
    ).toBe("capa_review_packet_draft-1.0.0");
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_PROPOSAL_FIELDS).toEqual([
      "neutral_review_summary",
      "version_changes",
      "blockers_warnings",
      "evidence_map",
    ]);
  });

  it("publishes explicit neutral review vocabularies", () => {
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES).toEqual([
      "added",
      "removed",
      "modified",
      "unchanged",
      "not_established",
    ]);
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS).toEqual([
      "observed_issue",
      "review_warning",
      "authoritative_source_reported_blocker",
    ]);
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS).toEqual([
      "supports",
      "contradicts",
      "missing_support",
    ]);
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES).toEqual([
      "source_reported",
      "not_established",
      "not_provided",
    ]);
    expect(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES).toContain(
      "source_status_uncertain",
    );
  });

  it("defines literal advisory-only and no-mutation controls", () => {
    const raw = {
      schema_version:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      status: "completed_draft",
      proposal: {
        neutral_review_summary:
          "The submitted package is available for human review.",
        version_changes: [],
        blockers_warnings: [],
        evidence_map: [],
      },
      uncertainty_and_limitations: [],
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      review_disposition: null,
      workflow_transition: null,
      human_acceptance_required: true,
    } satisfies RawCapaRootCauseReviewAdvisoryModelOutput;

    expect(raw.advisory_only).toBe(true);
    expect(raw.workflow_mutated).toBe(false);
    expect(raw.controlled_record_mutated).toBe(false);
    expect(raw.review_disposition).toBeNull();
    expect(raw.workflow_transition).toBeNull();
    expect(raw.human_acceptance_required).toBe(true);
  });
});
