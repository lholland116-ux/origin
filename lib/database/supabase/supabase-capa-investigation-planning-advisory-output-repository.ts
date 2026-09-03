import type postgres from "postgres";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationPlanAdvisoryResponse,
} from "../../capa/ai/capa-investigation-planning-advisory-contract";
import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_POLICY_MANIFEST_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION,
  type CapaInvestigationPlanningAdvisoryGenerationTraceCapture,
} from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS30InvestigationPlanningContext } from "../../capa/ai/capa-investigation-planning-advisory-context";
import {
  CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
} from "../../capa/ai/capa-investigation-planning-advisory-agent-gate";
import type { CapaInvestigationPlanningAdvisoryOutputRepository } from "../repositories/capa-investigation-planning-advisory-output-repository";
import { requireSupabaseTransaction } from "./supabase-transactions";
import type { TransactionContext } from "../transactions";

interface CurrentCapaRow extends postgres.Row {
  readonly capa_case_id: string;
}

export class SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError extends Error {
  constructor() {
    super(
      "The governed CAPA investigation-planning advisory output could not be persisted.",
    );
    this.name =
      "SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError";
  }
}

function databaseJson(value: unknown): postgres.JSONValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
  }
  return JSON.parse(serialized) as postgres.JSONValue;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateInput(
  context: AuthoritativeS30InvestigationPlanningContext,
  response: CapaInvestigationPlanAdvisoryResponse,
  trace: CapaInvestigationPlanningAdvisoryGenerationTraceCapture,
  requestId: string,
  correlationId: string,
): void {
  const promptPackage = trace.package;
  const traceIdentity = promptPackage.trace;
  const scope = promptPackage.scope;
  const generation = promptPackage.generation_contract;
  const evidence = trace.evidence_manifest;
  const policy = trace.policy_manifest;

  if (
    context.trust !== "authoritative_server_context" ||
    !isUuid(context.organization_id) ||
    !isUuid(context.capa_case_id) ||
    !isUuid(context.case_version_id) ||
    !Number.isSafeInteger(context.record_version) ||
    context.record_version <= 0 ||
    context.workflow_state !== "S30" ||
    !isUuid(requestId) ||
    !isUuid(correlationId)
  ) {
    throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
  }

  const responseFields = [
    "run_id",
    "output_id",
    "output_schema_version",
    "status",
    "proposal",
    "assumptions",
    "uncertainty_and_limitations",
    "citations",
    "warnings",
    "advisory_only",
    "workflow_mutated",
    "human_acceptance_required",
  ];
  if (
    !isObject(response) ||
    Object.keys(response).length !== responseFields.length ||
    responseFields.some((field) => !Object.hasOwn(response, field)) ||
    !isUuid(response.run_id) ||
    !isUuid(response.output_id) ||
    response.output_schema_version !==
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    response.status !== "completed_draft" ||
    !isObject(response.proposal) ||
    !Array.isArray(response.assumptions) ||
    !Array.isArray(response.uncertainty_and_limitations) ||
    !Array.isArray(response.citations) ||
    response.citations.length !== 0 ||
    !Array.isArray(response.warnings) ||
    response.warnings.length !== 0 ||
    response.advisory_only !== true ||
    response.workflow_mutated !== false ||
    response.human_acceptance_required !== true
  ) {
    throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
  }

  if (
    trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION ||
    !isUuid(traceIdentity.run_id) ||
    !isUuid(traceIdentity.prompt_package_id) ||
    !isUuid(traceIdentity.request_id) ||
    !isUuid(traceIdentity.correlation_id) ||
    !isNonEmptyString(traceIdentity.assembled_at) ||
    promptPackage.package_schema_version !==
      CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION ||
    !isUuid(scope.organization_id) ||
    !isUuid(scope.capa_case_id) ||
    !isUuid(scope.case_version_id) ||
    !Number.isSafeInteger(scope.record_version) ||
    scope.record_version <= 0 ||
    scope.workflow_state !== "S30" ||
    promptPackage.agent.agent_id !==
      CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT.agent_id ||
    promptPackage.agent.agent_version !==
      CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT.agent_version ||
    generation.operation !== CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION ||
    generation.requested_output !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT ||
    generation.output_schema_version !==
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    generation.store !== false ||
    trace.store !== false ||
    evidence.evidence_manifest_schema_version !==
      CAPA_INVESTIGATION_PLANNING_EVIDENCE_MANIFEST_SCHEMA_VERSION ||
    evidence.retrieval_performed !== false ||
    evidence.item_count !== 0 ||
    !Array.isArray(evidence.items) ||
    evidence.items.length !== 0 ||
    policy.policy_manifest_schema_version !==
      CAPA_INVESTIGATION_PLANNING_POLICY_MANIFEST_SCHEMA_VERSION ||
    policy.agent.agent_id !== CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT.agent_id ||
    policy.agent.agent_version !== CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT.agent_version ||
    policy.workflow_state !== "S30" ||
    policy.operation !== CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION ||
    policy.requested_output !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT ||
    policy.output_schema_version !==
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    policy.authority.advisory_only !== true ||
    policy.authority.workflow_mutated !== false ||
    policy.authority.human_acceptance_required !== true ||
    trace.fingerprints.algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM
  ) {
    throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
  }

  if (
    traceIdentity.run_id !== response.run_id ||
    traceIdentity.request_id !== requestId ||
    traceIdentity.correlation_id !== correlationId ||
    scope.organization_id !== context.organization_id ||
    scope.capa_case_id !== context.capa_case_id ||
    scope.case_version_id !== context.case_version_id ||
    scope.record_version !== context.record_version ||
    scope.workflow_state !== context.workflow_state
  ) {
    throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
  }
}

