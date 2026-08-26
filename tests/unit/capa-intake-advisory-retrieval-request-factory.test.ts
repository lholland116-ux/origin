import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createControlledCapaIntakeAdvisoryRetrievalRequestFactory,
} from "../../lib/capa/ai/capa-intake-advisory-retrieval-request-factory";

const ORGANIZATION_ID =
  "9cf8ea71-39d6-43c6-b9df-7ae9ae32652a";

function factory() {
  return createControlledCapaIntakeAdvisoryRetrievalRequestFactory({
    configuration: {
      collection_id:
        "7d974143-2bdc-4178-b529-9571a4f25a4a" as never,
      collection_version_id:
        "62baea6e-f42c-424d-bdc8-01fce5921fb0" as never,
      retrieval_policy_version:
        "retrieval-1.0.0",
      source_precedence_policy_version:
        "precedence-1.0.0",
      query_construction_version:
        "capa-knowledge-query-1.0.0",
      ranking_policy_version:
        "ranking-1.0.0",
      citation_policy_version:
        "citation-1.0.0",
    },
    now: () =>
      new Date(
        "2026-08-25T14:00:00.000Z",
      ),
    create_retrieval_run_id: () =>
      "55d23b7e-13e5-4a89-b25a-b7d8a977d48f",
    create_query_id: () =>
      "075863fe-938f-454e-b5a5-3e053e925075",
  });
}

function invocation(
  focus: string | null =
    "Clarify containment risk.",
) {
  return {
    context: {
      organization_id:
        ORGANIZATION_ID,
      capa_case_id:
        "10000000-0000-4000-8000-000000000001",
      case_version_id:
        "50000000-0000-4000-8000-000000000001",
      record_version: 2,
      workflow_state: "S10",
      user_id:
        "20000000-0000-4000-8000-000000000001",
      active_role_ids: [
        "CAPA_OWNER",
      ],
      minimum_case_context: [],
    },
    request: {
      requested_output:
        "intake_analysis",
      focus,
    },
    request_id:
      "30000000-0000-4000-8000-000000000001",
    correlation_id:
      "40000000-0000-4000-8000-000000000001",
  } as never;
}

describe(
  "controlled CAPA intake advisory retrieval request factory",
  () => {
    it(
      "constructs the exact governed retrieval scope and policy",
      () => {
        const result =
          factory().create(
            invocation(),
          );

        expect(result.request)
          .toMatchObject({
            retrieval_run_id:
              "55d23b7e-13e5-4a89-b25a-b7d8a977d48f",
            query_id:
              "075863fe-938f-454e-b5a5-3e053e925075",
            request_trace: {
              request_id:
                "30000000-0000-4000-8000-000000000001",
              correlation_id:
                "40000000-0000-4000-8000-000000000001",
            },
            scope: {
              organization_id:
                ORGANIZATION_ID,
              actor: {
                actor_type: "human",
                actor_id:
                  "20000000-0000-4000-8000-000000000001",
              },
              active_role_ids: [
                "CAPA_OWNER",
              ],
              permitted_site_ids: [],
              permitted_product_ids: [],
              collection_id:
                "7d974143-2bdc-4178-b529-9571a4f25a4a",
              collection_version_id:
                "62baea6e-f42c-424d-bdc8-01fce5921fb0",
              approved_global_sources_permitted:
                false,
            },
            task_type:
              "CAPA_SUPPORT",
            filters: {
              effective_at:
                "2026-08-25T14:00:00.000Z",
              historical_source_versions_permitted:
                false,
            },
            policy: {
              retrieval_policy_version:
                "retrieval-1.0.0",
              source_precedence_policy_version:
                "precedence-1.0.0",
              query_construction_version:
                "capa-knowledge-query-1.0.0",
              ranking_policy_version:
                "ranking-1.0.0",
              citation_policy_version:
                "citation-1.0.0",
              retrieval_method:
                "lexical",
              maximum_candidates: 20,
              maximum_results: 8,
              maximum_total_characters:
                20_000,
              minimum_relevance_score:
                0.01,
            },
            requested_at:
              "2026-08-25T14:00:00.000Z",
          });
      },
    );

    it(
      "uses authorized context rather than browser-controlled scope",
      () => {
        const result =
          factory().create(
            invocation(),
          );

        expect(
          result.request.scope
            .organization_id,
        ).toBe(ORGANIZATION_ID);

        expect(
          result.request.scope.actor
            .actor_id,
        ).toBe(
          "20000000-0000-4000-8000-000000000001",
        );
      },
    );

    it(
      "keeps retrieval on the controlled intake query when focus is present",
      () => {
        const result =
          factory().create(
            invocation(
              "Analyze this CAPA intake and identify missing information, containment and risk questions, investigation questions, assumptions, and uncertainties that should be reviewed by the CAPA owner.",
            ),
          );

        expect(result.query.user_query)
          .toBe(
            "CAPA intake advisory",
          );
      },
    );

    it(
      "uses the controlled fallback query when focus is absent",
      () => {
        const result =
          factory().create(
            invocation(null),
          );

        expect(result.query.user_query)
          .toBe(
            "CAPA intake advisory",
          );
      },
    );

    it(
      "does not manufacture query text or fingerprint",
      () => {
        const result =
          factory().create(
            invocation(),
          );

        expect(
          "query_text" in
            result.request,
        ).toBe(false);

        expect(
          "query_fingerprint" in
            result.request,
        ).toBe(false);
      },
    );

    it(
      "freezes governed request structures",
      () => {
        const result =
          factory().create(
            invocation(),
          );

        expect(Object.isFrozen(result))
          .toBe(true);
        expect(
          Object.isFrozen(
            result.request,
          ),
        ).toBe(true);
        expect(
          Object.isFrozen(
            result.request.scope,
          ),
        ).toBe(true);
        expect(
          Object.isFrozen(
            result.request.policy,
          ),
        ).toBe(true);
      },
    );

    it(
      "fails closed on an invalid controlled timestamp",
      () => {
        const invalid =
          createControlledCapaIntakeAdvisoryRetrievalRequestFactory({
            configuration: {
              collection_id:
                "7d974143-2bdc-4178-b529-9571a4f25a4a" as never,
              collection_version_id:
                "62baea6e-f42c-424d-bdc8-01fce5921fb0" as never,
              retrieval_policy_version:
                "retrieval-1.0.0",
              source_precedence_policy_version:
                "precedence-1.0.0",
              query_construction_version:
                "capa-knowledge-query-1.0.0",
              ranking_policy_version:
                "ranking-1.0.0",
              citation_policy_version:
                "citation-1.0.0",
            },
            now: () =>
              new Date("invalid"),
          });

        expect(
          () =>
            invalid.create(
              invocation(),
            ),
        ).toThrow(
          "CONTROLLED_CAPA_RETRIEVAL_TIME_INVALID",
        );
      },
    );
  },
);
