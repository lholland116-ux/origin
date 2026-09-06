import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
  type CapaInvestigationActiveAdoptionCategory,
  type CapaInvestigationActiveAdoptionRecord,
} from "../../capa/ai/capa-investigation-active-adoption-contract";
import { validateCapaInvestigationActiveAdoptionRecord } from "../../capa/ai/capa-investigation-active-adoption-validator";
import {
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
  createCapaInvestigationActiveAdvisoryReferenceManifest,
  validateCapaInvestigationActiveAdvisoryModelSafeContext,
  validateCapaInvestigationActiveAdvisoryReferenceManifest,
} from "../../capa/ai/capa-investigation-active-advisory-reference-manifest";
import { validateCapaInvestigationActiveAdvisoryModelOutput } from "../../capa/ai/capa-investigation-active-advisory-output-validator";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationActiveAdvisoryResponse,
} from "../../capa/ai/capa-investigation-active-advisory-contract";
import { fingerprintCanonicalJson } from "../../capa/ai/capa-ai-generation-trace";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";
import type {
  AppendCapaInvestigationActiveAdoptionResult,
  CapaInvestigationActiveAdoptionPersistenceInput,
  CapaInvestigationActiveAdoptionRepository,
  PersistedCapaInvestigationActiveAdoption,
} from "../repositories/capa-investigation-active-adoption-repository";
import type { IsoDateTime } from "../../capa/domain/capa-types";

type Row = postgres.Row & Readonly<Record<string, unknown>>;
type QuerySql = postgres.Sql | postgres.TransactionSql;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export class SupabaseCapaInvestigationActiveAdoptionRepositoryError extends Error {
  constructor(message = "The governed S40 investigation-active adoption repository operation failed.") {
    super(message);
    this.name = "SupabaseCapaInvestigationActiveAdoptionRepositoryError";
  }
}
function fail(): never { throw new SupabaseCapaInvestigationActiveAdoptionRepositoryError(); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function sha(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function iso(value: unknown): IsoDateTime {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(date.getTime())) fail();
  return date.toISOString() as IsoDateTime;
}
function json(value: unknown): postgres.JSONValue {
  try { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; } catch { return fail(); }
}
function number(value: unknown): number {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(result) || result < 1) fail();
  return result;
}

function validateInput(transaction: TransactionContext, input: CapaInvestigationActiveAdoptionPersistenceInput): void {
  if (!sha(input.request_fingerprint) || !sha(input.record_fingerprint) || !uuid(input.audit_event_id) ||
      transaction.request_trace.request_id !== input.adoption.request_id ||
      transaction.request_trace.correlation_id !== input.adoption.correlation_id ||
      transaction.request_trace.idempotency_key !== input.adoption.idempotency_key) fail();
  try {
    const canonical = validateCapaInvestigationActiveAdoptionRecord(input.adoption);
    if (!isDeepStrictEqual(canonical, input.adoption) || input.adoption.adoption_policy_version !== CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION ||
        fingerprintCanonicalJson(canonical) !== input.record_fingerprint) fail();
  } catch { fail(); }
}

function adoptionFromRow(row: Row): PersistedCapaInvestigationActiveAdoption {
  if (!object(row.adoption_record) || !sha(row.request_fingerprint) || !sha(row.record_fingerprint) ||
      row.record_fingerprint_algorithm !== "sha256" || !uuid(row.audit_event_id)) fail();
  let adoption: CapaInvestigationActiveAdoptionRecord;
  try {
    adoption = validateCapaInvestigationActiveAdoptionRecord(row.adoption_record);
  } catch { fail(); }
  if (!isDeepStrictEqual(row.adoption_record, adoption) ||
      !isDeepStrictEqual(row.adopted_item, adoption.adopted_item) ||
      row.organization_id !== adoption.organization_id || row.adoption_id !== adoption.adoption_id ||
      row.output_id !== adoption.output_id || row.capa_case_id !== adoption.capa_case_id ||
      row.case_version_id !== adoption.case_version_id || number(row.record_version) !== adoption.record_version ||
      row.proposal_key !== adoption.proposal_key || row.proposal_category !== adoption.proposal_category ||
      !isDeepStrictEqual(row.resolved_reference_bindings, adoption.resolved_reference_bindings) ||
      row.reference_manifest_schema_version !== adoption.reference_manifest_schema_version ||
      row.reference_manifest_fingerprint_algorithm !== adoption.reference_manifest_fingerprint_algorithm ||
      row.reference_manifest_sha256 !== adoption.reference_manifest_sha256 ||
      row.adopted_by_actor_type !== adoption.adopted_by.actor_type || row.adopted_by_actor_id !== adoption.adopted_by.actor_id ||
      iso(row.adopted_at) !== adoption.adopted_at || row.adoption_policy_version !== adoption.adoption_policy_version ||
      row.request_id !== adoption.request_id || row.correlation_id !== adoption.correlation_id ||
      row.idempotency_key !== adoption.idempotency_key ||
      row.output_status !== "completed_draft" || row.workflow_mutated !== false ||
      row.controlled_record_mutated !== false || row.gate_approved !== false ||
      fingerprintCanonicalJson(adoption) !== row.record_fingerprint) fail();
  return Object.freeze({ adoption, request_fingerprint: row.request_fingerprint as never, record_fingerprint: row.record_fingerprint as never, audit_event_id: row.audit_event_id as never });
}

