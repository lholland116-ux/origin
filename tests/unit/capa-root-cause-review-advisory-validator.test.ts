import { describe, expect, it } from "vitest";

import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-contract";
import {
  validateCapaRootCauseReviewAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-validator";

type MutableOutput = Record<string, any>;

function minimalValidOutput(): MutableOutput {
  return {
    schema_version:
      CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
    status: "completed_draft",
    proposal: {
      neutral_review_summary:
        "The submitted root-cause package is available for human review.",
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
  };
}

function populatedValidOutput(): MutableOutput {
  const output = minimalValidOutput();

  output.proposal.neutral_review_summary =
    "The submitted package identifies the proposed cause as a confirmed hypothesis in the source material; the AI does not make that determination.";
  output.proposal.version_changes = [
    {
      change_key: "V1",
      subject: "Root-cause package hypothesis status",
      change_type: "modified",
      previous_value: "proposed",
      current_value: "confirmed",
      authoritative_identifier: "H-1",
      reference_keys: ["R1", "R2"],
      human_review_question:
        "Which source should a reviewer compare for this change?",
    },
  ];
  output.proposal.blockers_warnings = [
    {
      warning_key: "B1",
      kind: "review_warning",
      subject: "Evidence coverage",
      description:
        "The available package does not establish support for every material statement.",
      authoritative_identifier: null,
      reference_keys: ["R2"],
      human_review_question:
        "Does the reviewer require another controlled source?",
    },
    {
      warning_key: "B2",
      kind: "authoritative_source_reported_blocker",
      subject: "Source-reported review blocker",
      description:
        "The controlled record reports an unresolved review blocker.",
      authoritative_identifier: "B-02",
      reference_keys: ["R3"],
      human_review_question:
        "Which human reviewer should assess this source-reported blocker?",
    },
  ];
  output.proposal.evidence_map = [
    {
      mapping_key: "E1",
      subject: "Equipment configuration statement",
      relationship: "supports",
      description:
        "This source is mapped as supporting the submitted statement; AI analysis does not verify it.",
      evidence_reference_keys: ["R1"],
      source_status: "source_reported",
      authoritative_identifier: "E-1",
      human_review_question:
        "Should a human reviewer verify this supporting source?",
    },
    {
      mapping_key: "E2",
      subject: "Material variability statement",
      relationship: "contradicts",
      description:
        "This source is mapped as contradicting the submitted statement.",
      evidence_reference_keys: ["R2"],
      source_status: "not_established",
      authoritative_identifier: null,
      human_review_question:
        "Which reviewer should assess this contradiction?",
    },
    {
      mapping_key: "E3",
      subject: "Calibration support",
      relationship: "missing_support",
      description:
        "No supporting evidence reference was supplied for this issue.",
      evidence_reference_keys: [],
      source_status: "not_provided",
      authoritative_identifier: null,
      human_review_question:
        "What source would address the missing support?",
    },
  ];
  output.uncertainty_and_limitations = [
    {
      category: "source_status_uncertain",
      human_review_question:
        "Which source status requires human confirmation?",
    },
  ];

  return output;
}

function expectReason(
  value: unknown,
  reasonCode: string,
): void {
  const raw =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  expect(() =>
    validateCapaRootCauseReviewAdvisoryModelOutput(raw),
  ).toThrowError(
    expect.objectContaining({
      name:
        "CapaRootCauseReviewAdvisoryOutputValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "CAPA S50 root-cause review advisory raw output validation",
  () => {
    it("accepts the minimal neutral S50 review packet", () => {
      const result =
        validateCapaRootCauseReviewAdvisoryModelOutput(
          JSON.stringify(minimalValidOutput()),
        );

      expect(result.proposal.version_changes).toEqual([]);
      expect(result.advisory_only).toBe(true);
      expect(result.workflow_mutated).toBe(false);
      expect(result.controlled_record_mutated).toBe(false);
      expect(result.review_disposition).toBeNull();
      expect(result.workflow_transition).toBeNull();
    });

    it("accepts and deeply freezes a populated neutral review packet", () => {
      const result =
        validateCapaRootCauseReviewAdvisoryModelOutput(
          JSON.stringify(populatedValidOutput()),
        );

      expect(result.proposal.version_changes[0]?.change_key).toBe("V1");
      expect(result.proposal.evidence_map[0]?.relationship).toBe("supports");
      expect(result.proposal.evidence_map[1]?.relationship).toBe("contradicts");
      expect(result.proposal.evidence_map[2]?.relationship).toBe("missing_support");
      expect(result.proposal.blockers_warnings[1]?.kind).toBe(
        "authoritative_source_reported_blocker",
      );
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.proposal)).toBe(true);
      expect(Object.isFrozen(result.proposal.version_changes)).toBe(true);
      expect(Object.isFrozen(result.proposal.version_changes[0])).toBe(true);
      expect(Object.isFrozen(result.proposal.evidence_map[0])).toBe(true);
      expect(
        Object.isFrozen(
          result.proposal.evidence_map[0]?.evidence_reference_keys,
        ),
      ).toBe(true);
    });

    it("rejects null, arrays, malformed JSON and missing required keys", () => {
      expectReason(null, "MODEL_OUTPUT_NOT_OBJECT");
      expectReason([], "MODEL_OUTPUT_NOT_OBJECT");
      expectReason("not-json", "MODEL_OUTPUT_NOT_JSON");

      const missing = minimalValidOutput();
      delete missing.proposal;
      expectReason(missing, "MISSING_MODEL_OUTPUT_FIELD");

      const missingNested = minimalValidOutput();
      delete missingNested.proposal.evidence_map;
      expectReason(missingNested, "MISSING_MODEL_OUTPUT_FIELD");
    });

    it("rejects unexpected keys, wrong schema and unsupported status", () => {
      const extra = minimalValidOutput();
      extra.proposal.disposition = "approved";
      expectReason(extra, "UNSUPPORTED_MODEL_OUTPUT_FIELD");

      const schema = minimalValidOutput();
      schema.schema_version = "capa_review_packet_draft-9.9.9";
      expectReason(schema, "INVALID_SCHEMA_VERSION");

      const status = minimalValidOutput();
      status.status = "validation_failed";
      expectReason(status, "INVALID_STATUS");
    });

    it("rejects malformed nested entries, empty text and invalid enums", () => {
      const badSummary = minimalValidOutput();
      badSummary.proposal.neutral_review_summary = "   ";
      expectReason(badSummary, "INVALID_OUTPUT_TEXT");

      const badVersion = minimalValidOutput();
      badVersion.proposal.version_changes = [
        {
          change_key: "not-a-controlled-key",
        },
      ];
      expectReason(badVersion, "MISSING_MODEL_OUTPUT_FIELD");

      const badBlocker = populatedValidOutput();
      badBlocker.proposal.blockers_warnings[0].kind = "decision";
      expectReason(badBlocker, "INVALID_ENUM_VALUE");

      const badEvidence = populatedValidOutput();
      badEvidence.proposal.evidence_map[0].relationship = "verified";
      expectReason(badEvidence, "INVALID_ENUM_VALUE");

      const badQuestion = populatedValidOutput();
      badQuestion.proposal.evidence_map[0].human_review_question =
        "The reviewer should verify this source.";
      expectReason(badQuestion, "INVALID_ADVISORY_QUESTION");
    });

    it("rejects malformed and duplicate controlled identifiers or references", () => {
      const badIdentifier = populatedValidOutput();
      badIdentifier.proposal.version_changes[0].change_key = "V0";
      expectReason(badIdentifier, "INVALID_IDENTIFIER");

      const duplicateIdentifier = populatedValidOutput();
      duplicateIdentifier.proposal.version_changes.push({
        ...duplicateIdentifier.proposal.version_changes[0],
      });
      expectReason(duplicateIdentifier, "DUPLICATE_CONTROLLED_IDENTIFIER");

      const badReference = populatedValidOutput();
      badReference.proposal.evidence_map[0].evidence_reference_keys = [
        "authoritative-evidence-id",
      ];
      expectReason(badReference, "INVALID_REFERENCE_KEY");

      const duplicateReference = populatedValidOutput();
      duplicateReference.proposal.evidence_map[0].evidence_reference_keys = [
        "R1",
        "R1",
      ];
      expectReason(duplicateReference, "DUPLICATE_REFERENCE_KEY");
    });

    it("requires traceability for source-reported blockers and evidence", () => {
      const blocker = populatedValidOutput();
      blocker.proposal.blockers_warnings[1].authoritative_identifier = null;
      blocker.proposal.blockers_warnings[1].reference_keys = [];
      expectReason(blocker, "INVALID_BLOCKER_WARNING");

      const evidence = populatedValidOutput();
      evidence.proposal.evidence_map[0].authoritative_identifier = null;
      evidence.proposal.evidence_map[0].evidence_reference_keys = [];
      expectReason(evidence, "INVALID_EVIDENCE_MAP_ENTRY");

      const relationship = populatedValidOutput();
      relationship.proposal.evidence_map[0].evidence_reference_keys = [];
      relationship.proposal.evidence_map[0].source_status = "not_established";
      expectReason(relationship, "INVALID_EVIDENCE_MAP_ENTRY");
    });

    it("rejects unsafe authority, disposition and workflow claims", () => {
      for (const claim of [
        "Approve the root cause.",
        "Root cause approved.",
        "Reject this root cause.",
        "Advance this workflow to S60.",
        "Transition the CAPA to S60.",
        "G-04 is approved.",
        "The AI confirms this root cause.",
        "The CAPA was approved.",
        "The AI decision is authoritative.",
        "I am the reviewer.",
        "Sign the controlled record.",
      ]) {
        const output = minimalValidOutput();
        output.proposal.neutral_review_summary = claim;
        expectReason(output, "PROHIBITED_S50_DECISION_CLAIM");
      }
    });

    it("does not let neutral source reporting exempt a later prohibited clause", () => {
      for (const claim of [
        "The submitted package identifies X as a confirmed hypothesis. Root cause approved.",
        "The controlled record states that hypothesis H1 is confirmed. Reject this root cause.",
        "The authoritative source reports the hypothesis as confirmed; advance the workflow to S60.",
        "The submitted package identifies X as confirmed. G-04 is approved.",
        "The controlled record states X is the root cause. The AI confirms this root cause.",
        "The submitted package identifies X as confirmed. Sign the controlled record.",
      ]) {
        const output = minimalValidOutput();
        output.proposal.neutral_review_summary = claim;
        expectReason(output, "PROHIBITED_S50_DECISION_CLAIM");
      }
    });

    it("applies the source-reporting exception independently in nested fields", () => {
      const previousValue = populatedValidOutput();
      previousValue.proposal.version_changes[0].previous_value =
        "The submitted package identifies X as a confirmed hypothesis. Root cause approved.";
      expectReason(previousValue, "PROHIBITED_S50_DECISION_CLAIM");

      const blockerDescription = populatedValidOutput();
      blockerDescription.proposal.blockers_warnings[1].description =
        "The controlled record states that hypothesis H1 is confirmed; reject this root cause.";
      expectReason(blockerDescription, "PROHIBITED_S50_DECISION_CLAIM");

      const evidenceDescription = populatedValidOutput();
      evidenceDescription.proposal.evidence_map[0].description =
        "The authoritative source reports the hypothesis as confirmed; the AI confirms this root cause.";
      expectReason(evidenceDescription, "PROHIBITED_S50_DECISION_CLAIM");
    });

    it("rejects authority-bearing structured fields and incorrect flags", () => {
      for (const mutation of [
        { review_disposition: "approved" },
        { workflow_transition: "S50->S60" },
        { workflow_mutated: true },
        { controlled_record_mutated: true },
        { advisory_only: false },
        { human_acceptance_required: false },
      ]) {
        expectReason(
          { ...minimalValidOutput(), ...mutation },
          "INVALID_ADVISORY_FLAGS",
        );
      }

      const citations = minimalValidOutput();
      citations.citations = [{ citation_id: "forged" }];
      expectReason(citations, "INVALID_CITATIONS");
    });

    it("rejects malformed arrays and preserves the advisory-only boundary", () => {
      const badList = minimalValidOutput();
      badList.proposal.evidence_map = "not-an-array";
      expectReason(badList, "INVALID_OUTPUT_LIST");

      const tooMany = minimalValidOutput();
      tooMany.uncertainty_and_limitations = Array.from(
        { length: 21 },
        () => ({
          category: "missing_context",
          human_review_question: "What context requires human review?",
        }),
      );
      expectReason(tooMany, "INVALID_OUTPUT_LIST");

      const sourceDescription = minimalValidOutput();
      sourceDescription.proposal.neutral_review_summary =
        "The submitted package identifies X as a confirmed hypothesis.";
      expect(
        validateCapaRootCauseReviewAdvisoryModelOutput(
          JSON.stringify(sourceDescription),
        ).proposal.neutral_review_summary,
      ).toBe("The submitted package identifies X as a confirmed hypothesis.");
    });
  },
);
