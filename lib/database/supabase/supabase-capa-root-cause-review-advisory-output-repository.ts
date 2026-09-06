import type postgres from "postgres";
import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaRootCauseReviewAdvisoryResponse,
} from "../../capa/ai/capa-root-cause-review-advisory-contract";
import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_POLICY_MANIFEST_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_PROMPT_PACKAGE_SCHEMA_VERSION,
  type CapaRootCauseReviewAdvisoryGenerationTraceCapture,
  fingerprintCanonicalJson,
} from "../../capa/ai/capa-ai-generation-trace";
import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION,
} from "../../capa/ai/capa-root-cause-review-advisory-agent-gate";
import type {
  CapaRootCauseReviewAdvisoryReferenceManifestEntry,
  AuthoritativeS50RootCauseReviewContext,
} from "../../capa/ai/capa-root-cause-review-advisory-context";
import {
  validateCapaRootCauseReviewAdvisoryModelOutput,
} from "../../capa/ai/capa-root-cause-review-advisory-validator";
import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE,
} from "../../capa/ai/capa-root-cause-review-advisory-model-generator";
import type {
  CapaRootCauseReviewAdvisoryOutputRecord,
  CapaRootCauseReviewAdvisoryOutputRepository,
  CapaRootCauseReviewAdvisoryReferenceManifest,
} from "../repositories/capa-root-cause-review-advisory-output-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

const REFERENCE_MANIFEST_SCHEMA_VERSION =
  "capa-root-cause-review-reference-manifest-1.0.0" as const;
const REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM =
  "sha256-canonical-json-v1" as const;

interface CurrentCapaRow extends postgres.Row {
  readonly capa_case_id: string;
}

export class SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError extends Error {
  constructor() {
    super("The governed CAPA S50 root-cause review advisory output could not be persisted.");
    this.name = "SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError";
  }
}

function json(value: unknown): postgres.JSONValue {
  try { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; }
  catch { throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError(); }
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const expected = new Set(fields);
  return Object.keys(value).length === fields.length && Object.keys(value).every((field) => expected.has(field));
}
function exactTuple(row: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => row[key] === value);
}

function createReferenceManifest(
  entries: readonly CapaRootCauseReviewAdvisoryReferenceManifestEntry[],
  modelSafeContext: unknown,
): CapaRootCauseReviewAdvisoryReferenceManifest {
  if (!object(modelSafeContext) || modelSafeContext.trust !== "model_safe_context" || !Array.isArray(modelSafeContext.references)) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  const references = modelSafeContext.references;
  if (references.some((reference) => !object(reference) || Object.hasOwn(reference, "source_id"))) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  if (entries.length !== references.length) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  const safeKeys = new Set<string>();
  for (const reference of references) {
    if (!object(reference) || typeof reference.reference_key !== "string" || safeKeys.has(reference.reference_key)) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
    safeKeys.add(reference.reference_key);
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!object(entry) || typeof entry.reference_key !== "string" || seen.has(entry.reference_key) || entry.trust !== "authoritative_server_context" || typeof entry.source_id !== "string" || entry.source_id.trim().length === 0 || !["current", "comparison"].includes(entry.version_scope) || !["investigation_plan_item", "ledger_item", "causal_hypothesis", "root_cause_not_confirmed"].includes(entry.source_kind)) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
    seen.add(entry.reference_key);
    const matches = references.filter((candidate) => object(candidate) && candidate.reference_key === entry.reference_key && candidate.source_kind === entry.source_kind && candidate.version_scope === entry.version_scope);
    if (matches.length !== 1) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  }
  for (const reference of references) {
    const matches = entries.filter((entry) => entry.reference_key === reference.reference_key && entry.source_kind === reference.source_kind && entry.version_scope === reference.version_scope);
    if (matches.length !== 1) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  }
  const document = { manifest_schema_version: REFERENCE_MANIFEST_SCHEMA_VERSION, entries: entries.map((entry) => ({ ...entry })) } as const;
  return { document, fingerprint_algorithm: REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, reference_manifest_sha256: fingerprintCanonicalJson(document) };
}

