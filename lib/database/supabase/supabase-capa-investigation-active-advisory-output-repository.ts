import type postgres from "postgres";

import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationActiveAdvisoryResponse,
} from "../../capa/ai/capa-investigation-active-advisory-contract";
import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_POLICY_MANIFEST_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_PROMPT_PACKAGE_SCHEMA_VERSION,
  type CapaInvestigationActiveAdvisoryGenerationTraceCapture,
  fingerprintCanonicalJson,
} from "../../capa/ai/capa-ai-generation-trace";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION,
} from "../../capa/ai/capa-investigation-active-advisory-agent-gate";
import {
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
  createCapaInvestigationActiveAdvisoryReferenceManifest,
  validateCapaInvestigationActiveAdvisoryModelSafeContext,
  validateCapaInvestigationActiveAdvisoryReferenceManifest,
} from "../../capa/ai/capa-investigation-active-advisory-reference-manifest";
import {
  validateCapaInvestigationActiveAdvisoryModelOutput,
} from "../../capa/ai/capa-investigation-active-advisory-output-validator";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE,
} from "../../capa/ai/capa-investigation-active-advisory-model-profile";
import type { CapaInvestigationActiveAdvisoryOutputRepository, CapaInvestigationActiveAdvisoryOutputRecord } from "../repositories/capa-investigation-active-advisory-output-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

interface CurrentCapaRow extends postgres.Row { readonly capa_case_id: string; }

export class SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError extends Error {
  constructor() {
    super("The governed CAPA investigation-active advisory output could not be persisted.");
    this.name = "SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError";
  }
}

function json(value: unknown): postgres.JSONValue {
  try { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; }
  catch { throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError(); }
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
function iso(value: unknown): string | null {
  const normalized = value instanceof Date ? value.toISOString() : value;
  return typeof normalized === "string" && !Number.isNaN(Date.parse(normalized)) ? normalized : null;
}
function exactTuple(row: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => row[key] === value);
}
function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return object(value) && exactFields(value, keys);
}
function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const expected = new Set(fields);
  const actual = Object.keys(value);
  return actual.length === fields.length && actual.every((field) => expected.has(field));
}
function outputReferences(response: CapaInvestigationActiveAdvisoryResponse): readonly string[] {
  if (!object(response.proposal)) throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
  const proposal = response.proposal as Record<string, unknown>;
  const fields = [
    ["evidence_gaps", "related_reference_keys"], ["conflicting_information", "conflicting_reference_keys"],
    ["assumptions", "related_reference_keys"], ["causal_hypotheses", "supporting_reference_keys"],
    ["causal_hypotheses", "contradictory_reference_keys"], ["alternative_hypotheses", "supporting_reference_keys"],
    ["alternative_hypotheses", "contradictory_reference_keys"], ["investigation_recommendations", "related_reference_keys"],
  ] as const;
  const result: string[] = [];
  for (const [itemsField, referencesField] of fields) {
    const items = proposal[itemsField];
    if (!Array.isArray(items)) throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
    for (const item of items) {
      if (!object(item) || !Array.isArray(item[referencesField])) throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
      for (const reference of item[referencesField]) {
        if (typeof reference !== "string") throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
        result.push(reference);
      }
    }
  }
  return result;
}

