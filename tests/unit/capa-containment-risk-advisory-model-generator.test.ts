import { describe, expect, it, vi } from "vitest";

import { CapaContainmentRiskAdvisoryModelGenerator } from "../../lib/capa/ai/capa-containment-risk-advisory-model-generator";
import type { CapaAiRunId, CapaPromptPackageId } from "../../lib/capa/ai/capa-prompt-contract";
import type { CorrelationId, IsoDateTime, RequestId } from "../../lib/capa/domain/capa-types";

const persisted: any = { actions: [], impact_scope: { products: ["repository"], processes: [], data: [], customers: [], patients: [] }, risk_evaluation: null, missing_risk_information: [], escalations: [] };
const context: any = { authoritative: { trust: "authoritative_server_context", organization_id: "organization", capa_case_id: "case", case_version_id: "version", record_version: 2, workflow_state: "S20", actor: "user", active_roles: [], intake_scope: { initiating_event: "event", organization_reference: "reference", source: {} }, persisted_containment_risk: persisted }, untrusted_human_draft: null };
const valid = JSON.stringify({ proposal: { missing_risk_inputs: [], missing_impact_dimensions: [], human_review_questions: ["Is additional evidence required?"], evidence_provenance_gaps: [] }, assumptions: [], uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true });
const request_id = "request-1" as RequestId;
const correlation_id = "correlation-1" as CorrelationId;
const run_id = "run-1" as CapaAiRunId;
const prompt_package_id = "package-1" as CapaPromptPackageId;
const assembled_at = "2026-09-01T00:00:00.000Z" as IsoDateTime;

function fixture(output = valid) {
  const model_client = { generateStructured: vi.fn().mockResolvedValue({ output_text: output }) };
  const createRunId = vi.fn(() => run_id);
  const createPromptPackageId = vi.fn(() => prompt_package_id);
  const now = vi.fn(() => assembled_at);
  return { model_client, createRunId, createPromptPackageId, now, generator: new CapaContainmentRiskAdvisoryModelGenerator({ model_client, createRunId, createPromptPackageId, now }) };
}

function generate(subject: ReturnType<typeof fixture>, focus: string | null = null) {
  return subject.generator.generate({ context, focus, request_id, correlation_id });
}

describe("S20 generator trusted identity lifecycle", () => {
  it("creates server identity once before the provider and freezes its trace", async () => {
    const subject = fixture();
    const result = await generate(subject, "risk");
    expect(subject.createRunId).toHaveBeenCalledTimes(1);
    expect(subject.createPromptPackageId).toHaveBeenCalledTimes(1);
    expect(subject.now).toHaveBeenCalledTimes(1);
    expect(result.trace.package.trace).toEqual({ run_id, prompt_package_id, request_id, correlation_id, assembled_at });
    expect(Object.isFrozen(result.trace.package.trace)).toBe(true);
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(1);
  });

  it.each([["run ID", "createRunId"], ["prompt-package ID", "createPromptPackageId"], ["clock", "now"]] as const)("does not call the provider when the %s factory throws", async (_name, factory) => {
    const subject = fixture();
    subject[factory].mockImplementation(() => { throw new Error("identity failure"); });
    await expect(generate(subject)).rejects.toThrow("identity failure");
    expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
  });

  it("does not call the provider when prompt construction fails", async () => {
    const subject = fixture();
    await expect(generate(subject, "x".repeat(121_000))).rejects.toThrow("CONTROLLED_CAPA_PROMPT_INVALID");
    expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
  });

  it("does not call the provider when governed trace construction fails", async () => {
    const subject = fixture();
    const malformedContext = { ...context, authoritative: { ...context.authoritative, intake_scope: { ...context.authoritative.intake_scope, source: { missing: undefined } } } };
    await expect(subject.generator.generate({ context: malformedContext, focus: null, request_id, correlation_id })).rejects.toThrow();
    expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
  });

  it("preserves validated raw advisory behavior", async () => {
    const subject = fixture();
    await expect(generate(subject)).resolves.toMatchObject({ advisory: { advisory_only: true, workflow_mutated: false, human_acceptance_required: true } });
  });

  it("rejects invalid raw advisory output after provider invocation", async () => {
    const subject = fixture("{}");
    await expect(generate(subject)).rejects.toThrow();
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(1);
  });
});
