import { describe, expect, it } from "vitest";
import {
  CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES,
  CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-contract";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";
import {
  evaluateCapaImplementationSubmissionReadiness,
  validateCapaImplementationApprovedS70BaselineReference,
  validateCapaImplementationDraftAgainstApprovedActionSet,
  validateCapaImplementationEvidence,
  validateCapaImplementationWorkspaceDraft,
} from "../../lib/capa/implementation/capa-implementation-validator";

const CASE_VERSION = "10000000-0000-4000-8000-000000000001";
const ACTION_SECTION = "10000000-0000-4000-8000-000000000002";
const APPROVAL_AUDIT = "10000000-0000-4000-8000-000000000003";
const RETURN_AUDIT = "10000000-0000-4000-8000-000000000004";
const RESULTING_VERSION = "10000000-0000-4000-8000-000000000005";

function source(overrides: Record<string, unknown> = {}) {
  return {
    origin_kind: "uploaded_artifact",
    source_system_kind: "other",
    source_system_name: "Document store",
    source_record_reference: "TR-001",
    source_record_version: "1",
    artifact_reference: "artifact://TR-001",
    ...overrides,
  };
}

function evidence(
  overrides: Record<string, unknown> = {},
) {
  return {
    schema_version: CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
    evidence_id: "20000000-0000-4000-8000-000000000001",
    approved_action_reference: "ACTION-1",
    evidence_kind: "training_record",
    description: "Training completion record",
    evidence_date: "2026-09-10",
    source: source(),
    ...overrides,
  };
}

function action(
  overrides: Record<string, unknown> = {},
) {
  return {
    approved_action_reference: "ACTION-1",
    owner_reported_status: "in_progress",
    implementation_narrative: "Implementation is underway.",
    blocked_reason: null,
    evidence: [],
    ...overrides,
  };
}

function draft(
  overrides: Record<string, unknown> = {},
) {
  return {
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    action_progress: [],
    implementation_review_return_response: null,
    ...overrides,
  };
}

function returnResponse(
  overrides: Record<string, unknown> = {},
) {
  return {
    schema_version:
      CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
    return_transition_audit_event_id: RETURN_AUDIT,
    source_case_version_id: CASE_VERSION,
    resulting_case_version_id: RESULTING_VERSION,
    response_narrative: "The returned implementation comments were addressed.",
    ...overrides,
  };
}

function blockerCodes(value: unknown): readonly string[] {
  return typeof value === "object" && value !== null && "blocker_codes" in value && Array.isArray(value.blocker_codes)
    ? value.blocker_codes as readonly string[]
    : [];
}

describe("S80 implementation domain contracts", () => {
  it("A/B: accepts a valid first-entry draft with a null return response", () => {
    const result = validateCapaImplementationWorkspaceDraft(draft());

    expect(result).toMatchObject({
      status: "valid",
      value: { implementation_review_return_response: null },
    });
  });

  it("C: rejects an unknown workspace schema version", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      schema_version: "capa-implementation-workspace-draft-9.9.9",
    }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_SCHEMA_VERSION",
    });
  });

  it("D: rejects duplicate approved-action progress entries", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action(), action()],
    }))).toMatchObject({
      status: "invalid",
      reason_code: "DUPLICATE_IMPLEMENTATION_ACTION_PROGRESS_REFERENCE",
    });
  });

  it("E: rejects an unsupported owner-reported status", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action({ owner_reported_status: "implemented" })],
    }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_OWNER_REPORTED_STATUS",
    });
  });

  it("F/G: requires and accepts a bounded reason for blocked work", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action({
        owner_reported_status: "blocked",
        blocked_reason: " ",
      })],
    })).status).toBe("invalid");

    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action({
        owner_reported_status: "blocked",
        blocked_reason: "Awaiting validated equipment access.",
      })],
    })).status).toBe("valid");
  });

  it("H: rejects a blocked reason on a non-blocked state", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action({ blocked_reason: "Unexpected reason" })],
    }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_BLOCKED_REASON",
    });
  });

  it("I: accepts a valid evidence record", () => {
    expect(validateCapaImplementationEvidence(evidence())).toMatchObject({
      status: "valid",
      value: { evidence_kind: "training_record" },
    });
  });

  it("J: rejects a blank evidence description", () => {
    expect(validateCapaImplementationEvidence(evidence({ description: " " }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_EVIDENCE_DESCRIPTION",
    });
  });

  it("K: rejects an unsupported evidence kind", () => {
    expect(validateCapaImplementationEvidence(evidence({ evidence_kind: "vendor_certificate" }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_EVIDENCE_KIND",
    });
  });

  it("L: rejects a malformed evidence date", () => {
    expect(validateCapaImplementationEvidence(evidence({ evidence_date: "2026-02-30" }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_EVIDENCE_DATE",
    });
  });

  it("M: rejects an invalid provenance combination", () => {
    expect(validateCapaImplementationEvidence(evidence({
      source: source({
        origin_kind: "lvtchat_record",
        source_system_kind: "qms",
      }),
    })).status).toBe("invalid");
  });

  it("N: rejects duplicate evidence identifiers", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [
        action({ evidence: [evidence()] }),
        action({
          approved_action_reference: "ACTION-2",
          evidence: [evidence({
            approved_action_reference: "ACTION-2",
          })],
        }),
      ],
    }))).toMatchObject({
      status: "invalid",
      reason_code: "DUPLICATE_IMPLEMENTATION_EVIDENCE_ID",
    });
  });

  it("O: rejects evidence associated with a different action than its progress entry", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action({
        evidence: [evidence({ approved_action_reference: "ACTION-2" })],
      })],
    }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_EVIDENCE_ACTION_REFERENCE",
    });
  });

  it("P: rejects a syntactically valid action outside the approved S70 set", () => {
    expect(validateCapaImplementationDraftAgainstApprovedActionSet(
      draft({ action_progress: [action({ approved_action_reference: "ACTION-2" })] }),
      ["ACTION-1"],
    )).toMatchObject({
      status: "invalid",
      reason_code: "APPROVED_ACTION_REFERENCE_NOT_AUTHORITATIVE",
    });
  });

  it("Q/R: rejects client-authoritative identity and timestamp fields", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      created_by: "client-user",
    }))).toMatchObject({
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_FIELDS",
    });

    expect(validateCapaImplementationWorkspaceDraft(draft({
      implementation_review_return_response: returnResponse({
        responded_at: "2026-09-10T12:00:00.000Z",
      }),
    })).status).toBe("invalid");
  });

  it("S: accepts the future S90 return-response shape structurally", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      implementation_review_return_response: returnResponse(),
    })).status).toBe("valid");
  });

  it("T/U: rejects reviewer rationale and arbitrary authoritative timestamps", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      implementation_review_return_response: returnResponse({
        reviewer_rationale: "This remains authoritative review content.",
      }),
    })).status).toBe("invalid");

    expect(validateCapaImplementationWorkspaceDraft(draft({
      implementation_review_return_response: returnResponse({
        reviewed_at: "2026-09-10T12:00:00.000Z",
      }),
    })).status).toBe("invalid");
  });

  it("V: keeps incomplete in-progress work draft-valid", () => {
    expect(validateCapaImplementationWorkspaceDraft(draft({
      action_progress: [action({
        implementation_narrative: null,
        evidence: [],
      })],
    })).status).toBe("valid");
  });

  it("W: keeps reported_complete owner semantics distinct from S90 acceptance", () => {
    const completed = draft({
      action_progress: [action({
        owner_reported_status: "reported_complete",
        evidence: [evidence()],
      })],
    });

    expect(CAPA_IMPLEMENTATION_OWNER_REPORTED_STATUSES).not.toContain("implemented");
    expect(validateCapaImplementationWorkspaceDraft(completed).status).toBe("valid");
    expect(evaluateCapaImplementationSubmissionReadiness(completed, ["ACTION-1"])).toEqual({
      status: "ready_for_s90_review",
    });
    expect(evaluateCapaImplementationSubmissionReadiness(completed, ["ACTION-1"])).not.toEqual({
      status: "accepted",
    });
  });

  it("validates the immutable S70 baseline reference with branded identifier shapes", () => {
    expect(validateCapaImplementationApprovedS70BaselineReference({
      source_case_version_id: CASE_VERSION,
      approved_action_plan_section_id: ACTION_SECTION,
      approval_decision_reference: APPROVAL_AUDIT,
    }).status).toBe("valid");
  });

  it("enforces the complete S80 submission-readiness boundary", () => {
    const ready = draft({
      action_progress: [action({
        owner_reported_status: "reported_complete",
        evidence: [evidence()],
      })],
    });
    expect(evaluateCapaImplementationSubmissionReadiness(ready, ["ACTION-1"])).toEqual({ status: "ready_for_s90_review" });

    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "not_started", evidence: [evidence()] })] }), ["ACTION-1"]))).toContain("ACTION_NOT_REPORTED_COMPLETE");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "in_progress", evidence: [evidence()] })] }), ["ACTION-1"]))).toContain("ACTION_NOT_REPORTED_COMPLETE");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "blocked", blocked_reason: "Awaiting access.", evidence: [evidence()] })] }), ["ACTION-1"]))).toContain("ACTION_NOT_REPORTED_COMPLETE");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "reported_complete", implementation_narrative: null, evidence: [evidence()] })] }), ["ACTION-1"]))).toContain("MISSING_IMPLEMENTATION_NARRATIVE");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "reported_complete" })] }), ["ACTION-1"]))).toContain("MISSING_IMPLEMENTATION_EVIDENCE");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "reported_complete", evidence: [evidence({ source: source({ origin_kind: "lvtchat_record", source_system_kind: "qms" }) })] })] }), ["ACTION-1"]))).toContain("INVALID_DRAFT");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [] }), ["ACTION-1"]))).toContain("MISSING_APPROVED_ACTION_PROGRESS");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ approved_action_reference: "ACTION-2", owner_reported_status: "reported_complete", evidence: [evidence({ approved_action_reference: "ACTION-2" })] })] }), ["ACTION-1"]))).toContain("INVALID_DRAFT");
    expect(blockerCodes(evaluateCapaImplementationSubmissionReadiness(draft({ action_progress: [action({ owner_reported_status: "reported_complete", evidence: [evidence({ approved_action_reference: "ACTION-2" })] })] }), ["ACTION-1"]))).toContain("INVALID_DRAFT");
    expect(evaluateCapaImplementationSubmissionReadiness({ ...ready, implementation_review_return_response: null }, ["ACTION-1"])).toEqual({ status: "ready_for_s90_review" });
  });
});
