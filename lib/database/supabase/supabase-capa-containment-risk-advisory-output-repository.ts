import type postgres from "postgres";

import type { CapaContainmentRiskAdvisoryResponse } from "../../capa/ai/capa-containment-risk-advisory-contract";
import type { CapaContainmentRiskAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS20ContainmentRiskContext } from "../../capa/ai/capa-containment-risk-advisory-context";
import { CAPA_CONTAINMENT_RISK_ADVISORY_AGENT } from "../../capa/ai/capa-containment-risk-advisory-service";
import type { CapaContainmentRiskAdvisoryOutputRepository } from "../repositories/capa-containment-risk-advisory-output-repository";
import { requireSupabaseTransaction } from "./supabase-transactions";
import type { TransactionContext } from "../transactions";

interface CurrentCapaRow extends postgres.Row { readonly capa_case_id: string; }

export class SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError extends Error {
  constructor() {
    super("The governed CAPA containment/risk advisory output could not be persisted.");
    this.name = "SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError";
  }
}

function databaseJson(value: unknown): postgres.JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError();
  return JSON.parse(serialized) as postgres.JSONValue;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateInput(
  context: AuthoritativeS20ContainmentRiskContext,
  response: CapaContainmentRiskAdvisoryResponse,
  trace: CapaContainmentRiskAdvisoryGenerationTraceCapture,
  requestId: string,
  correlationId: string,
): void {
  const promptPackage = trace.package;
  const traceIdentity = promptPackage.trace;
  const scope = promptPackage.scope;
  if (!isUuid(context.organization_id) || !isUuid(context.capa_case_id) || !isUuid(context.case_version_id) || !Number.isSafeInteger(context.record_version) || context.record_version <= 0 || context.workflow_state !== "S20") throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError();
  if (!isUuid(response.run_id) || !isUuid(response.output_id) || response.output_schema_version !== "capa-containment-risk-advisory-1.0.0" || response.status !== "completed_draft" || response.proposal === null || !Array.isArray(response.containment_summary) || !Array.isArray(response.citations) || !Array.isArray(response.warnings) || response.advisory_only !== true || response.workflow_mutated !== false || response.human_acceptance_required !== true) throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError();
  if (!isUuid(traceIdentity.run_id) || !isUuid(traceIdentity.prompt_package_id) || !isUuid(traceIdentity.request_id) || !isUuid(traceIdentity.correlation_id) || typeof traceIdentity.assembled_at !== "string" || traceIdentity.assembled_at.length === 0 || !isUuid(scope.organization_id) || !isUuid(scope.capa_case_id) || !isUuid(scope.case_version_id) || !Number.isSafeInteger(scope.record_version) || scope.record_version <= 0 || scope.workflow_state !== "S20") throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError();
  if (traceIdentity.run_id !== response.run_id || traceIdentity.request_id !== requestId || traceIdentity.correlation_id !== correlationId || scope.organization_id !== context.organization_id || scope.capa_case_id !== context.capa_case_id || scope.case_version_id !== context.case_version_id || scope.record_version !== context.record_version || scope.workflow_state !== context.workflow_state || promptPackage.agent.agent_id !== CAPA_CONTAINMENT_RISK_ADVISORY_AGENT.agent_id || promptPackage.agent.agent_version !== CAPA_CONTAINMENT_RISK_ADVISORY_AGENT.agent_version) throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError();
}

export class SupabaseCapaContainmentRiskAdvisoryOutputRepository implements CapaContainmentRiskAdvisoryOutputRepository {
  async save(transaction: TransactionContext, input: Parameters<CapaContainmentRiskAdvisoryOutputRepository["save"]>[1]): Promise<"saved" | "case_changed"> {
    const sql = requireSupabaseTransaction(transaction);
    if (transaction.request_trace.request_id !== input.request_id || transaction.request_trace.correlation_id !== input.correlation_id) throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError();
    try { validateInput(input.context, input.response, input.generation_trace, input.request_id, input.correlation_id); } catch { throw new SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError(); }
    const trace = input.generation_trace;
    const promptPackage = trace.package;
    const outputPayload = { proposal: input.response.proposal, containment_summary: input.response.containment_summary, citations: input.response.citations, assumptions: input.response.assumptions, uncertainty_and_limitations: input.response.uncertainty_and_limitations, warnings: input.response.warnings };
    const currentRows = await sql<CurrentCapaRow[]>`select capa_case_id from public.capa_cases where organization_id = ${input.context.organization_id} and capa_case_id = ${input.context.capa_case_id} and current_version_id = ${input.context.case_version_id} and record_version = ${input.context.record_version} and status = ${input.context.workflow_state} for update`;
    if (currentRows[0] === undefined) return "case_changed";
    await sql`insert into public.capa_ai_outputs (organization_id, output_id, run_id, capa_case_id, case_version_id, record_version, request_id, correlation_id, agent_id, agent_version, output_schema_version, status, output_payload, advisory_only, workflow_mutated, human_acceptance_required, created_at) values (${input.context.organization_id}, ${input.response.output_id}, ${input.response.run_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.request_id}, ${input.correlation_id}, ${CAPA_CONTAINMENT_RISK_ADVISORY_AGENT.agent_id}, ${CAPA_CONTAINMENT_RISK_ADVISORY_AGENT.agent_version}, ${input.response.output_schema_version}, ${input.response.status}, ${sql.json(databaseJson(outputPayload))}, ${input.response.advisory_only}, ${input.response.workflow_mutated}, ${input.response.human_acceptance_required}, ${transaction.started_at})`;
    await sql`insert into public.capa_ai_generation_traces (organization_id, run_id, output_id, capa_case_id, case_version_id, record_version, output_status, request_id, correlation_id, prompt_package_id, trace_schema_version, fingerprint_algorithm, prompt_package, prompt_package_sha256, rendered_prompt_sha256, evidence_manifest, evidence_manifest_sha256, policy_manifest, policy_manifest_sha256, model_profile_version, assembled_at) values (${input.context.organization_id}, ${input.response.run_id}, ${input.response.output_id}, ${input.context.capa_case_id}, ${input.context.case_version_id}, ${input.context.record_version}, ${input.response.status}, ${input.request_id}, ${input.correlation_id}, ${promptPackage.trace.prompt_package_id}, ${trace.trace_schema_version}, ${trace.fingerprints.algorithm}, ${sql.json(databaseJson(promptPackage))}, ${trace.fingerprints.prompt_package_sha256}, ${trace.fingerprints.rendered_prompt_sha256}, ${sql.json(databaseJson(trace.evidence_manifest))}, ${trace.fingerprints.evidence_manifest_sha256}, ${sql.json(databaseJson(trace.policy_manifest))}, ${trace.fingerprints.policy_manifest_sha256}, ${trace.model_profile_version}, ${promptPackage.trace.assembled_at})`;
    return "saved";
  }
}

export function createSupabaseCapaContainmentRiskAdvisoryOutputRepository(): SupabaseCapaContainmentRiskAdvisoryOutputRepository {
  return new SupabaseCapaContainmentRiskAdvisoryOutputRepository();
}
