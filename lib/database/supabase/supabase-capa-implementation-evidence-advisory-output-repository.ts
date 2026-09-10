import type postgres from "postgres";
import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  fingerprintCanonicalJson,
} from "../../capa/ai/capa-ai-generation-trace";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT,
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION,
} from "../../capa/ai/capa-implementation-evidence-advisory-agent-gate";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT,
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../capa/ai/capa-implementation-evidence-advisory-contract";
import { validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings } from "../../capa/ai/capa-implementation-evidence-advisory-authoritative-validator";
import type { CapaImplementationEvidenceAdvisoryReferenceManifestEntry } from "../../capa/ai/capa-implementation-evidence-advisory-context";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE } from "../../capa/ai/capa-implementation-evidence-advisory-model-generator";
import { validateCapaImplementationEvidenceAdvisoryModelOutput } from "../../capa/ai/capa-implementation-evidence-advisory-validator";
import type {
  CapaImplementationEvidenceAdvisoryOutputRepository,
  CapaImplementationEvidenceAdvisoryOutputRecord,
  CapaImplementationEvidenceAdvisoryReferenceManifest,
} from "../repositories/capa-implementation-evidence-advisory-output-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

const MANIFEST_VERSION = "capa-implementation-evidence-advisory-reference-manifest-1.0.0" as const;
const PROMPT_PACKAGE_VERSION = "capa-implementation-evidence-advisory-prompt-package-1.0.0" as const;
const EVIDENCE_MANIFEST_VERSION = "capa-implementation-evidence-advisory-evidence-manifest-1.0.0" as const;
const POLICY_MANIFEST_VERSION = "capa-implementation-evidence-advisory-policy-manifest-1.0.0" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError extends Error {
  constructor() {
    super("The governed S80 implementation-evidence advisory output could not be persisted.");
    this.name = "SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError";
  }
}