function validate(input: Parameters<CapaInvestigationActiveAdvisoryOutputRepository["save"]>[1]): ReturnType<typeof createCapaInvestigationActiveAdvisoryReferenceManifest> {
  const { context, response, generation_trace: trace } = input;
  if (!object(response) || !exactFields(response, [
    "run_id",
    "output_id",
    "output_schema_version",
    "status",
    "proposal",
    "uncertainty_and_limitations",
    "citations",
    "warnings",
    "advisory_only",
    "workflow_mutated",
    "human_acceptance_required",
  ])) {
    throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
  }
  const scope = trace.package.scope;
  const traceIdentity = trace.package.trace;
  const generation = trace.package.generation_contract;
  const policy = trace.policy_manifest;
  if (context.trust !== "authoritative_server_context" || context.workflow_state !== "S40" ||
    !uuid(context.organization_id) || !uuid(context.capa_case_id) || !uuid(context.case_version_id) ||
    !Number.isSafeInteger(context.record_version) || context.record_version <= 0 ||
    !uuid(input.request_id) || !uuid(input.correlation_id) || !uuid(response.output_id) || !uuid(response.run_id) ||
    response.status !== "completed_draft" || response.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    response.advisory_only !== true || response.workflow_mutated !== false || response.human_acceptance_required !== true ||
    !object(response.proposal) || !Array.isArray(response.uncertainty_and_limitations) ||
    !Array.isArray(response.citations) || response.citations.length !== 0 ||
    !Array.isArray(response.warnings) || response.warnings.length !== 0 ||
    trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION || trace.store !== false ||
    trace.package.package_schema_version !== CAPA_INVESTIGATION_ACTIVE_PROMPT_PACKAGE_SCHEMA_VERSION ||
    trace.package.agent.agent_id !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id ||
    trace.package.agent.agent_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version ||
    generation.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION ||
    generation.requested_output !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT ||
    generation.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || generation.store !== false ||
    policy.policy_manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_POLICY_MANIFEST_SCHEMA_VERSION ||
    policy.agent.agent_id !== "AG-RCA" || policy.agent.agent_version !== "ag-rca-1.0.0" ||
    policy.workflow_state !== "S40" || policy.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION ||
    policy.requested_output !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT ||
    policy.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    policy.authority.advisory_only !== true || policy.authority.workflow_mutated !== false ||
    policy.authority.human_acceptance_required !== true ||
    trace.evidence_manifest.evidence_manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_EVIDENCE_MANIFEST_SCHEMA_VERSION ||
    trace.evidence_manifest.retrieval_performed !== false || trace.evidence_manifest.item_count !== 0 ||
    !Array.isArray(trace.evidence_manifest.items) || trace.evidence_manifest.items.length !== 0 ||
    trace.fingerprints.algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM ||
    traceIdentity.run_id !== response.run_id || traceIdentity.request_id !== input.request_id || traceIdentity.correlation_id !== input.correlation_id ||
    scope.organization_id !== context.organization_id || scope.capa_case_id !== context.capa_case_id ||
    scope.case_version_id !== context.case_version_id || scope.record_version !== context.record_version || scope.workflow_state !== "S40") {
    throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
  }
  const modelSafe = validateCapaInvestigationActiveAdvisoryModelSafeContext(
    trace.package.context_provenance.model_safe_context,
  );
  validateCapaInvestigationActiveAdvisoryModelOutput(JSON.stringify({
    proposal: response.proposal,
    uncertainty_and_limitations: response.uncertainty_and_limitations,
    citations: response.citations,
    advisory_only: response.advisory_only,
    workflow_mutated: response.workflow_mutated,
    human_acceptance_required: response.human_acceptance_required,
  }));
  const manifest = createCapaInvestigationActiveAdvisoryReferenceManifest({
    reference_manifest: input.reference_manifest,
    model_safe_context: modelSafe,
  });
  validateCapaInvestigationActiveAdvisoryReferenceManifest(manifest.document, modelSafe);
  const allowed = new Set(manifest.document.entries.map((entry) => entry.reference_key));
  if (outputReferences(response).some((reference) => !allowed.has(reference as never))) {
    throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
  }
  return manifest;
}

export class SupabaseCapaInvestigationActiveAdvisoryOutputRepository implements CapaInvestigationActiveAdvisoryOutputRepository {
  constructor(private readonly sql?: postgres.Sql) {}

