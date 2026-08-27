import type postgres from "postgres";

import {
  CAPA_INTAKE_ADVISORY_AGENT,
  type CapaIntakeAdvisoryOutputRepository,
  type CapaIntakeAdvisoryOutputSaveResult,
} from "../../capa/ai/capa-intake-advisory-service";

import {
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  createCapaAiGenerationTraceArtifacts,
} from "../../capa/ai/capa-ai-generation-trace";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

interface CurrentCapaRow extends postgres.Row {
  readonly capa_case_id: string;
}

export class SupabaseCapaIntakeAdvisoryOutputRepositoryError
  extends Error {
  constructor() {
    super(
      "The governed CAPA intake advisory output could not be persisted.",
    );

    this.name =
      "SupabaseCapaIntakeAdvisoryOutputRepositoryError";
  }
}

function databaseJson(
  value: unknown,
): postgres.JSONValue {
  const serialized =
    JSON.stringify(value);

  if (serialized === undefined) {
    throw new SupabaseCapaIntakeAdvisoryOutputRepositoryError();
  }

  return JSON.parse(
    serialized,
  ) as postgres.JSONValue;
}

/**
 * Durable write-only repository for validated CAPA intake advisory output.
 *
 * The case row is locked and revalidated inside the same transaction before
 * the AI output is inserted. This prevents an advisory generated against an
 * obsolete CAPA version from being committed.
 */