function json(value: unknown): postgres.JSONValue {
  try { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; }
  catch { throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError(); }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean { const expected = new Set(fields); const actual = Object.keys(value); return actual.length === fields.length && actual.every((field) => expected.has(field)); }
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function iso(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function tuple(row: Record<string, unknown>, expected: Readonly<Record<string, unknown>>): boolean { return Object.entries(expected).every(([key, value]) => row[key] === value); }

function advisoryPayload(value: unknown): value is Record<string, unknown> {
  if (!object(value) || !Array.isArray(value.citations)) return false;
  try { validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify({ ...value, citations: [] })); return true; }
  catch { return false; }
}

function validManifestDocument(value: unknown): value is { readonly manifest_schema_version: typeof MANIFEST_VERSION; readonly entries: readonly CapaImplementationEvidenceAdvisoryReferenceManifestEntry[] } {
  if (!object(value) || !exactFields(value, ["manifest_schema_version", "entries"]) || value.manifest_schema_version !== MANIFEST_VERSION || !Array.isArray(value.entries)) return false;
  const keys = new Set<string>();
  return value.entries.every((entry) => {
    if (!object(entry) || !exactFields(entry, ["reference_key", "source_kind", "source_reference", "source_status", "locator"]) || typeof entry.reference_key !== "string" || !/^R[1-9][0-9]{0,2}$/.test(entry.reference_key) || keys.has(entry.reference_key) || typeof entry.source_reference !== "string" || entry.source_reference.length === 0 || !["approved_action", "implementation_evidence", "governed_knowledge"].includes(entry.source_kind as string) || !["authoritative", "untrusted_human_draft", "governed_current_effective"].includes(entry.source_status as string) || (entry.locator !== null && typeof entry.locator !== "string")) return false;
    keys.add(entry.reference_key);
    return true;
  });
}

function validCitations(value: unknown, manifest: readonly CapaImplementationEvidenceAdvisoryReferenceManifestEntry[]): boolean {
  if (!Array.isArray(value)) return false;
  const entries = new Map(manifest.map((entry) => [entry.reference_key, entry]));
  return value.every((citation) => {
    if (!object(citation) || !exactFields(citation, ["reference_key", "source_kind", "source_reference", "source_status", "locator"]) || typeof citation.reference_key !== "string" || typeof citation.source_reference !== "string" || (citation.locator !== null && typeof citation.locator !== "string")) return false;
    const entry = entries.get(citation.reference_key);
    return entry !== undefined && entry.source_kind === citation.source_kind && entry.source_reference === citation.source_reference && entry.source_status === citation.source_status && entry.locator === citation.locator;
  });
}

function validTrace(output: Record<string, unknown>, trace: Record<string, unknown>): boolean {
  const packageValue = trace.prompt_package ?? trace.package;
  if (!object(packageValue) || !exactFields(packageValue, ["package_schema_version", "scope", "agent", "trace", "generation_contract", "context_provenance", "governance"]) || packageValue.package_schema_version !== PROMPT_PACKAGE_VERSION) return false;
  const scope = packageValue.scope;
  const agent = packageValue.agent;
  const identity = packageValue.trace;
  const generation = packageValue.generation_contract;
  const provenance = packageValue.context_provenance;
  const governance = packageValue.governance;
  if (!object(scope) || !exactFields(scope, ["organization_id", "capa_case_id", "case_version_id", "record_version", "workflow_state"]) || !object(agent) || !exactFields(agent, ["agent_id", "agent_version"]) || !object(identity) || !exactFields(identity, ["run_id", "prompt_package_id", "request_id", "correlation_id", "assembled_at"]) || !object(generation) || !exactFields(generation, ["operation", "requested_output", "output_schema_version", "model_profile_version", "output_schema_name", "output_schema_sha256", "store", "maximum_output_characters"]) || !object(provenance) || !exactFields(provenance, ["model_safe_context", "approved_s70_baseline", "knowledge_provenance"]) || !object(governance) || !exactFields(governance, ["advisory_only", "workflow_mutated", "controlled_record_mutated", "human_acceptance_required"])) return false;
  if (!tuple(scope, { organization_id: output.organization_id, capa_case_id: output.capa_case_id, case_version_id: output.case_version_id, record_version: output.record_version, workflow_state: "S80" }) || agent.agent_id !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id || agent.agent_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version || !tuple(identity, { run_id: output.run_id, request_id: output.request_id, correlation_id: output.correlation_id }) || !uuid(identity.prompt_package_id) || !iso(identity.assembled_at) || generation.operation !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION || generation.requested_output !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT || generation.output_schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION || generation.model_profile_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version || generation.output_schema_name !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name || generation.store !== false || !hash(generation.output_schema_sha256) || !tuple(governance, { advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, human_acceptance_required: true })) return false;
  const fingerprints = object(trace.fingerprints) ? trace.fingerprints : trace;
  const fingerprintAlgorithm = object(trace.fingerprints) ? fingerprints.algorithm : trace.fingerprint_algorithm;
  const promptPackageHash = object(trace.fingerprints) ? fingerprints.prompt_package_sha256 : trace.prompt_package_sha256;
  const renderedPromptHash = object(trace.fingerprints) ? fingerprints.rendered_prompt_sha256 : trace.rendered_prompt_sha256;
  const evidenceManifestHash = object(trace.fingerprints) ? fingerprints.evidence_manifest_sha256 : trace.evidence_manifest_sha256;
  const policyManifestHash = object(trace.fingerprints) ? fingerprints.policy_manifest_sha256 : trace.policy_manifest_sha256;
  const outputSchemaHash = object(trace.fingerprints) ? fingerprints.output_schema_sha256 : generation.output_schema_sha256;
  if (trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION || fingerprintAlgorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM || !object(trace.evidence_manifest) || !object(trace.policy_manifest) || !hash(promptPackageHash) || !hash(renderedPromptHash) || !hash(evidenceManifestHash) || !hash(policyManifestHash) || !hash(outputSchemaHash)) return false;
  const evidenceManifest = trace.evidence_manifest;
  const policyManifest = trace.policy_manifest;
  if (!exactFields(evidenceManifest, ["evidence_manifest_schema_version", "retrieval_performed", "item_count", "items"]) || evidenceManifest.evidence_manifest_schema_version !== EVIDENCE_MANIFEST_VERSION || typeof evidenceManifest.retrieval_performed !== "boolean" || !Number.isSafeInteger(evidenceManifest.item_count) || !Array.isArray(evidenceManifest.items) || evidenceManifest.item_count !== evidenceManifest.items.length || !exactFields(policyManifest, ["policy_manifest_schema_version", "agent", "workflow_state", "operation", "requested_output", "output_schema_version", "generation", "authority", "prohibitions"]) || policyManifest.policy_manifest_schema_version !== POLICY_MANIFEST_VERSION || !object(policyManifest.agent) || !tuple(policyManifest.agent, { agent_id: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id, agent_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version }) || policyManifest.workflow_state !== "S80" || policyManifest.operation !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION || policyManifest.requested_output !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT || policyManifest.output_schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION || !object(policyManifest.generation) || !tuple(policyManifest.generation, { model_profile_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version, output_schema_name: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name, output_schema_sha256: generation.output_schema_sha256 }) || !object(policyManifest.authority) || !tuple(policyManifest.authority, { advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, human_acceptance_required: true }) || !Array.isArray(policyManifest.prohibitions)) return false;
  return promptPackageHash === fingerprintCanonicalJson(packageValue) && evidenceManifestHash === fingerprintCanonicalJson(evidenceManifest) && policyManifestHash === fingerprintCanonicalJson(policyManifest) && trace.model_profile_version === CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version && outputSchemaHash === generation.output_schema_sha256;
}

function validateInput(input: Parameters<CapaImplementationEvidenceAdvisoryOutputRepository["save"]>[1]): CapaImplementationEvidenceAdvisoryReferenceManifest {
  const { context, response, generation_trace: trace } = input;
  const traceRecord = trace as unknown as Record<string, unknown>;
  const traceValid = validTrace({ organization_id: context.organization_id, capa_case_id: context.capa_case_id, case_version_id: context.case_version_id, record_version: context.record_version, run_id: response.run_id, request_id: input.request_id, correlation_id: input.correlation_id }, traceRecord);
  if (context.trust !== "authoritative_server_context" || context.workflow_state !== "S80" || !uuid(context.organization_id) || !uuid(context.capa_case_id) || !uuid(context.case_version_id) || !Number.isSafeInteger(context.record_version) || context.record_version < 1 || !uuid(input.request_id) || !uuid(input.correlation_id) || !uuid(response.run_id) || !uuid(response.output_id) || response.output_schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION || response.schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION || response.status !== "completed_draft" || response.advisory_only !== true || response.workflow_mutated !== false || response.controlled_record_mutated !== false || response.approval_claimed !== false || response.workflow_transition !== null || response.human_acceptance_required !== true || !Array.isArray(response.warnings) || !Array.isArray(response.uncertainty_and_limitations) || !Array.isArray(response.citations) || !traceValid) throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError();
  const payload = { schema_version: response.schema_version, status: response.status, advisory_summary: response.advisory_summary, findings: response.findings, warnings: response.warnings, uncertainty_and_limitations: response.uncertainty_and_limitations, citations: [], advisory_only: response.advisory_only, workflow_mutated: response.workflow_mutated, controlled_record_mutated: response.controlled_record_mutated, approval_claimed: response.approval_claimed, workflow_transition: response.workflow_transition, human_acceptance_required: response.human_acceptance_required };
  try { validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(payload)); } catch { throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError(); }
  const document = { manifest_schema_version: MANIFEST_VERSION, entries: input.reference_manifest.map((entry) => ({ ...entry })) } as const;
  if (!validManifestDocument(document) || !validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(response, context, input.reference_manifest)) throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError();
  return { document, fingerprint_algorithm: CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM, reference_manifest_sha256: fingerprintCanonicalJson(document) };
}

