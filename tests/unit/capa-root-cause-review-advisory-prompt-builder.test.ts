import { describe, expect, it } from "vitest";

import {
  buildCapaRootCauseReviewAdvisoryPrompt,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-prompt-builder";

const modelSafeContext: any = {
  trust: "model_safe_context",
  workflow_state: "S50",
  current_version_number: 4,
  comparison_version_number: null,
  current_section_versions: {
    investigation_ledger: "capa-evidence-assumption-ledger-1.0.0",
    root_cause_package: "capa-root-cause-package-1.0.0",
    investigation_plan: null,
  },
  comparison_section_versions: null,
  references: [
    {
      reference_key: "R1",
      trust: "authoritative_server_context",
      source_kind: "ledger_item",
      version_scope: "current",
      information_class: "verified_evidence",
      statement: "The controlled record reports parameter A.",
      evidence_status: "verified",
      assumption_status: null,
      gap_status: null,
      conflict_status: null,
      source_version: "source-v1",
      context: null,
      material_to_conclusion: true,
      critical_to_conclusion: false,
      recommended_next_step: null,
    },
  ],
};

describe("S50 root-cause review advisory prompt builder", () => {
  it("identifies AG-REVIEW S50 purpose and serializes only model-safe context", () => {
    const prompt = buildCapaRootCauseReviewAdvisoryPrompt({
      model_safe_context: modelSafeContext,
    });

    expect(prompt).toContain("AG-REVIEW");
    expect(prompt).toContain("S50 — Root Cause Review");
    expect(prompt).toContain("assemble_review_packet");
    expect(prompt).toContain("BEGIN MODEL_SAFE_CONTEXT_DATA");
    expect(prompt).toContain(JSON.stringify(modelSafeContext));
    expect(prompt).toContain("R# values are the only model-usable reference keys");
    expect(prompt).not.toContain("reference_manifest");
    expect(prompt).not.toContain("S50-LEDGER");
  });

  it("locks the exact output contract and all authority controls", () => {
    const prompt = buildCapaRootCauseReviewAdvisoryPrompt({
      model_safe_context: modelSafeContext,
    });

    for (const phrase of [
      "capa_review_packet_draft-1.0.0",
      "neutral_review_summary",
      "version_changes",
      "blockers_warnings",
      "evidence_map",
      "advisory_only=true",
      "workflow_mutated=false",
      "controlled_record_mutated=false",
      "review_disposition=null",
      "workflow_transition=null",
      "human_acceptance_required=true",
      "citations=[]",
      "do not return markdown fences or prose outside JSON",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });

  it("preserves source, evidence, version and human-review governance", () => {
    const prompt = buildCapaRootCauseReviewAdvisoryPrompt({
      model_safe_context: modelSafeContext,
    });

    for (const phrase of [
      "source-reported status from an AI determination",
      "supports, contradicts or missing_support",
      "AI analysis does not authoritatively verify evidence",
      "Never approve or reject a root cause or hypothesis",
      "Never approve G-04",
      "Never set review_disposition",
      "Never mutate or sign a controlled record",
      "Never impersonate a reviewer or approver",
      "Never make release, recall, patient-treatment, reportability or external-regulatory determinations",
      "If comparison_version_number is null, return version_changes=[]",
      "For every human_review_question",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });
});