  async findById(organizationId: string, outputId: string): Promise<CapaInvestigationActiveAdvisoryOutputRecord | null> {
    try {
      if (this.sql === undefined) return null;
      const outputs = await this.sql<postgres.Row[]>`select * from public.capa_ai_outputs where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      const traces = await this.sql<postgres.Row[]>`select * from public.capa_ai_generation_traces where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      const manifests = await this.sql<postgres.Row[]>`select * from public.capa_ai_reference_manifests where organization_id = ${organizationId} and output_id = ${outputId} limit 2`;
      if (outputs.length !== 1 || traces.length !== 1 || manifests.length !== 1) return null;
      const output = outputs[0]!;
      const trace = traces[0]!;
      const manifestRow = manifests[0]!;
      if (!uuid(organizationId) || !uuid(outputId) ||
        !exactTuple(output, { organization_id: organizationId, output_id: outputId }) ||
        !uuid(output.capa_case_id) || !uuid(output.case_version_id) ||
        !Number.isSafeInteger(Number(output.record_version)) || Number(output.record_version) <= 0 ||
        output.agent_id !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id ||
        output.agent_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version ||
        output.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION ||
        output.status !== "completed_draft" || output.advisory_only !== true ||
        output.workflow_mutated !== false || output.human_acceptance_required !== true ||
        !uuid(output.run_id) || !uuid(output.request_id) || !uuid(output.correlation_id) ||
        !object(output.output_payload) || !Array.isArray(output.warnings) || output.warnings.length !== 0) return null;

      const payload = output.output_payload;
      if (!exactFields(payload, ["proposal", "uncertainty_and_limitations", "citations", "advisory_only", "workflow_mutated", "human_acceptance_required"]) ||
        payload.advisory_only !== output.advisory_only || payload.workflow_mutated !== output.workflow_mutated ||
        payload.human_acceptance_required !== output.human_acceptance_required) return null;
      const validatedPayload = validateCapaInvestigationActiveAdvisoryModelOutput(JSON.stringify(payload));

      if (!exactTuple(trace, {
        organization_id: output.organization_id, output_id: output.output_id, run_id: output.run_id,
        capa_case_id: output.capa_case_id, case_version_id: output.case_version_id,
        record_version: output.record_version, output_status: output.status,
        request_id: output.request_id, correlation_id: output.correlation_id,
      }) || trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION ||
        trace.fingerprint_algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM ||
        !object(trace.prompt_package) || !object(trace.evidence_manifest) || !object(trace.policy_manifest) ||
        !hash(trace.prompt_package_sha256) || !hash(trace.rendered_prompt_sha256) ||
        !hash(trace.evidence_manifest_sha256) || !hash(trace.policy_manifest_sha256) ||
        !object(trace.prompt_package) || !object(trace.policy_manifest)) return null;

      const packageValue = trace.prompt_package;
      const scope = packageValue.scope;
      const packageTrace = packageValue.trace;
      const generation = packageValue.generation_contract;
      const provenance = packageValue.context_provenance;
      if (!exactObject(packageValue, ["package_schema_version", "scope", "agent", "trace", "generation_contract", "context_provenance", "governance"]) ||
        packageValue.package_schema_version !== CAPA_INVESTIGATION_ACTIVE_PROMPT_PACKAGE_SCHEMA_VERSION ||
        !exactObject(scope, ["organization_id", "capa_case_id", "case_version_id", "record_version", "workflow_state"]) ||
        !exactTuple(scope, { organization_id: output.organization_id, capa_case_id: output.capa_case_id, case_version_id: output.case_version_id, record_version: output.record_version, workflow_state: "S40" }) ||
        !exactObject(packageValue.agent, ["agent_id", "agent_version"]) || packageValue.agent.agent_id !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id || packageValue.agent.agent_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version ||
        !exactObject(packageTrace, ["run_id", "prompt_package_id", "request_id", "correlation_id", "assembled_at"]) ||
        !exactTuple(packageTrace, { run_id: output.run_id, request_id: output.request_id, correlation_id: output.correlation_id }) || !uuid(packageTrace.prompt_package_id) || typeof packageTrace.assembled_at !== "string" || Number.isNaN(Date.parse(packageTrace.assembled_at)) || iso(trace.assembled_at) !== packageTrace.assembled_at ||
        !exactObject(generation, ["operation", "requested_output", "output_schema_version", "model_profile_version", "output_schema_name", "output_schema_sha256", "store", "maximum_output_characters"]) ||
        generation.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION || generation.requested_output !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT || generation.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || generation.store !== false || generation.model_profile_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version || generation.output_schema_name !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name || generation.output_schema_sha256 !== fingerprintCanonicalJson(CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA) || !hash(generation.output_schema_sha256) ||
        !exactObject(provenance, ["model_safe_context"]) ||
        !exactObject(packageValue.governance, ["advisory_only", "workflow_mutated", "human_acceptance_required"]) || packageValue.governance.advisory_only !== true || packageValue.governance.workflow_mutated !== false || packageValue.governance.human_acceptance_required !== true) return null;

      const evidence = trace.evidence_manifest;
      if (!exactObject(evidence, ["evidence_manifest_schema_version", "retrieval_performed", "item_count", "items"]) || evidence.evidence_manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_EVIDENCE_MANIFEST_SCHEMA_VERSION || evidence.retrieval_performed !== false || evidence.item_count !== 0 || !Array.isArray(evidence.items) || evidence.items.length !== 0 || trace.evidence_manifest_sha256 !== fingerprintCanonicalJson(evidence)) return null;
      const policy = trace.policy_manifest;
      if (!exactObject(policy, ["policy_manifest_schema_version", "agent", "workflow_state", "operation", "requested_output", "output_schema_version", "generation", "authority", "prohibitions"]) || policy.policy_manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_POLICY_MANIFEST_SCHEMA_VERSION || !exactObject(policy.agent, ["agent_id", "agent_version"]) || policy.agent.agent_id !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_id || policy.agent.agent_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_AGENT.agent_version || policy.workflow_state !== "S40" || policy.operation !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OPERATION || policy.requested_output !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT || policy.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || !exactObject(policy.generation, ["model_profile_version", "output_schema_name", "output_schema_sha256"]) || policy.generation.model_profile_version !== generation.model_profile_version || policy.generation.output_schema_name !== generation.output_schema_name || policy.generation.output_schema_sha256 !== generation.output_schema_sha256 || !exactObject(policy.authority, ["advisory_only", "workflow_mutated", "human_acceptance_required"]) || policy.authority.advisory_only !== true || policy.authority.workflow_mutated !== false || policy.authority.human_acceptance_required !== true || !Array.isArray(policy.prohibitions) || trace.policy_manifest_sha256 !== fingerprintCanonicalJson(policy)) return null;
      if (trace.prompt_package_sha256 !== fingerprintCanonicalJson(packageValue) || trace.model_profile_version !== generation.model_profile_version || typeof trace.model_profile_version !== "string" || trace.model_profile_version.trim().length === 0) return null;
      const modelSafe = validateCapaInvestigationActiveAdvisoryModelSafeContext(provenance.model_safe_context);

      if (!exactTuple(manifestRow, {
        organization_id: output.organization_id, output_id: output.output_id, run_id: output.run_id,
        capa_case_id: output.capa_case_id, case_version_id: output.case_version_id,
        record_version: output.record_version, request_id: output.request_id,
        correlation_id: output.correlation_id, output_status: output.status,
      }) || manifestRow.manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION || manifestRow.fingerprint_algorithm !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM || !object(manifestRow.reference_manifest) || !hash(manifestRow.reference_manifest_sha256)) return null;
      const document = validateCapaInvestigationActiveAdvisoryReferenceManifest(manifestRow.reference_manifest, modelSafe);
      const computedManifest = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest: document.entries, model_safe_context: modelSafe });
      if (manifestRow.reference_manifest_sha256 !== computedManifest.reference_manifest_sha256) return null;
      return {
        organization_id: organizationId,
        capa_case_id: output.capa_case_id as string,
        case_version_id: output.case_version_id as string,
        record_version: Number(output.record_version),
        response: { ...validatedPayload, run_id: output.run_id as never, output_id: output.output_id as never, output_schema_version: output.output_schema_version as never, status: output.status as "completed_draft", warnings: [] },
        generation_trace: { trace_schema_version: trace.trace_schema_version as never, package: packageValue as never, store: false as const, evidence_manifest: trace.evidence_manifest as never, policy_manifest: trace.policy_manifest as never, fingerprints: { algorithm: trace.fingerprint_algorithm as never, prompt_package_sha256: trace.prompt_package_sha256 as string, rendered_prompt_sha256: trace.rendered_prompt_sha256 as string, evidence_manifest_sha256: trace.evidence_manifest_sha256 as string, policy_manifest_sha256: trace.policy_manifest_sha256 as string, output_schema_sha256: generation.output_schema_sha256 as string }, model_profile_version: trace.model_profile_version as string },
        reference_manifest: computedManifest,
      };
    } catch { return null; }
  }

  async save(transaction: TransactionContext, input: Parameters<CapaInvestigationActiveAdvisoryOutputRepository["save"]>[1]): Promise<"saved" | "case_changed"> {
    let sql: postgres.TransactionSql;
    try { sql = requireSupabaseTransaction(transaction); } catch { throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError(); }
    if (transaction.request_trace.request_id !== input.request_id || transaction.request_trace.correlation_id !== input.correlation_id) throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError();
    let manifest: ReturnType<typeof createCapaInvestigationActiveAdvisoryReferenceManifest>;
    try { manifest = validate(input); } catch { throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError(); }
    const trace = input.generation_trace;
    try {
      const current = await sql<CurrentCapaRow[]>`
        select capa_case_id from public.capa_cases
        where organization_id = ${input.context.organization_id} and capa_case_id = ${input.context.capa_case_id}
          and current_version_id = ${input.context.case_version_id} and record_version = ${input.context.record_version}
          and status = 'S40' for update`;
      if (current[0] === undefined) return "case_changed";
      await sql`insert into public.capa_ai_outputs (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, agent_id, agent_version, output_schema_version, status, output_payload, advisory_only, workflow_mutated, human_acceptance_required, created_at) values (${input.context.organization_id}, ${input.response.output_id}, ${input.response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, 'AG-RCA', 'ag-rca-1.0.0', ${input.response.output_schema_version}, ${input.response.status}, ${sql.json(json({ proposal: input.response.proposal, uncertainty_and_limitations: input.response.uncertainty_and_limitations, citations: input.response.citations, advisory_only: input.response.advisory_only, workflow_mutated: input.response.workflow_mutated, human_acceptance_required: input.response.human_acceptance_required }))}, ${input.response.advisory_only}, ${input.response.workflow_mutated}, ${input.response.human_acceptance_required}, ${transaction.started_at})`;
      await sql`insert into public.capa_ai_generation_traces (organization_id, run_id, output_id, capa_case_id, case_version_id, record_version, output_status, request_id, correlation_id, prompt_package_id, trace_schema_version, fingerprint_algorithm, prompt_package, prompt_package_sha256, rendered_prompt_sha256, evidence_manifest, evidence_manifest_sha256, policy_manifest, policy_manifest_sha256, model_profile_version, assembled_at) values (${input.context.organization_id}, ${input.response.run_id}, ${input.response.output_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.response.status}, ${input.request_id}, ${input.correlation_id}, ${trace.package.trace.prompt_package_id}, ${trace.trace_schema_version}, ${trace.fingerprints.algorithm}, ${sql.json(json(trace.package))}, ${trace.fingerprints.prompt_package_sha256}, ${trace.fingerprints.rendered_prompt_sha256}, ${sql.json(json(trace.evidence_manifest))}, ${trace.fingerprints.evidence_manifest_sha256}, ${sql.json(json(trace.policy_manifest))}, ${trace.fingerprints.policy_manifest_sha256}, ${trace.model_profile_version}, ${trace.package.trace.assembled_at})`;
      await sql`insert into public.capa_ai_reference_manifests (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, output_status, manifest_schema_version, fingerprint_algorithm, reference_manifest, reference_manifest_sha256, created_at) values (${input.context.organization_id}, ${input.response.output_id}, ${input.response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, ${input.response.status}, ${manifest.document.manifest_schema_version}, ${manifest.fingerprint_algorithm}, ${sql.json(json(manifest.document))}, ${manifest.reference_manifest_sha256}, ${transaction.started_at})`;
    } catch { throw new SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError(); }
    return "saved";
  }
}