async function existingRecord(sql: QuerySql, input: CapaInvestigationActiveAdoptionPersistenceInput): Promise<PersistedCapaInvestigationActiveAdoption | null> {
  const rows = await sql<Row[]>`
    select * from public.capa_investigation_active_ai_adoptions
    where organization_id = ${input.adoption.organization_id}
      and ((idempotency_key = ${input.adoption.idempotency_key} and proposal_key = ${input.adoption.proposal_key})
        or adoption_id = ${input.adoption.adoption_id} or audit_event_id = ${input.audit_event_id})
    order by case when idempotency_key = ${input.adoption.idempotency_key} and proposal_key = ${input.adoption.proposal_key} then 0 when adoption_id = ${input.adoption.adoption_id} then 1 else 2 end, adoption_id limit 1`;
  if (rows.length > 1) fail();
  return rows[0] === undefined ? null : adoptionFromRow(rows[0]);
}
function conflict(existing: PersistedCapaInvestigationActiveAdoption, input: CapaInvestigationActiveAdoptionPersistenceInput): AppendCapaInvestigationActiveAdoptionResult {
  if (existing.adoption.idempotency_key === input.adoption.idempotency_key && existing.adoption.proposal_key === input.adoption.proposal_key) {
    return existing.request_fingerprint === input.request_fingerprint ? { status: "already_recorded", record: existing } : { status: "conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST", record: existing };
  }
  if (existing.adoption.adoption_id === input.adoption.adoption_id) return { status: "conflict", reason_code: "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT", record: existing };
  return { status: "conflict", reason_code: "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION", record: existing };
}

type Derived = { readonly category: CapaInvestigationActiveAdoptionCategory; readonly bindings: readonly unknown[] };
function derive(response: ReturnType<typeof validateCapaInvestigationActiveAdvisoryModelOutput>, entries: readonly { readonly reference_key: string; readonly trust: string; readonly source_kind: string; readonly source_id: string }[], proposalKey: string): Derived | null {
  const candidates: { key: string; category: CapaInvestigationActiveAdoptionCategory; refs: readonly { key: string; relationship: string }[] }[] = [];
  for (const item of response.proposal.evidence_gaps) candidates.push({ key: item.proposal_key, category: "evidence_gap", refs: item.related_reference_keys.map((key) => ({ key, relationship: "related" })) });
  for (const item of response.proposal.conflicting_information) candidates.push({ key: item.proposal_key, category: "conflicting_information", refs: item.conflicting_reference_keys.map((key) => ({ key, relationship: "conflicting" })) });
  for (const item of response.proposal.assumptions) candidates.push({ key: item.proposal_key, category: "assumption", refs: item.related_reference_keys.map((key) => ({ key, relationship: "related" })) });
  for (const item of response.proposal.causal_hypotheses) candidates.push({ key: item.proposal_key, category: "causal_hypothesis", refs: [...item.supporting_reference_keys.map((key) => ({ key, relationship: "supporting" })), ...item.contradictory_reference_keys.map((key) => ({ key, relationship: "contradictory" }))] });
  for (const item of response.proposal.alternative_hypotheses) candidates.push({ key: item.proposal_key, category: "alternative_hypothesis", refs: [...item.supporting_reference_keys.map((key) => ({ key, relationship: "supporting" })), ...item.contradictory_reference_keys.map((key) => ({ key, relationship: "contradictory" }))] });
  for (const item of response.proposal.investigation_recommendations) candidates.push({ key: item.proposal_key, category: "investigation_recommendation", refs: item.related_reference_keys.map((key) => ({ key, relationship: "related" })) });
  const matches = candidates.filter((candidate) => candidate.key === proposalKey);
  if (matches.length !== 1) return null;
  const byKey = new Map(entries.map((entry) => [entry.reference_key, entry]));
  const bindings = matches[0].refs.map((ref) => { const entry = byKey.get(ref.key); return entry === undefined ? null : { reference_key: entry.reference_key, relationship: ref.relationship, trust: entry.trust, source_kind: entry.source_kind, source_id: entry.source_id }; });
  if (bindings.some((binding) => binding === null)) return null;
  return { category: matches[0].category, bindings };
}