export class SupabaseCapaInvestigationPlanningAdvisoryOutputRepository
  implements CapaInvestigationPlanningAdvisoryOutputRepository
{
  async save(
    transaction: TransactionContext,
    input: Parameters<
      CapaInvestigationPlanningAdvisoryOutputRepository["save"]
    >[1],
  ): Promise<"saved" | "case_changed"> {
    let sql: postgres.TransactionSql;
    try {
      sql = requireSupabaseTransaction(transaction);
    } catch {
      throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
    }

    if (
      transaction.request_trace.request_id !== input.request_id ||
      transaction.request_trace.correlation_id !== input.correlation_id
    ) {
      throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
    }

    try {
      validateInput(
        input.context,
        input.response,
        input.generation_trace,
        input.request_id,
        input.correlation_id,
      );
    } catch {
      throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
    }

    const trace = input.generation_trace;
    const promptPackage = trace.package;
    const outputPayload = {
      proposal: input.response.proposal,
      citations: input.response.citations,
      assumptions: input.response.assumptions,
      uncertainty_and_limitations:
        input.response.uncertainty_and_limitations,
      warnings: input.response.warnings,
    };

    let currentRows: CurrentCapaRow[];
    try {
      currentRows = await sql<CurrentCapaRow[]>`
        select capa_case_id
        from public.capa_cases
        where organization_id = ${input.context.organization_id}
          and capa_case_id = ${input.context.capa_case_id}
          and current_version_id = ${input.context.case_version_id}
          and record_version = ${input.context.record_version}
          and status = ${input.context.workflow_state}
        for update
      `;
      if (currentRows[0] === undefined) return "case_changed";

      await sql`
        insert into public.capa_ai_outputs (
          organization_id, output_id, run_id, capa_case_id, case_version_id,
          record_version, request_id, correlation_id, agent_id, agent_version,
          output_schema_version, status, output_payload, advisory_only,
          workflow_mutated, human_acceptance_required, created_at
        ) values (
          ${input.context.organization_id}, ${input.response.output_id},
          ${input.response.run_id}, ${input.context.capa_case_id},
          ${input.context.case_version_id}, ${input.context.record_version},
          ${input.request_id}, ${input.correlation_id},
          ${CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT.agent_id},
          ${CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT.agent_version},
          ${input.response.output_schema_version}, ${input.response.status},
          ${sql.json(databaseJson(outputPayload))},
          ${input.response.advisory_only}, ${input.response.workflow_mutated},
          ${input.response.human_acceptance_required}, ${transaction.started_at}
        )
      `;

      await sql`
        insert into public.capa_ai_generation_traces (
          organization_id, run_id, output_id, capa_case_id, case_version_id,
          record_version, output_status, request_id, correlation_id,
          prompt_package_id, trace_schema_version, fingerprint_algorithm,
          prompt_package, prompt_package_sha256, rendered_prompt_sha256,
          evidence_manifest, evidence_manifest_sha256, policy_manifest,
          policy_manifest_sha256, model_profile_version, assembled_at
        ) values (
          ${input.context.organization_id}, ${input.response.run_id},
          ${input.response.output_id}, ${input.context.capa_case_id},
          ${input.context.case_version_id}, ${input.context.record_version},
          ${input.response.status}, ${input.request_id},
          ${input.correlation_id}, ${promptPackage.trace.prompt_package_id},
          ${trace.trace_schema_version}, ${trace.fingerprints.algorithm},
          ${sql.json(databaseJson(promptPackage))},
          ${trace.fingerprints.prompt_package_sha256},
          ${trace.fingerprints.rendered_prompt_sha256},
          ${sql.json(databaseJson(trace.evidence_manifest))},
          ${trace.fingerprints.evidence_manifest_sha256},
          ${sql.json(databaseJson(trace.policy_manifest))},
          ${trace.fingerprints.policy_manifest_sha256},
          ${trace.model_profile_version}, ${promptPackage.trace.assembled_at}
        )
      `;
    } catch (error) {
      if (error instanceof SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError) {
        throw error;
      }
      throw new SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError();
    }

    return "saved";
  }
}

export function createSupabaseCapaInvestigationPlanningAdvisoryOutputRepository(): SupabaseCapaInvestigationPlanningAdvisoryOutputRepository {
  return new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository();
}
