import { describe, expect, it } from "vitest";
import {
  CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DISPOSITIONS,
  CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
  validateCapaRootCauseReviewReturnResponseAuthoritativeContent,
  validateCapaRootCauseReviewReturnResponseDraft,
  validateCapaRootCauseReviewReturnResponseEditableContent,
} from "../../lib/capa/domain/capa-root-cause-review-return-response";
import {
  validateCapaInvestigationActiveWorkspaceDraftSaveRequest,
} from "../../lib/capa/application/capa-investigation-active-workspace-draft-request";

const EVENT = "10000000-0000-4000-8000-000000000001";
const SOURCE = "20000000-0000-4000-8000-000000000001";
const RESULT = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const AT = "2026-09-08T12:00:00.000Z";

function editable(overrides: Record<string, unknown> = {}) {
  return {
    response_summary: "The returned concern was reviewed.",
    actions_taken: "The relevant evidence was rechecked.",
    disposition: "addressed",
    supporting_evidence_item_ids: ["E-1"],
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
    ...editable(),
    return_transition_audit_event_id: EVENT,
    source_case_version_id: SOURCE,
    resulting_case_version_id: RESULT,
    responded_by: { actor_type: "human", actor_id: USER },
    responded_at: AT,
    ...overrides,
  };
}

function authoritative(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
    ...editable(),
    return_transition_audit_event_id: EVENT,
    source_case_version_id: SOURCE,
    resulting_case_version_id: RESULT,
    responded_by: { actor_type: "human", actor_id: USER },
    responded_at: AT,
    ...overrides,
  };
}

function invalid(result: { readonly status: string; readonly reason_code?: string }, reason: string) {
  expect(result).toEqual({ status: "invalid", reason_code: reason });
}

describe("CAPA root-cause review return-response contract", () => {
  it.each(CAPA_ROOT_CAUSE_REVIEW_RETURN_RESPONSE_DISPOSITIONS)("accepts %s", (disposition) => {
    expect(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ disposition }))).toMatchObject({ status: "valid" });
    expect(validateCapaRootCauseReviewReturnResponseDraft(draft({ disposition }))).toMatchObject({ status: "valid" });
    expect(validateCapaRootCauseReviewReturnResponseAuthoritativeContent(authoritative({ disposition }))).toMatchObject({ status: "valid" });
  });

  it("rejects invalid disposition and empty text", () => {
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ disposition: "resolved" })), "INVALID_RETURN_RESPONSE_DISPOSITION");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ response_summary: "" })), "INVALID_RETURN_RESPONSE_SUMMARY");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ response_summary: "   " })), "INVALID_RETURN_RESPONSE_SUMMARY");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ actions_taken: "" })), "INVALID_RETURN_RESPONSE_ACTIONS_TAKEN");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ actions_taken: "   " })), "INVALID_RETURN_RESPONSE_ACTIONS_TAKEN");
  });

  it("rejects malformed or duplicate evidence identifiers", () => {
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ supporting_evidence_item_ids: ["E-1", "E-1"] })), "INVALID_RETURN_RESPONSE_EVIDENCE_IDS");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ supporting_evidence_item_ids: [" "] })), "INVALID_RETURN_RESPONSE_EVIDENCE_IDS");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ supporting_evidence_item_ids: [""] })), "INVALID_RETURN_RESPONSE_EVIDENCE_IDS");
  });

  it("rejects malformed cycle identifiers and unexpected fields", () => {
    invalid(validateCapaRootCauseReviewReturnResponseDraft(draft({ source_case_version_id: "not-a-uuid" })), "INVALID_RETURN_RESPONSE_CYCLE_IDENTITY");
    invalid(validateCapaRootCauseReviewReturnResponseDraft(draft({ return_transition_audit_event_id: "not-a-uuid" })), "INVALID_RETURN_RESPONSE_CYCLE_IDENTITY");
    invalid(validateCapaRootCauseReviewReturnResponseDraft({ ...draft(), browser_authority: true }), "INVALID_RETURN_RESPONSE_FIELDS");
    invalid(validateCapaRootCauseReviewReturnResponseEditableContent(editable({ responded_by: { actor_type: "human", actor_id: USER } })), "INVALID_RETURN_RESPONSE_FIELDS");
  });

  it("requires server-bound human attribution on a cycle-bound draft", () => {
    expect(validateCapaRootCauseReviewReturnResponseDraft(draft())).toMatchObject({ status: "valid", value: { responded_by: { actor_type: "human", actor_id: USER }, responded_at: AT } });
    invalid(validateCapaRootCauseReviewReturnResponseDraft(draft({ responded_by: { actor_type: "agent", actor_id: USER } })), "INVALID_RETURN_RESPONSE_RESPONDED_BY");
    invalid(validateCapaRootCauseReviewReturnResponseDraft(draft({ responded_by: { actor_type: "human", actor_id: "not-a-uuid" } })), "INVALID_RETURN_RESPONSE_RESPONDED_BY");
    invalid(validateCapaRootCauseReviewReturnResponseDraft(draft({ responded_at: "not-a-time" })), "INVALID_RETURN_RESPONSE_RESPONDED_AT");
  });

  it("does not accept attribution through the browser workspace request", () => {
    const response = editable({ responded_by: { actor_type: "human", actor_id: USER }, responded_at: AT });
    expect(validateCapaInvestigationActiveWorkspaceDraftSaveRequest({
      expected_draft_revision: null,
      evidence_assumption_ledger: { items: [] },
      root_cause_package: { hypotheses: [], root_cause_not_confirmed: null },
      root_cause_return_response: response,
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_RETURN_RESPONSE" });
  });

  it("requires the authoritative schema and server-derived human attribution shape", () => {
    invalid(validateCapaRootCauseReviewReturnResponseAuthoritativeContent(authoritative({ schema_version: "wrong" })), "INVALID_RETURN_RESPONSE_SCHEMA_VERSION");
    invalid(validateCapaRootCauseReviewReturnResponseAuthoritativeContent(authoritative({ responded_by: { actor_type: "agent", actor_id: USER } })), "INVALID_RETURN_RESPONSE_RESPONDED_BY");
    invalid(validateCapaRootCauseReviewReturnResponseAuthoritativeContent(authoritative({ responded_by: { actor_type: "human", actor_id: "not-a-uuid" } })), "INVALID_RETURN_RESPONSE_RESPONDED_BY");
    invalid(validateCapaRootCauseReviewReturnResponseAuthoritativeContent(authoritative({ responded_at: "not-a-time" })), "INVALID_RETURN_RESPONSE_RESPONDED_AT");
    invalid(validateCapaRootCauseReviewReturnResponseAuthoritativeContent({ ...authoritative(), responded_by: { actor_type: "human", actor_id: USER, actor_version: "unexpected" } }), "INVALID_RETURN_RESPONSE_RESPONDED_BY");
  });
});
