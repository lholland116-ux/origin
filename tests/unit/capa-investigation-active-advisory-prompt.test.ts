import { describe, expect, it } from "vitest";

import {
  buildCapaInvestigationActiveAdvisoryPrompt,
} from "../../lib/capa/ai/capa-investigation-active-advisory-prompt";

const modelSafeContext: any = {
  trust: "model_safe_context",
  workflow_state: "S40",
  references: [
    {
      reference_key: "R1",
      trust: "authoritative_server_context",
      source_kind: "investigation_plan_item",
      investigation_question: "What caused the deviation?",
      evidence_target: "Batch record",
      investigation_method: "Record review",
      scope_relationship: "Accepted scope",
      status: "in_progress",
      disposition: null,
      disposition_rationale: null,
    },
    {
      reference_key: "R2",
      trust: "untrusted_human_draft",
      source_kind: "ledger_item",
      information_class: "user_provided_statement",
      statement: "A draft observation",
      evidence_status: null,
      assumption_status: null,
      gap_status: null,
      conflict_status: null,
      context: null,
      material_to_conclusion: false,
      critical_to_conclusion: false,
      recommended_next_step: null,
    },
  ],
};

describe("S40 investigation-active advisory prompt", () => {
  it("serializes only model-safe R# references and preserves trust semantics", () => {
    const prompt = buildCapaInvestigationActiveAdvisoryPrompt({
      model_safe_context: modelSafeContext,
    });

    expect(prompt).toContain("BEGIN MODEL_SAFE_CONTEXT_DATA");
    expect(prompt).toContain(JSON.stringify(modelSafeContext));
    expect(prompt).toContain("authoritative_server_context");
    expect(prompt).toContain("untrusted_human_draft");
    expect(prompt).toContain("R# values are opaque controlled references");
    expect(prompt).toContain("Do not invent an R# reference");
  });

  it("prohibits workflow and causal authority while requiring an exact advisory response", () => {
    const prompt = buildCapaInvestigationActiveAdvisoryPrompt({
      model_safe_context: modelSafeContext,
    });

    for (const phrase of [
      "advisory analysis only",
      "no workflow",
      "Never confirm or reject a root cause or hypothesis",
      "Never verify evidence",
      "Never resolve an assumption, gap, or conflict",
      "Never submit or advance the CAPA workflow",
      "Model-generated citations must remain []",
      "human_acceptance_required=true",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });

  it("cannot receive a server-only reference manifest or raw source identifiers", () => {
    const prompt = buildCapaInvestigationActiveAdvisoryPrompt({
      model_safe_context: modelSafeContext,
    });

    for (const forbidden of [
      "INV-SECRET-ITEM-ID",
      "HYP-SECRET-ID",
      "CASE-SECRET-ID",
      "reference_manifest",
      "source_id",
    ]) {
      expect(prompt).not.toContain(forbidden);
    }
  });
});
