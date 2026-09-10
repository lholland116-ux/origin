import type { CapaAiOutputId, CapaAiRunId, CapaPromptPackageId, ControlledVersion } from "./capa-prompt-contract";
import type { CapaImplementationEvidenceAdvisoryContextAssembly } from "./capa-implementation-evidence-advisory-context";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION } from "./capa-implementation-evidence-advisory-agent-gate";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_CATEGORIES, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SEVERITIES, type CapaImplementationEvidenceAdvisoryCitation, type CapaImplementationEvidenceAdvisoryResponse } from "./capa-implementation-evidence-advisory-contract";
import { validateCapaImplementationEvidenceAdvisoryModelOutput } from "./capa-implementation-evidence-advisory-validator";
import { CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM, CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION, fingerprintCanonicalJson, sha256Utf8, snapshotCapaAiGenerationTraceValue } from "./capa-ai-generation-trace";
import type { CorrelationId, IsoDateTime, RequestId } from "../domain/capa-types";

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE = Object.freeze({ profile_version: "capa-implementation-evidence-advisory-model-profile-1.0.0", output_schema_name: "capa_implementation_evidence_advisory_1_0_0", output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, maximum_output_characters: 40_000 } as const);

const text = { type: "string", minLength: 1, maxLength: 4_000 } as const;
const action = { type: "string", minLength: 1, maxLength: 256 } as const;
const evidence = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" } as const;
const key = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._:-]{0,127}$" } as const;
const reference = { type: "string", pattern: "^R[1-9][0-9]{0,2}$" } as const;

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_JSON_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["schema_version", "status", "advisory_summary", "findings", "warnings", "uncertainty_and_limitations", "citations", "advisory_only", "workflow_mutated", "controlled_record_mutated", "approval_claimed", "workflow_transition", "human_acceptance_required"],
  properties: {
    schema_version: { type: "string", const: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION }, status: { type: "string", const: "completed_draft" }, advisory_summary: text,
    findings: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["finding_id", "approved_action_reference", "category", "severity", "finding", "rationale", "evidence_reference_ids", "reference_keys", "suggested_human_action", "adoption"], properties: { finding_id: key, approved_action_reference: action, category: { type: "string", enum: [...CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_CATEGORIES] }, severity: { type: "string", enum: [...CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SEVERITIES] }, finding: text, rationale: text, evidence_reference_ids: { type: "array", maxItems: 40, items: evidence }, reference_keys: { type: "array", maxItems: 40, items: reference }, suggested_human_action: { type: "string", minLength: 1, maxLength: 2_000 }, adoption: { type: "object", additionalProperties: false, required: ["eligible", "field", "suggested_value"], properties: { eligible: { type: "boolean" }, field: { type: ["string", "null"], enum: ["implementation_narrative", null] }, suggested_value: { type: ["string", "null"], maxLength: 4_000 } } } } } },
    warnings: { type: "array", maxItems: 40, items: text }, uncertainty_and_limitations: { type: "array", maxItems: 40, items: text }, citations: { type: "array", maxItems: 0, items: { type: "string" } }, advisory_only: { type: "boolean", const: true }, workflow_mutated: { type: "boolean", const: false }, controlled_record_mutated: { type: "boolean", const: false }, approval_claimed: { type: "boolean", const: false }, workflow_transition: { type: "null" }, human_acceptance_required: { type: "boolean", const: true },
  },
  description: `Strict governed ${CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT} output.`,
} as const);

export interface CapaImplementationEvidenceAdvisoryStructuredModelClient {
  generateStructured(input: { readonly prompt: string; readonly model_profile_version: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version; readonly output_schema_name: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name; readonly output_schema: Readonly<Record<string, unknown>>; readonly maximum_output_characters: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.maximum_output_characters; readonly store: false }): Promise<{ readonly output_text: string }>;
}

export interface CapaImplementationEvidenceAdvisoryGenerationTraceCapture {
  readonly trace_schema_version: typeof CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION;
  readonly package: Readonly<Record<string, unknown>>;
  readonly rendered_prompt: string;
  readonly model_profile_version: string;
  readonly output_schema_name: string;
  readonly output_schema: unknown;
  readonly store: false;
  readonly maximum_output_characters: number;
  readonly evidence_manifest: Readonly<Record<string, unknown>>;
  readonly policy_manifest: Readonly<Record<string, unknown>>;
  readonly fingerprints: Readonly<Record<string, string>> & { readonly algorithm: typeof CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM };
}