function validate(input: Parameters<CapaRootCauseReviewAdvisoryOutputRepository["save"]>[1]): CapaRootCauseReviewAdvisoryReferenceManifest {
  const { context, response, generation_trace: trace } = input;
  if (!object(response) || !exactFields(response, ["run_id", "output_id", "output_schema_version", "status", "proposal", "uncertainty_and_limitations", "citations", "warnings", "advisory_only", "workflow_mutated", "controlled_record_mutated", "review_disposition", "workflow_transition", "human_acceptance_required"])) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  const scope = trace.package.scope;
  const identity = trace.package.trace;
  const generation = trace.package.generation_contract;
  const policy = trace.policy_manifest;
  if (context.trust !== "authoritative_server_context" || context.workflow_state !== "S50" || !uuid(context.organization_id) || !uuid(context.capa_case_id) || !uuid(context.case_version_id) || !Number.isSafeInteger(context.record_version) || context.record_version <= 0 || !uuid(input.request_id) || !uuid(input.correlation_id) || !uuid(response.output_id) || !uuid(response.run_id) || response.status !== "completed_draft" || response.output_schema_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION || response.advisory_only !== true || response.workflow_mutated !== false || response.controlled_record_mutated !== false || response.review_disposition !== null || response.workflow_transition !== null || response.human_acceptance_required !== true || !Array.isArray(response.uncertainty_and_limitations) || !Array.isArray(response.citations) || response.citations.length !== 0 || !Array.isArray(response.warnings) || response.warnings.length !== 0 || trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION || trace.store !== false || trace.package.package_schema_version !== CAPA_ROOT_CAUSE_REVIEW_PROMPT_PACKAGE_SCHEMA_VERSION || trace.package.agent.agent_id !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.agent_id || trace.package.agent.agent_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_AGENT.agent_version || generation.operation !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION || generation.output_schema_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION || generation.store !== false || policy.policy_manifest_schema_version !== CAPA_ROOT_CAUSE_REVIEW_POLICY_MANIFEST_SCHEMA_VERSION || policy.workflow_state !== "S50" || policy.operation !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OPERATION || policy.output_schema_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION || policy.authority.advisory_only !== true || policy.authority.workflow_mutated !== false || policy.authority.controlled_record_mutated !== false || policy.authority.human_acceptance_required !== true || trace.evidence_manifest.evidence_manifest_schema_version !== CAPA_ROOT_CAUSE_REVIEW_EVIDENCE_MANIFEST_SCHEMA_VERSION || trace.evidence_manifest.retrieval_performed !== false || trace.evidence_manifest.item_count !== 0 || !Array.isArray(trace.evidence_manifest.items) || trace.evidence_manifest.items.length !== 0 || trace.fingerprints.algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM || !hash(trace.fingerprints.prompt_package_sha256) || !hash(trace.fingerprints.rendered_prompt_sha256) || !hash(trace.fingerprints.evidence_manifest_sha256) || !hash(trace.fingerprints.policy_manifest_sha256) || identity.run_id !== response.run_id || identity.request_id !== input.request_id || identity.correlation_id !== input.correlation_id || scope.organization_id !== context.organization_id || scope.capa_case_id !== context.capa_case_id || scope.case_version_id !== context.case_version_id || scope.record_version !== context.record_version || scope.workflow_state !== "S50") throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  validateCapaRootCauseReviewAdvisoryModelOutput(JSON.stringify({ schema_version: response.output_schema_version, status: response.status, proposal: response.proposal, uncertainty_and_limitations: response.uncertainty_and_limitations, citations: response.citations, advisory_only: response.advisory_only, workflow_mutated: response.workflow_mutated, controlled_record_mutated: response.controlled_record_mutated, review_disposition: response.review_disposition, workflow_transition: response.workflow_transition, human_acceptance_required: response.human_acceptance_required }));
  if (trace.fingerprints.prompt_package_sha256 !== fingerprintCanonicalJson(trace.package) || trace.fingerprints.evidence_manifest_sha256 !== fingerprintCanonicalJson(trace.evidence_manifest) || trace.fingerprints.policy_manifest_sha256 !== fingerprintCanonicalJson(trace.policy_manifest) || generation.output_schema_sha256 !== fingerprintCanonicalJson(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA) || trace.fingerprints.output_schema_sha256 !== generation.output_schema_sha256 || trace.model_profile_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
  return createReferenceManifest(input.reference_manifest, trace.package.context_provenance.model_safe_context);
}

export class SupabaseCapaRootCauseReviewAdvisoryOutputRepository implements CapaRootCauseReviewAdvisoryOutputRepository {
  constructor(private readonly sql?: postgres.Sql) {}

  async findById(organizationId: string, outputId: string): Promise<CapaRootCauseReviewAdvisoryOutputRecord | null> {
    try {
      if (this.sql === undefined) return null;
      const outputs = await this.sql<postgres.Row[]>`select * from public.capa_ai_outputs where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      const traces = await this.sql<postgres.Row[]>`select * from public.capa_ai_generation_traces where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      const manifests = await this.sql<postgres.Row[]>`select * from public.capa_ai_reference_manifests where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      if (outputs.length !== 1 || traces.length !== 1 || manifests.length !== 1) return null;
      const output = outputs[0]!;
      const trace = traces[0]!;
      const manifest = manifests[0]!;
      const recordVersion = Number(output.record_version);
      if (!uuid(organizationId) || !uuid(outputId) || !exactTuple(output, { organization_id: organizationId, output_id: outputId }) || !uuid(output.capa_case_id) || !uuid(output.case_version_id) || !Number.isSafeInteger(recordVersion) || recordVersion <= 0 || output.agent_id !== "AG-REVIEW" || output.agent_version !== "ag-review-1.0.0" || output.output_schema_version !== CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION || output.status !== "completed_draft" || output.advisory_only !== true || output.workflow_mutated !== false || output.human_acceptance_required !== true || !object(output.output_payload) || !object(trace.prompt_package) || !object(trace.evidence_manifest) || !object(trace.policy_manifest) || !object(manifest.reference_manifest) || manifest.manifest_schema_version !== REFERENCE_MANIFEST_SCHEMA_VERSION || manifest.fingerprint_algorithm !== REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM || !hash(manifest.reference_manifest_sha256)) return null;
      const payload = output.output_payload;
      const response = validateCapaRootCauseReviewAdvisoryModelOutput(JSON.stringify({ schema_version: output.output_schema_version, status: output.status, ...payload }));
      if (!exactTuple(trace, { organization_id: output.organization_id, output_id: output.output_id, run_id: output.run_id, capa_case_id: output.capa_case_id, case_version_id: output.case_version_id, record_version: output.record_version, output_status: output.status, request_id: output.request_id, correlation_id: output.correlation_id }) || trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION || trace.fingerprint_algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM || trace.prompt_package_sha256 !== fingerprintCanonicalJson(trace.prompt_package) || trace.evidence_manifest_sha256 !== fingerprintCanonicalJson(trace.evidence_manifest) || trace.policy_manifest_sha256 !== fingerprintCanonicalJson(trace.policy_manifest) || manifest.reference_manifest_sha256 !== fingerprintCanonicalJson(manifest.reference_manifest)) return null;
      const packageValue = trace.prompt_package as unknown as CapaRootCauseReviewAdvisoryGenerationTraceCapture["package"];
      const persistedManifest: CapaRootCauseReviewAdvisoryReferenceManifest = { document: manifest.reference_manifest as CapaRootCauseReviewAdvisoryReferenceManifest["document"], fingerprint_algorithm: manifest.fingerprint_algorithm as "sha256-canonical-json-v1", reference_manifest_sha256: manifest.reference_manifest_sha256 as string };
      return { organization_id: organizationId, capa_case_id: output.capa_case_id as string, case_version_id: output.case_version_id as string, record_version: recordVersion, request_trace: { request_id: output.request_id as never, correlation_id: output.correlation_id as never }, response: { ...response, run_id: output.run_id as never, output_id: output.output_id as never, output_schema_version: output.output_schema_version as never, status: output.status as "completed_draft", warnings: [] } as CapaRootCauseReviewAdvisoryResponse, generation_trace: { trace_schema_version: trace.trace_schema_version as never, package: packageValue, rendered_prompt: "", model_profile_version: trace.model_profile_version as string, output_schema_name: "", output_schema: {}, store: false, maximum_output_characters: 0, evidence_manifest: trace.evidence_manifest as never, policy_manifest: trace.policy_manifest as never, fingerprints: { algorithm: trace.fingerprint_algorithm as never, prompt_package_sha256: trace.prompt_package_sha256 as string, rendered_prompt_sha256: trace.rendered_prompt_sha256 as string, evidence_manifest_sha256: trace.evidence_manifest_sha256 as string, policy_manifest_sha256: trace.policy_manifest_sha256 as string, output_schema_sha256: packageValue.generation_contract.output_schema_sha256 }, }, reference_manifest: persistedManifest };
    } catch { return null; }
  }

  async save(transaction: TransactionContext, input: Parameters<CapaRootCauseReviewAdvisoryOutputRepository["save"]>[1]): Promise<"saved" | "case_changed"> {
    let sql: postgres.TransactionSql;
    try { sql = requireSupabaseTransaction(transaction); } catch { throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError(); }
    if (transaction.request_trace.request_id !== input.request_id || transaction.request_trace.correlation_id !== input.correlation_id) throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError();
    let manifest: CapaRootCauseReviewAdvisoryReferenceManifest;
    try { manifest = validate(input); } catch (error) { if (error instanceof SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError) throw error; throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError(); }
    try {
      const current = await sql<CurrentCapaRow[]>`select capa_case_id from public.capa_cases where organization_id = ${input.context.organization_id} and capa_case_id = ${input.context.capa_case_id} and current_version_id = ${input.context.case_version_id} and record_version = ${input.context.record_version} and status = 'S50' for update`;
      if (current[0] === undefined) return "case_changed";
      const { response, generation_trace: trace } = input;
      await sql`insert into public.capa_ai_outputs (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, agent_id, agent_version, output_schema_version, status, output_payload, advisory_only, workflow_mutated, human_acceptance_required, created_at) values (${input.context.organization_id}, ${response.output_id}, ${response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, 'AG-REVIEW', 'ag-review-1.0.0', ${response.output_schema_version}, ${response.status}, ${sql.json(json({ schema_version: response.output_schema_version, status: response.status, proposal: response.proposal, uncertainty_and_limitations: response.uncertainty_and_limitations, citations: response.citations, advisory_only: response.advisory_only, workflow_mutated: response.workflow_mutated, controlled_record_mutated: response.controlled_record_mutated, review_disposition: response.review_disposition, workflow_transition: response.workflow_transition, human_acceptance_required: response.human_acceptance_required }))}, ${response.advisory_only}, ${response.workflow_mutated}, ${response.human_acceptance_required}, ${transaction.started_at})`;
      await sql`insert into public.capa_ai_generation_traces (organization_id, run_id, output_id, capa_case_id, case_version_id, record_version, output_status, request_id, correlation_id, prompt_package_id, trace_schema_version, fingerprint_algorithm, prompt_package, prompt_package_sha256, rendered_prompt_sha256, evidence_manifest, evidence_manifest_sha256, policy_manifest, policy_manifest_sha256, model_profile_version, assembled_at) values (${input.context.organization_id}, ${response.run_id}, ${response.output_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${response.status}, ${input.request_id}, ${input.correlation_id}, ${trace.package.trace.prompt_package_id}, ${trace.trace_schema_version}, ${trace.fingerprints.algorithm}, ${sql.json(json(trace.package))}, ${trace.fingerprints.prompt_package_sha256}, ${trace.fingerprints.rendered_prompt_sha256}, ${sql.json(json(trace.evidence_manifest))}, ${trace.fingerprints.evidence_manifest_sha256}, ${sql.json(json(trace.policy_manifest))}, ${trace.fingerprints.policy_manifest_sha256}, ${trace.model_profile_version}, ${trace.package.trace.assembled_at})`;
      await sql`insert into public.capa_ai_reference_manifests (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, output_status, manifest_schema_version, fingerprint_algorithm, reference_manifest, reference_manifest_sha256, created_at) values (${input.context.organization_id}, ${response.output_id}, ${response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, ${response.status}, ${manifest.document.manifest_schema_version}, ${manifest.fingerprint_algorithm}, ${sql.json(json(manifest.document))}, ${manifest.reference_manifest_sha256}, ${transaction.started_at})`;
    } catch { throw new SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError(); }
    return "saved";
  }
}