export class SupabaseCapaIntakeAdvisoryOutputRepository
  implements CapaIntakeAdvisoryOutputRepository {
  async save(
    transaction:
      Parameters<
        CapaIntakeAdvisoryOutputRepository["save"]
      >[0],
    input:
      Parameters<
        CapaIntakeAdvisoryOutputRepository["save"]
      >[1],
  ): Promise<CapaIntakeAdvisoryOutputSaveResult> {
    const sql =
      requireSupabaseTransaction(
        transaction,
      );

    if (
      transaction.request_trace
        .request_id !==
        input.request_id ||
      transaction.request_trace
        .correlation_id !==
        input.correlation_id
    ) {
      throw new SupabaseCapaIntakeAdvisoryOutputRepositoryError();
    }

    if (
      input.response.advisory_only !==
        true ||
      input.response.workflow_mutated !==
        false ||
      input.response
        .human_acceptance_required !==
        true
    ) {
      throw new SupabaseCapaIntakeAdvisoryOutputRepositoryError();
    }

    const generationTrace =
      input.generation_trace;

    const promptPackage =
      generationTrace.prompt_package;

    if (
      promptPackage.trace.run_id !==
        input.response.run_id ||
      promptPackage.trace.request_id !==
        input.request_id ||
      promptPackage.trace.correlation_id !==
        input.correlation_id ||
      promptPackage.scope.organization_id !==
        input.context.organization_id ||
      promptPackage.scope.capa_case_id !==
        input.context.capa_case_id ||
      promptPackage.scope.case_version_id !==
        input.context.case_version_id ||
      promptPackage.scope.record_version !==
        input.context.record_version ||
      promptPackage.scope.workflow_state !==
        input.context.workflow_state ||
      promptPackage.agent.agent_id !==
        CAPA_INTAKE_ADVISORY_AGENT.agent_id ||
      promptPackage.agent.agent_version !==
        CAPA_INTAKE_ADVISORY_AGENT.agent_version ||
      promptPackage.component_versions
        .agent_version !==
        CAPA_INTAKE_ADVISORY_AGENT.agent_version ||
      promptPackage.component_versions
        .output_schema_version !==
        input.response.output_schema_version ||
      promptPackage.component_versions
        .model_profile_version !==
        generationTrace.model_profile_version
    ) {
      throw new SupabaseCapaIntakeAdvisoryOutputRepositoryError();
    }

    const traceArtifacts = (() => {
      try {
        return createCapaAiGenerationTraceArtifacts(
          generationTrace,
        );
      } catch {
        throw new SupabaseCapaIntakeAdvisoryOutputRepositoryError();
      }
    })();

    const currentRows =
      await sql<CurrentCapaRow[]>`
        select capa_case_id
        from public.capa_cases
        where organization_id =
            ${input.context.organization_id}
          and capa_case_id =
            ${input.context.capa_case_id}
          and current_version_id =
            ${input.context.case_version_id}
          and record_version =
            ${input.context.record_version}
          and status =
            ${input.context.workflow_state}
        for update
      `;

    if (currentRows[0] === undefined) {
      return "case_changed";
    }

    await sql`
      insert into public.capa_ai_outputs (
        organization_id,
        output_id,
        run_id,
        capa_case_id,
        case_version_id,
        record_version,
        request_id,
        correlation_id,
        agent_id,
        agent_version,
        output_schema_version,
        status,
        proposal,
        citations,
        assumptions,
        missing_information,
        conflicts_and_alternatives,
        uncertainty_and_limitations,
        human_action_required,
        warnings,
        advisory_only,
        workflow_mutated,
        human_acceptance_required,
        created_at
      )
      values (
        ${input.context.organization_id},
        ${input.response.output_id},
        ${input.response.run_id},
        ${input.context.capa_case_id},
        ${input.context.case_version_id},
        ${input.context.record_version},
        ${input.request_id},
        ${input.correlation_id},
        ${CAPA_INTAKE_ADVISORY_AGENT.agent_id},
        ${CAPA_INTAKE_ADVISORY_AGENT.agent_version},
        ${input.response.output_schema_version},
        ${input.response.status},
        ${
          input.response.proposal === null
            ? null
            : sql.json(
                databaseJson(
                  input.response.proposal,
                ),
              )
        },
        ${sql.json(
          databaseJson(
            input.response.citations,
          ),
        )},
        ${sql.json(
          databaseJson(
            input.response.assumptions,
          ),
        )},
        ${sql.json(
          databaseJson(
            input.response
              .missing_information,
          ),
        )},
        ${sql.json(
          databaseJson(
            input.response
              .conflicts_and_alternatives,
          ),
        )},
        ${sql.json(
          databaseJson(
            input.response
              .uncertainty_and_limitations,
          ),
        )},
        ${sql.json(
          databaseJson(
            input.response
              .human_action_required,
          ),
        )},
        ${sql.json(
          databaseJson(
            input.response.warnings,
          ),
        )},
        ${input.response.advisory_only},
        ${input.response.workflow_mutated},
        ${
          input.response
            .human_acceptance_required
        },
        ${transaction.started_at}
      )
    `;

    await sql`
      insert into public.capa_ai_generation_traces (
        organization_id,
        run_id,
        output_id,
        capa_case_id,
        case_version_id,
        record_version,
        output_status,
        request_id,
        correlation_id,
        prompt_package_id,
        trace_schema_version,
        fingerprint_algorithm,
        prompt_package,
        prompt_package_sha256,
        rendered_prompt_sha256,
        evidence_manifest,
        evidence_manifest_sha256,
        policy_manifest,
        policy_manifest_sha256,
        model_profile_version,
        assembled_at
      )
      values (
        ${input.context.organization_id},
        ${input.response.run_id},
        ${input.response.output_id},
        ${input.context.capa_case_id},
        ${input.context.case_version_id},
        ${input.context.record_version},
        ${input.response.status},
        ${input.request_id},
        ${input.correlation_id},
        ${promptPackage.trace.prompt_package_id},
        ${CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION},
        ${traceArtifacts.algorithm},
        ${sql.json(
          databaseJson(
            promptPackage,
          ),
        )},
        ${traceArtifacts.prompt_package_sha256},
        ${traceArtifacts.rendered_prompt_sha256},
        ${sql.json(
          databaseJson(
            traceArtifacts.evidence_manifest,
          ),
        )},
        ${traceArtifacts.evidence_manifest_sha256},
        ${sql.json(
          databaseJson(
            traceArtifacts.policy_manifest,
          ),
        )},
        ${traceArtifacts.policy_manifest_sha256},
        ${generationTrace.model_profile_version},
        ${promptPackage.trace.assembled_at}
      )
    `;

    return "saved";
  }
}

export function createSupabaseCapaIntakeAdvisoryOutputRepository():
  SupabaseCapaIntakeAdvisoryOutputRepository {
  return new SupabaseCapaIntakeAdvisoryOutputRepository();
}