export class SupabaseCapaInvestigationActiveAdoptionRepository implements CapaInvestigationActiveAdoptionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async appendAdoption(transaction: TransactionContext, input: CapaInvestigationActiveAdoptionPersistenceInput): Promise<AppendCapaInvestigationActiveAdoptionResult> {
    let sql: postgres.TransactionSql;
    try { sql = requireSupabaseTransaction(transaction); validateInput(transaction, input); } catch { fail(); }
    const prior = await existingRecord(sql, input);
    if (prior !== null) return conflict(prior, input);
    const outputRows = await sql<Row[]>`select * from public.capa_ai_outputs where organization_id = ${input.adoption.organization_id} and output_id = ${input.adoption.output_id} limit 2`;
    if (outputRows.length > 1) fail();
    const output = outputRows[0];
    if (output === undefined) return { status: "output_not_found_or_not_authorized" };
    if (output.output_id !== input.adoption.output_id || output.capa_case_id !== input.adoption.capa_case_id || output.case_version_id !== input.adoption.case_version_id || number(output.record_version) !== input.adoption.record_version || output.status !== "completed_draft" || output.agent_id !== "AG-RCA" || output.agent_version !== "ag-rca-1.0.0" || output.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || output.advisory_only !== true || output.workflow_mutated !== false || output.human_acceptance_required !== true) return { status: "output_not_adoptable" };
    if (!object(output.output_payload)) return { status: "output_not_adoptable" };
    const payload = output.output_payload;
    let validated: ReturnType<typeof validateCapaInvestigationActiveAdvisoryModelOutput>;
    try { validated = validateCapaInvestigationActiveAdvisoryModelOutput(JSON.stringify(payload)); } catch { return { status: "output_not_adoptable" }; }
    const traceRows = await sql<Row[]>`select * from public.capa_ai_generation_traces where organization_id = ${input.adoption.organization_id} and output_id = ${input.adoption.output_id} limit 2`;
    const manifestRows = await sql<Row[]>`select * from public.capa_ai_reference_manifests where organization_id = ${input.adoption.organization_id} and output_id = ${input.adoption.output_id} limit 2`;
    if (traceRows.length !== 1 || manifestRows.length !== 1 || !object(traceRows[0].prompt_package) || !object(manifestRows[0].reference_manifest)) return { status: "output_not_adoptable" };
    const trace = traceRows[0];
    const manifestRow = manifestRows[0];
    if (trace.organization_id !== input.adoption.organization_id || trace.output_id !== output.output_id || trace.run_id !== output.run_id || trace.capa_case_id !== output.capa_case_id || trace.case_version_id !== output.case_version_id || number(trace.record_version) !== input.adoption.record_version || trace.request_id !== output.request_id || trace.correlation_id !== output.correlation_id || trace.output_status !== output.status) return { status: "output_not_adoptable" };
    let manifest: ReturnType<typeof createCapaInvestigationActiveAdvisoryReferenceManifest>;
    try {
      const packageValue = trace.prompt_package;
      if (packageValue.package_schema_version !== "capa-investigation-active-prompt-package-1.0.0" ||
          !object(packageValue.agent) || packageValue.agent.agent_id !== "AG-RCA" ||
          packageValue.agent.agent_version !== "ag-rca-1.0.0" ||
          !object(packageValue.generation_contract) ||
          packageValue.generation_contract.operation !== "facilitate_root_cause" ||
          packageValue.generation_contract.requested_output !== "investigation_analysis_draft" ||
          packageValue.generation_contract.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION ||
          packageValue.generation_contract.store !== false) return { status: "output_not_adoptable" };
      const modelSafe = validateCapaInvestigationActiveAdvisoryModelSafeContext(packageValue.context_provenance && object(packageValue.context_provenance) ? packageValue.context_provenance.model_safe_context : undefined);
      const manifestValue = manifestRow.reference_manifest;
      validateCapaInvestigationActiveAdvisoryReferenceManifest(manifestValue, modelSafe);
      manifest = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest: (manifestValue as { entries: readonly never[] }).entries as never, model_safe_context: modelSafe });
    } catch { return { status: "output_not_adoptable" }; }
    if (manifestRow.organization_id !== input.adoption.organization_id || manifestRow.output_id !== input.adoption.output_id || manifestRow.run_id !== output.run_id || manifestRow.capa_case_id !== output.capa_case_id || manifestRow.case_version_id !== output.case_version_id || number(manifestRow.record_version) !== input.adoption.record_version || manifestRow.request_id !== output.request_id || manifestRow.correlation_id !== output.correlation_id || manifestRow.output_status !== output.status || manifestRow.manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION || manifestRow.fingerprint_algorithm !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM || manifestRow.reference_manifest_sha256 !== manifest.reference_manifest_sha256) return { status: "output_not_adoptable" };
    const derived = derive(validated, manifest.document.entries, input.adoption.proposal_key);
    if (derived === null || derived.category !== input.adoption.proposal_category || !isDeepStrictEqual(derived.bindings, input.adoption.resolved_reference_bindings) || input.adoption.reference_manifest_sha256 !== manifest.reference_manifest_sha256 || input.adoption.reference_manifest_schema_version !== manifest.document.manifest_schema_version || input.adoption.reference_manifest_fingerprint_algorithm !== manifest.fingerprint_algorithm) return { status: "output_not_adoptable" };
    const cases = await sql<Row[]>`select current_version_id, record_version, status from public.capa_cases where organization_id = ${input.adoption.organization_id} and capa_case_id = ${input.adoption.capa_case_id} for update`;
    if (cases.length !== 1 || cases[0].current_version_id !== input.adoption.case_version_id || number(cases[0].record_version) !== input.adoption.record_version || cases[0].status !== "S40") return { status: "case_changed" };
    const rows = await sql<Row[]>`insert into public.capa_investigation_active_ai_adoptions (organization_id, adoption_id, output_id, output_run_id, capa_case_id, case_version_id, record_version, output_status, output_request_id, output_correlation_id, proposal_key, proposal_category, adopted_item, resolved_reference_bindings, reference_manifest_schema_version, reference_manifest_fingerprint_algorithm, reference_manifest_sha256, adopted_at, adopted_by_actor_type, adopted_by_actor_id, adoption_policy_version, request_id, correlation_id, idempotency_key, request_fingerprint, audit_event_id, adoption_record, record_fingerprint_algorithm, record_fingerprint, workflow_mutated, controlled_record_mutated, gate_approved) values (${input.adoption.organization_id}, ${input.adoption.adoption_id}, ${input.adoption.output_id}, ${output.run_id}, ${input.adoption.capa_case_id}, ${input.adoption.case_version_id}, ${input.adoption.record_version}, ${output.status}, ${output.request_id}, ${output.correlation_id}, ${input.adoption.proposal_key}, ${input.adoption.proposal_category}, ${sql.json(json(input.adoption.adopted_item))}, ${sql.json(json(input.adoption.resolved_reference_bindings))}, ${input.adoption.reference_manifest_schema_version}, ${input.adoption.reference_manifest_fingerprint_algorithm}, ${input.adoption.reference_manifest_sha256}, ${input.adoption.adopted_at}, ${input.adoption.adopted_by.actor_type}, ${input.adoption.adopted_by.actor_id}, ${input.adoption.adoption_policy_version}, ${input.adoption.request_id}, ${input.adoption.correlation_id}, ${input.adoption.idempotency_key}, ${input.request_fingerprint}, ${input.audit_event_id}, ${sql.json(json(input.adoption))}, 'sha256', ${input.record_fingerprint}, false, false, false) on conflict do nothing returning *`;
    if (rows.length === 1) return { status: "saved", record: adoptionFromRow(rows[0]) };
    if (rows.length !== 0) fail();
    const concurrent = await existingRecord(sql, input);
    if (concurrent !== null) return conflict(concurrent, input);
    fail();
  }

  async findAdoptionById(organizationId: string, adoptionId: string): Promise<PersistedCapaInvestigationActiveAdoption | null> {
    const rows = await this.sql<Row[]>`select * from public.capa_investigation_active_ai_adoptions where organization_id = ${organizationId} and adoption_id = ${adoptionId} limit 2`;
    if (rows.length > 1) fail();
    return rows[0] === undefined ? null : adoptionFromRow(rows[0]);
  }
  async listAdoptionsForOutput(organizationId: string, outputId: string): Promise<readonly PersistedCapaInvestigationActiveAdoption[]> {
    const rows = await this.sql<Row[]>`select * from public.capa_investigation_active_ai_adoptions where organization_id = ${organizationId} and output_id = ${outputId} order by adopted_at asc, adoption_id asc`;
    return Object.freeze(rows.map(adoptionFromRow));
  }
  async listAdoptionsForCase(organizationId: string, capaCaseId: string): Promise<readonly PersistedCapaInvestigationActiveAdoption[]> {
    const rows = await this.sql<Row[]>`select * from public.capa_investigation_active_ai_adoptions where organization_id = ${organizationId} and capa_case_id = ${capaCaseId} order by adopted_at asc, adoption_id asc`;
    return Object.freeze(rows.map(adoptionFromRow));
  }
}
