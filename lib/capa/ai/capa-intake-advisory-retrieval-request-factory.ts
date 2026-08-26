import {
  randomUUID,
} from "node:crypto";

import type {
  IsoDateTime,
} from "../domain/capa-types";

import type {
  CapaKnowledgeRetrievalServiceInput,
} from "../knowledge/capa-knowledge-retrieval-service";

import type {
  CapaKnowledgeCollectionId,
  CapaKnowledgeCollectionVersionId,
} from "../knowledge/capa-knowledge-contract";

import type {
  CapaKnowledgeRetrievalQueryId,
  CapaKnowledgeRetrievalRunId,
} from "../knowledge/capa-knowledge-retrieval-contract";

import type {
  CapaIntakeAdvisoryRetrievalRequestFactory,
} from "./capa-intake-advisory-evidence-provider";

/**
 * Server-controlled retrieval configuration for the CAPA intake advisory.
 *
 * None of these governance values may be supplied by browser-controlled
 * advisory input.
 *
 * M5G Change Set 5C.1.
 */
export interface CapaIntakeAdvisoryRetrievalConfiguration {
  readonly collection_id:
    CapaKnowledgeCollectionId;
  readonly collection_version_id:
    CapaKnowledgeCollectionVersionId;
  readonly retrieval_policy_version: string;
  readonly source_precedence_policy_version:
    string;
  readonly query_construction_version: string;
  readonly ranking_policy_version: string;
  readonly citation_policy_version: string;
}

export interface CapaIntakeAdvisoryRetrievalRequestFactoryDependencies {
  readonly configuration:
    CapaIntakeAdvisoryRetrievalConfiguration;
  readonly now: () => Date;
  readonly create_retrieval_run_id?: () => string;
  readonly create_query_id?: () => string;
}

/**
 * PostgreSQL ts_rank_cd lexical scores are not probability scores.
 *
 * Keep the governed intake threshold low enough to admit relevant
 * organization-controlled evidence while still excluding zero-score
 * lexical matches. Production calibration on 2026-08-26 demonstrated
 * valid intake-reference matches in approximately the 0.02-0.22 range.
 */
const CAPA_INTAKE_ADVISORY_MINIMUM_RELEVANCE_SCORE =
  0.01;

function controlledTimestamp(
  value: Date,
): IsoDateTime {
  if (Number.isNaN(value.getTime())) {
    throw new Error(
      "CONTROLLED_CAPA_RETRIEVAL_TIME_INVALID",
    );
  }

  return value.toISOString() as IsoDateTime;
}

function controlledIdentifier(
  value: string,
  name: string,
): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(
      `CONTROLLED_CAPA_RETRIEVAL_${name}_INVALID`,
    );
  }

  return normalized;
}

export class ControlledCapaIntakeAdvisoryRetrievalRequestFactory
  implements CapaIntakeAdvisoryRetrievalRequestFactory {
  constructor(
    private readonly dependencies:
      CapaIntakeAdvisoryRetrievalRequestFactoryDependencies,
  ) {}

  create(
    input: Parameters<
      CapaIntakeAdvisoryRetrievalRequestFactory["create"]
    >[0],
  ): CapaKnowledgeRetrievalServiceInput {
    const timestamp =
      controlledTimestamp(
        this.dependencies.now(),
      );

    const retrievalRunId =
      controlledIdentifier(
        (
          this.dependencies
            .create_retrieval_run_id ??
          randomUUID
        )(),
        "RUN_ID",
      );

    const queryId =
      controlledIdentifier(
        (
          this.dependencies.create_query_id ??
          randomUUID
        )(),
        "QUERY_ID",
      );

    const configuration =
      this.dependencies.configuration;

    const focus =
      input.request.focus?.trim();

    return Object.freeze({
      request: Object.freeze({
        retrieval_run_id:
          retrievalRunId as
            CapaKnowledgeRetrievalRunId,

        query_id:
          queryId as
            CapaKnowledgeRetrievalQueryId,

        request_trace: Object.freeze({
          request_id: input.request_id,
          correlation_id:
            input.correlation_id,
        }),

        scope: Object.freeze({
          organization_id:
            input.context.organization_id,

          actor: Object.freeze({
            actor_type: "human" as const,
            actor_id:
              input.context.user_id,
          }),

          active_role_ids:
            Object.freeze([
              ...input.context
                .active_role_ids,
            ]),

          permitted_site_ids:
            Object.freeze([]),

          permitted_product_ids:
            Object.freeze([]),

          collection_id:
            configuration.collection_id,

          collection_version_id:
            configuration
              .collection_version_id,

          approved_global_sources_permitted:
            false,
        }),

        task_type:
          "CAPA_SUPPORT" as never,

        filters: Object.freeze({
          effective_at: timestamp,
          historical_source_versions_permitted:
            false,
        }),

        policy: Object.freeze({
          retrieval_policy_version:
            configuration
              .retrieval_policy_version as never,

          source_precedence_policy_version:
            configuration
              .source_precedence_policy_version as never,

          query_construction_version:
            configuration
              .query_construction_version as never,

          ranking_policy_version:
            configuration
              .ranking_policy_version as never,

          citation_policy_version:
            configuration
              .citation_policy_version as never,

          retrieval_method:
            "lexical" as const,

          maximum_candidates: 20,
          maximum_results: 8,
          maximum_total_characters:
            20_000,
          minimum_relevance_score:
            CAPA_INTAKE_ADVISORY_MINIMUM_RELEVANCE_SCORE,
        }),

        requested_at: timestamp,
      }),

      query: Object.freeze({
        user_query:
          focus && focus.length > 0
            ? focus
            : "CAPA intake advisory",

        task_type:
          "CAPA_SUPPORT" as never,

        workflow_state:
          input.context.workflow_state as never,

        authorized_context:
          Object.freeze([]),
      }),
    }) as CapaKnowledgeRetrievalServiceInput;
  }
}

export function createControlledCapaIntakeAdvisoryRetrievalRequestFactory(
  dependencies:
    CapaIntakeAdvisoryRetrievalRequestFactoryDependencies,
): CapaIntakeAdvisoryRetrievalRequestFactory {
  return Object.freeze(
    new ControlledCapaIntakeAdvisoryRetrievalRequestFactory(
      dependencies,
    ),
  );
}