export class SupabaseCapaImplementationEvidenceAdvisoryOutputRepository implements CapaImplementationEvidenceAdvisoryOutputRepository {
  constructor(private readonly sql?: postgres.Sql) {}

  async findById(organizationId: string, outputId: string): Promise<CapaImplementationEvidenceAdvisoryOutputRecord | null> {
    try {
      if (this.sql === undefined || !uuid(organizationId) || !uuid(outputId)) return null;
      const outputs = await this.sql<postgres.Row[]>`select * from public.capa_ai_outputs where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      const traces = await this.sql<postgres.Row[]>`select * from public.capa_ai_generation_traces where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      const manifests = await this.sql<postgres.Row[]>`select * from public.capa_ai_reference_manifests where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      if (outputs.length !== 1 || traces.length !== 1 || manifests.length !== 1) return null;
      const output = outputs[0]!;
      const trace = traces[0]!;
      const manifest = manifests[0]!;
      const recordVersion = Number(output.record_version);
      if (!tuple(output, { organization_id: organizationId, output_id: outputId }) || !uuid(output.capa_case_id) || !uuid(output.case_version_id) || !uuid(output.run_id) || !uuid(output.request_id) || !uuid(output.correlation_id) || !Number.isSafeInteger(recordVersion) || recordVersion < 1 || output.agent_id !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id || output.agent_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version || output.output_schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION || output.status !== "completed_draft" || output.advisory_only !== true || output.workflow_mutated !== false || output.human_acceptance_required !== true || !object(output.output_payload) || !advisoryPayload(output.output_payload) || !validTrace({ ...output, record_version: recordVersion }, trace) || !tuple(trace, { organization_id: output.organization_id, output_id: output.output_id, run_id: output.run_id, capa_case_id: output.capa_case_id, case_version_id: output.case_version_id, record_version: output.record_version, output_status: output.status, request_id: output.request_id, correlation_id: output.correlation_id }) || !tuple(manifest, { organization_id: output.organization_id, output_id: output.output_id, run_id: output.run_id, capa_case_id: output.capa_case_id, case_version_id: output.case_version_id, record_version: output.record_version, request_id: output.request_id, correlation_id: output.correlation_id, output_status: output.status }) || manifest.manifest_schema_version !== MANIFEST_VERSION || manifest.fingerprint_algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM || !validManifestDocument(manifest.reference_manifest) || !hash(manifest.reference_manifest_sha256) || manifest.reference_manifest_sha256 !== fingerprintCanonicalJson(manifest.reference_manifest)) return null;
      const payload = output.output_payload;
      const persistedManifest = manifest.reference_manifest;
      if (!validCitations(payload.citations, persistedManifest.entries)) return null;
      const packageValue = trace.prompt_package as Record<string, unknown>;
      const generation = packageValue.generation_contract as Record<string, unknown>;
      const response = { ...validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify({ ...payload, citations: [] })), citations: payload.citations, run_id: output.run_id, output_id: output.output_id, output_schema_version: output.output_schema_version } as CapaImplementationEvidenceAdvisoryOutputRecord["response"];
      return { organization_id: organizationId, capa_case_id: output.capa_case_id as string, case_version_id: output.case_version_id as string, record_version: recordVersion, request_trace: { request_id: output.request_id as never, correlation_id: output.correlation_id as never }, response, generation_trace: { trace_schema_version: trace.trace_schema_version as never, package: packageValue, rendered_prompt: "", model_profile_version: trace.model_profile_version as string, output_schema_name: generation.output_schema_name as string, output_schema: {}, store: false, maximum_output_characters: Number(generation.maximum_output_characters), evidence_manifest: trace.evidence_manifest, policy_manifest: trace.policy_manifest, fingerprints: { algorithm: (trace.fingerprint_algorithm ?? (trace.fingerprints as Record<string, unknown>).algorithm) as never, prompt_package_sha256: trace.prompt_package_sha256 as string, rendered_prompt_sha256: trace.rendered_prompt_sha256 as string, evidence_manifest_sha256: trace.evidence_manifest_sha256 as string, policy_manifest_sha256: trace.policy_manifest_sha256 as string, output_schema_sha256: generation.output_schema_sha256 as string } }, reference_manifest: { document: persistedManifest, fingerprint_algorithm: manifest.fingerprint_algorithm, reference_manifest_sha256: manifest.reference_manifest_sha256 } as CapaImplementationEvidenceAdvisoryReferenceManifest };
    } catch { return null; }
  }

  async save(transaction: TransactionContext, input: Parameters<CapaImplementationEvidenceAdvisoryOutputRepository["save"]>[1]): Promise<"saved" | "case_changed"> {
    let sql: postgres.TransactionSql;
    try { sql = requireSupabaseTransaction(transaction); }
    catch { throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError(); }
    if (transaction.request_trace.request_id !== input.request_id || transaction.request_trace.correlation_id !== input.correlation_id) throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError();
    let manifest: CapaImplementationEvidenceAdvisoryReferenceManifest;
    try { manifest = validateInput(input); }
    catch { throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError(); }
    const trace = input.generation_trace;
    try {
      const current = await sql<postgres.Row[]>`select capa_case_id from public.capa_cases where organization_id = ${input.context.organization_id} and capa_case_id = ${input.context.capa_case_id} and current_version_id = ${input.context.case_version_id} and record_version = ${input.context.record_version} and status = 'S80' for update`;
      if (current.length !== 1) return "case_changed";
      await sql`insert into public.capa_ai_outputs (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, agent_id, agent_version, output_schema_version, status, output_payload, advisory_only, workflow_mutated, human_acceptance_required, created_at) values (${input.context.organization_id}, ${input.response.output_id}, ${input.response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, ${CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id}, ${CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version}, ${input.response.output_schema_version}, ${input.response.status}, ${sql.json(json({ schema_version: input.response.schema_version, status: input.response.status, advisory_summary: input.response.advisory_summary, findings: input.response.findings, warnings: input.response.warnings, uncertainty_and_limitations: input.response.uncertainty_and_limitations, citations: input.response.citations, advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true }))}, true, false, true, ${transaction.started_at})`;
      const packageTrace = trace.package.trace as unknown as { readonly prompt_package_id: string; readonly assembled_at: string };
      await sql`insert into public.capa_ai_generation_traces (organization_id, run_id, output_id, capa_case_id, case_version_id, record_version, output_status, request_id, correlation_id, prompt_package_id, trace_schema_version, fingerprint_algorithm, prompt_package, prompt_package_sha256, rendered_prompt_sha256, evidence_manifest, evidence_manifest_sha256, policy_manifest, policy_manifest_sha256, model_profile_version, assembled_at) values (${input.context.organization_id}, ${input.response.run_id}, ${input.response.output_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.response.status}, ${input.request_id}, ${input.correlation_id}, ${packageTrace.prompt_package_id}, ${trace.trace_schema_version}, ${trace.fingerprints.algorithm}, ${sql.json(json(trace.package))}, ${trace.fingerprints.prompt_package_sha256}, ${trace.fingerprints.rendered_prompt_sha256}, ${sql.json(json(trace.evidence_manifest))}, ${trace.fingerprints.evidence_manifest_sha256}, ${sql.json(json(trace.policy_manifest))}, ${trace.fingerprints.policy_manifest_sha256}, ${trace.model_profile_version}, ${packageTrace.assembled_at})`;
      await sql`insert into public.capa_ai_reference_manifests (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, output_status, manifest_schema_version, fingerprint_algorithm, reference_manifest, reference_manifest_sha256, created_at) values (${input.context.organization_id}, ${input.response.output_id}, ${input.response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, ${input.response.status}, ${manifest.document.manifest_schema_version}, ${manifest.fingerprint_algorithm}, ${sql.json(json(manifest.document))}, ${manifest.reference_manifest_sha256}, ${transaction.started_at})`;
      return "saved";
    } catch { throw new SupabaseCapaImplementationEvidenceAdvisoryOutputRepositoryError(); }
  }
}