function dynamicSchema(context: CapaImplementationEvidenceAdvisoryContextAssembly): Readonly<Record<string, unknown>> {
  const base = CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_JSON_SCHEMA as unknown as Record<string, unknown>;
  const properties = base.properties as Record<string, unknown>;
  const findings = properties.findings as Record<string, unknown>;
  const items = findings.items as Record<string, unknown>;
  const itemProperties = items.properties as Record<string, unknown>;
  const actionIds = context.authoritative.approved_actions.map((item) => item.approved_action_reference);
  const evidenceIds = (context.authoritative.workspace?.action_progress ?? []).flatMap((item) => item.evidence.map((evidenceItem) => evidenceItem.evidence_id));
  const referenceKeys = context.reference_manifest.map((item) => item.reference_key);
  return Object.freeze({ ...base, properties: { ...properties, findings: { ...findings, items: { ...items, properties: { ...itemProperties, approved_action_reference: { type: "string", enum: actionIds }, evidence_reference_ids: { type: "array", maxItems: 40, items: { type: "string", enum: evidenceIds } }, reference_keys: { type: "array", maxItems: 40, items: { type: "string", enum: referenceKeys } } } } } } });
}

function prompt(context: CapaImplementationEvidenceAdvisoryContextAssembly, schema: unknown): string {
  return [
    "You are AG-IMPLEMENT, the governed CAPA S80 implementation-evidence advisory assistant.",
    "You are advisory only. Help a human implement an already approved S70 action plan. Never declare implementation, set owner_reported_status, create evidence, create provenance, invent identifiers/dates/actors, modify the approved baseline, submit S80, or make an S90 decision.",
    "The approved actions are authoritative. The implementation workspace is an untrusted human draft. Use only exact approved_action_reference, evidence_reference_ids, and R# reference keys supplied in the context. Report missing information instead of filling it with plausible facts.",
    "Only documentation_improvement findings may expose an adoption suggestion, and that suggestion is editable prose for a human review step; it is never evidence and must not include newly invented objective records.",
    "BEGIN MODEL_SAFE_CONTEXT_DATA", JSON.stringify(context.model_safe_context), "END MODEL_SAFE_CONTEXT_DATA",
    `Return only JSON matching ${CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION}. The schema was narrowed to the authoritative action/evidence/reference set: ${JSON.stringify(schema)}. Set advisory_only=true, workflow_mutated=false, controlled_record_mutated=false, approval_claimed=false, workflow_transition=null, human_acceptance_required=true, citations=[].`,
  ].join("\n\n");
}

