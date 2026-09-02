import { describe, expect, it, vi } from "vitest";

import { CapaContainmentRiskAdvisoryModelGenerator, CAPA_CONTAINMENT_RISK_ADVISORY_JSON_SCHEMA } from "../../lib/capa/ai/capa-containment-risk-advisory-model-generator";
import type { CapaAiOutputId, CapaAiRunId, CapaPromptPackageId } from "../../lib/capa/ai/capa-prompt-contract";
import type { CorrelationId, IsoDateTime, RequestId } from "../../lib/capa/domain/capa-types";

const persisted: any = { actions: [], impact_scope: { products: ["repository"], processes: [], data: [], customers: [], patients: [] }, risk_evaluation: null, missing_risk_information: [], escalations: [] };
const context: any = { authoritative: { trust: "authoritative_server_context", organization_id: "organization", capa_case_id: "case", case_version_id: "version", record_version: 2, workflow_state: "S20", actor: "user", active_roles: [], intake_scope: { initiating_event: "event", organization_reference: "reference", source: {} }, persisted_containment_risk: persisted }, untrusted_human_draft: null };
const valid = JSON.stringify({ proposal: { missing_risk_inputs: [], missing_impact_dimensions: [], human_review_questions: ["Is additional evidence required?"], evidence_provenance_gaps: [] }, assumptions: [], uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true });
const request_id = "request-1" as RequestId;
const correlation_id = "correlation-1" as CorrelationId;
const run_id = "run-1" as CapaAiRunId;
const prompt_package_id = "package-1" as CapaPromptPackageId;
const assembled_at = "2026-09-01T00:00:00.000Z" as IsoDateTime;
const output_id = "output-1" as CapaAiOutputId;

function fixture(output = valid) {
  const model_client = { generateStructured: vi.fn().mockResolvedValue({ output_text: output }) };
  const createRunId = vi.fn(() => run_id);
  const createPromptPackageId = vi.fn(() => prompt_package_id);
  const now = vi.fn(() => assembled_at);
  const createOutputId = vi.fn(() => output_id);
  return { model_client, createRunId, createPromptPackageId, now, createOutputId, generator: new CapaContainmentRiskAdvisoryModelGenerator({ model_client, createRunId, createPromptPackageId, now, createOutputId }) };
}

function generate(subject: ReturnType<typeof fixture>, focus: string | null = null) {
  return subject.generator.generate({ context, focus, request_id, correlation_id });
}

describe("S20 generator trusted identity lifecycle", () => {
  it("uses a valid typed zero-citation schema", () => {
    const citations = CAPA_CONTAINMENT_RISK_ADVISORY_JSON_SCHEMA.properties.citations;
    expect(citations.type).toBe("array");
    expect(citations.maxItems).toBe(0);
    expect(citations.items).toEqual({ type: "string" });
    expect(citations.items).not.toEqual({});
  });

  it("creates server identity once before the provider and freezes its trace", async () => {
    const subject = fixture();
    const result = await generate(subject, "risk");
    expect(subject.createRunId).toHaveBeenCalledTimes(1);
    expect(subject.createPromptPackageId).toHaveBeenCalledTimes(1);
    expect(subject.now).toHaveBeenCalledTimes(1);
    expect(subject.createOutputId).toHaveBeenCalledTimes(1);
    expect(result.response.run_id).toBe(result.trace.package.trace.run_id);
    expect(result.response.output_id).toBe(output_id);
    expect(result.response.output_schema_version).toBe("capa-containment-risk-advisory-1.0.0");
    expect(result.response.status).toBe("completed_draft");
    expect(result.response.containment_summary).toEqual([]);
    expect(result.response.citations).toEqual([]);
    expect(result.response.warnings).toEqual([]);
    expect(Object.isFrozen(result.response)).toBe(true);
    expect(Object.isFrozen(result.response.containment_summary)).toBe(true);
    expect(Object.isFrozen(result.response.citations)).toBe(true);
    expect(Object.isFrozen(result.response.warnings)).toBe(true);
    expect(result.trace.package.trace).toEqual({ run_id, prompt_package_id, request_id, correlation_id, assembled_at });
    expect(Object.isFrozen(result.trace.package.trace)).toBe(true);
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(1);
  });

  it.each([["run ID", "createRunId"], ["prompt-package ID", "createPromptPackageId"], ["clock", "now"]] as const)("does not call the provider when the %s factory throws", async (_name, factory) => {
    const subject = fixture();
    subject[factory].mockImplementation(() => { throw new Error("identity failure"); });
    await expect(generate(subject)).rejects.toThrow("identity failure");
    expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it("does not call the provider when prompt construction fails", async () => {
    const subject = fixture();
    await expect(generate(subject, "x".repeat(121_000))).rejects.toThrow("CONTROLLED_CAPA_PROMPT_INVALID");
    expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it("does not call the provider when governed trace construction fails", async () => {
    const subject = fixture();
    const malformedContext = { ...context, authoritative: { ...context.authoritative, intake_scope: { ...context.authoritative.intake_scope, source: { missing: undefined } } } };
    await expect(subject.generator.generate({ context: malformedContext, focus: null, request_id, correlation_id })).rejects.toThrow();
    expect(subject.model_client.generateStructured).not.toHaveBeenCalled();
  });

  it("preserves validated raw advisory behavior", async () => {
    const subject = fixture();
    await expect(generate(subject)).resolves.toMatchObject({ response: { advisory_only: true, workflow_mutated: false, human_acceptance_required: true } });
  });

  it("rejects invalid raw advisory output after provider invocation", async () => {
    const subject = fixture("{}");
    await expect(generate(subject)).rejects.toThrow();
    expect(subject.model_client.generateStructured).toHaveBeenCalledTimes(1);
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });

  it("does not create an output ID when the provider fails", async () => {
    const subject = fixture();
    subject.model_client.generateStructured.mockRejectedValue(new Error("provider failure"));
    await expect(generate(subject)).rejects.toThrow("provider failure");
    expect(subject.createOutputId).not.toHaveBeenCalled();
  });
});