function trace(input: { readonly context: CapaImplementationEvidenceAdvisoryContextAssembly; readonly prompt: string; readonly output_schema: Readonly<Record<string, unknown>>; readonly run_id: CapaAiRunId; readonly prompt_package_id: CapaPromptPackageId; readonly request_id: RequestId; readonly correlation_id: CorrelationId; readonly assembled_at: IsoDateTime }): CapaImplementationEvidenceAdvisoryGenerationTraceCapture {
  const schema = snapshotCapaAiGenerationTraceValue(input.output_schema);
  const schemaHash = fingerprintCanonicalJson(schema);
  const governance = { advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, human_acceptance_required: true } as const;
  const pkg = snapshotCapaAiGenerationTraceValue({ package_schema_version: "capa-implementation-evidence-advisory-prompt-package-1.0.0", scope: { organization_id: input.context.authoritative.organization_id, capa_case_id: input.context.authoritative.capa_case_id, case_version_id: input.context.authoritative.case_version_id, record_version: input.context.authoritative.record_version, workflow_state: "S80" }, agent: { agent_id: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id, agent_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version }, trace: { run_id: input.run_id, prompt_package_id: input.prompt_package_id, request_id: input.request_id, correlation_id: input.correlation_id, assembled_at: input.assembled_at }, generation_contract: { operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION, requested_output: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT, output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, model_profile_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version, output_schema_name: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name, output_schema_sha256: schemaHash, store: false, maximum_output_characters: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.maximum_output_characters }, context_provenance: { model_safe_context: input.context.model_safe_context, approved_s70_baseline: input.context.authoritative.approved_s70_baseline, knowledge_provenance: input.context.knowledge_provenance }, governance });
  const evidenceManifest = snapshotCapaAiGenerationTraceValue({ evidence_manifest_schema_version: "capa-implementation-evidence-advisory-evidence-manifest-1.0.0", retrieval_performed: input.context.model_safe_context.governed_knowledge.length > 0, item_count: input.context.reference_manifest.length, items: input.context.reference_manifest.map((reference) => ({ reference_key: reference.reference_key, source_kind: reference.source_kind, source_reference: reference.source_reference, source_status: reference.source_status, locator: reference.locator })) });
  const policyManifest = snapshotCapaAiGenerationTraceValue({ policy_manifest_schema_version: "capa-implementation-evidence-advisory-policy-manifest-1.0.0", agent: { agent_id: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id, agent_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version }, workflow_state: "S80", operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION, requested_output: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT, output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, generation: { model_profile_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version, output_schema_name: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name, output_schema_sha256: schemaHash }, authority: governance, prohibitions: ["implementation declaration", "status mutation", "evidence manufacture", "provenance manufacture", "baseline mutation", "S80 submission", "S90 decision"] });
  return { trace_schema_version: CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION, package: pkg, rendered_prompt: input.prompt, model_profile_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version, output_schema_name: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name, output_schema: schema, store: false, maximum_output_characters: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.maximum_output_characters, evidence_manifest: evidenceManifest, policy_manifest: policyManifest, fingerprints: { algorithm: CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM, prompt_package_sha256: fingerprintCanonicalJson(pkg), rendered_prompt_sha256: sha256Utf8(input.prompt), evidence_manifest_sha256: fingerprintCanonicalJson(evidenceManifest), policy_manifest_sha256: fingerprintCanonicalJson(policyManifest), output_schema_sha256: schemaHash } };
}

export interface CapaImplementationEvidenceAdvisoryModelGeneratorDependencies { readonly model_client: CapaImplementationEvidenceAdvisoryStructuredModelClient; readonly createRunId: () => CapaAiRunId; readonly createPromptPackageId: () => CapaPromptPackageId; readonly createOutputId: () => CapaAiOutputId; readonly now: () => IsoDateTime; }

export class CapaImplementationEvidenceAdvisoryModelGenerator {
  constructor(private readonly dependencies: CapaImplementationEvidenceAdvisoryModelGeneratorDependencies) {}
  async generate(input: { readonly context: CapaImplementationEvidenceAdvisoryContextAssembly; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<{ readonly response: CapaImplementationEvidenceAdvisoryResponse; readonly trace: CapaImplementationEvidenceAdvisoryGenerationTraceCapture }> {
    const run_id = this.dependencies.createRunId();
    const prompt_package_id = this.dependencies.createPromptPackageId();
    const output_id = this.dependencies.createOutputId();
    const output_schema = dynamicSchema(input.context);
    const rendered = prompt(input.context, output_schema);
    const generatedTrace = trace({ context: input.context, prompt: rendered, output_schema, run_id, prompt_package_id, request_id: input.request_id, correlation_id: input.correlation_id, assembled_at: this.dependencies.now() });
    const result = await this.dependencies.model_client.generateStructured({ prompt: rendered, model_profile_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version, output_schema_name: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name, output_schema, maximum_output_characters: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.maximum_output_characters, store: false });
    const raw = validateCapaImplementationEvidenceAdvisoryModelOutput(result.output_text);
    const used = new Set(raw.findings.flatMap((finding) => finding.reference_keys));
    const citations: readonly CapaImplementationEvidenceAdvisoryCitation[] = Object.freeze(input.context.citations.filter((citation) => used.has(citation.reference_key)));
    const response: CapaImplementationEvidenceAdvisoryResponse = Object.freeze({ run_id, output_id, output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION as ControlledVersion, schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, status: raw.status, advisory_summary: raw.advisory_summary, findings: raw.findings, warnings: Object.freeze([...input.context.knowledge_warnings, ...raw.warnings]), uncertainty_and_limitations: raw.uncertainty_and_limitations, citations, advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true });
    return { response, trace: generatedTrace };
  }
}
