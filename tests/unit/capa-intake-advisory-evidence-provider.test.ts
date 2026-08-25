import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  GovernedCapaIntakeAdvisoryEvidenceProvider,
  type CapaIntakeAdvisoryRetrievalRequestFactory,
} from "../../lib/capa/ai/capa-intake-advisory-evidence-provider";

import type {
  CapaIntakeAdvisoryCaseContext,
} from "../../lib/capa/ai/capa-intake-advisory-service";

import type {
  CapaIntakeAdvisoryRequest,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

import type {
  CapaKnowledgeRetrievalService,
  CapaKnowledgeRetrievalServiceInput,
  CapaKnowledgeRetrievalServiceResult,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-service";

const ORGANIZATION_ID =
  "9cf8ea71-39d6-43c6-b9df-7ae9ae32652a";

const context = {
  organization_id: ORGANIZATION_ID,
  capa_case_id:
    "10000000-0000-4000-8000-000000000001",
  case_version_id:
    "50000000-0000-4000-8000-000000000001",
  record_version: 2,
  workflow_state: "S10",
  user_id:
    "20000000-0000-4000-8000-000000000001",
  active_role_ids: ["CAPA_OWNER"],
  minimum_case_context: [],
} as unknown as CapaIntakeAdvisoryCaseContext;

const advisoryRequest = {
  requested_output:
    "intake_analysis",
  focus:
    "Clarify containment risk.",
} as CapaIntakeAdvisoryRequest;

const requestId =
  "30000000-0000-4000-8000-000000000001";

const correlationId =
  "40000000-0000-4000-8000-000000000001";

function retrievalInput(
  organizationId: string =
    ORGANIZATION_ID,
): CapaKnowledgeRetrievalServiceInput {
  return {
    request: {
      retrieval_run_id:
        "55d23b7e-13e5-4a89-b25a-b7d8a977d48f",
      query_id:
        "075863fe-938f-454e-b5a5-3e053e925075",
      request_trace: {
        request_id: requestId,
        correlation_id: correlationId,
      },
      scope: {
        organization_id:
          organizationId,
        actor: {
          actor_type: "human",
          actor_id: context.user_id,
        },
        active_role_ids:
          context.active_role_ids,
        permitted_site_ids: [],
        permitted_product_ids: [],
        collection_id:
          "7d974143-2bdc-4178-b529-9571a4f25a4a",
        collection_version_id:
          "62baea6e-f42c-424d-bdc8-01fce5921fb0",
        approved_global_sources_permitted:
          false,
      },
      task_type: "CAPA_SUPPORT",
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
        retrieval_method: "lexical",
        maximum_candidates: 20,
        maximum_results: 8,
        maximum_total_characters:
          20_000,
        minimum_relevance_score: 0.4,
      },
      requested_at:
        "2026-08-25T14:00:00.000Z",
    },
    query: {
      user_query:
        advisoryRequest.focus ?? "CAPA intake advisory",
      task_type: "CAPA_SUPPORT",
      workflow_state:
        context.workflow_state,
      authorized_context: [],
    },
  } as unknown as
    CapaKnowledgeRetrievalServiceInput;
}

function completeResult():
  CapaKnowledgeRetrievalServiceResult {
  return {
    request: {
      ...retrievalInput().request,
      query_text:
        "controlled CAPA intake advisory query",
      query_fingerprint:
        "controlled-query-fingerprint",
    } as never,
    constructed_query: {} as never,
    ranking: {} as never,
    evidence_package: {
      evidence_assembly_version:
        "capa-knowledge-evidence-assembly-1.0.0",
      retrieval_run_id:
        "55d23b7e-13e5-4a89-b25a-b7d8a977d48f",
      collection_version_id:
        "62baea6e-f42c-424d-bdc8-01fce5921fb0",
      outcome: "complete",
      reason_code:
        "RETRIEVAL_COMPLETE",
      passages: [{
        evidence_id:
          "ef213413-0557-5ecf-98a7-b37c64085645",
        source_id:
          "875e032a-cd84-4be7-a526-348467472e5c",
        source_version_id:
          "3435183d-12b1-4e43-8b68-a52f2c94f5cc",
        passage_id:
          "50c475ad-b030-40fd-a1a2-b53402534213",
        source_type: "SRC-01",
        source_status_at_use:
          "current_effective",
        title:
          "Corrective Action Procedure",
        issuer:
          "Example Manufacturer",
        jurisdiction: "US",
        locators: [{
          kind: "section",
          label: "§ 7.4",
        }],
        content:
          "Corrective actions shall be verified for effectiveness.",
        rank: 1,
        relevance_score: 0.9,
        limitations: [],
        relationship: "supports",
        related_context: [],
      }],
      warnings: [],
      completed_at:
        "2026-08-25T14:00:01.000Z",
      total_character_count: 53,
    },
  } as unknown as
    CapaKnowledgeRetrievalServiceResult;
}

function ports(
  result:
    CapaKnowledgeRetrievalServiceResult =
      completeResult(),
) {
  const retrieve =
    vi.fn().mockResolvedValue(result);

  const retrievalService = {
    retrieve,
  } as unknown as
    CapaKnowledgeRetrievalService;

  const create =
    vi.fn().mockReturnValue(
      retrievalInput(),
    );

  const factory = {
    create,
  } as
    CapaIntakeAdvisoryRetrievalRequestFactory;

  const provider =
    new GovernedCapaIntakeAdvisoryEvidenceProvider(
      retrievalService,
      factory,
    );

  return {
    provider,
    retrieve,
    create,
  };
}

function invocation() {
  return {
    context,
    request: advisoryRequest,
    request_id: requestId as never,
    correlation_id:
      correlationId as never,
  };
}

describe(
  "governed CAPA intake advisory evidence provider",
  () => {
    it(
      "delegates retrieval through the server-controlled request factory",
      async () => {
        const {
          provider,
          retrieve,
          create,
        } = ports();

        await provider.retrieve(
          invocation(),
        );

        expect(create)
          .toHaveBeenCalledExactlyOnceWith(
            invocation(),
          );

        expect(retrieve)
          .toHaveBeenCalledExactlyOnceWith(
            retrievalInput(),
          );
      },
    );

    it(
      "maps governed evidence into untrusted prompt context",
      async () => {
        const { provider } = ports();

        const result =
          await provider.retrieve(
            invocation(),
          );

        expect(result.citations)
          .toEqual([]);

        expect(result.warnings)
          .toEqual([]);

        expect(result.prompt_context)
          .toHaveLength(1);

        expect(
          result.prompt_context[0],
        ).toMatchObject({
          organization_id:
            ORGANIZATION_ID,
          collection_version_id:
            "62baea6e-f42c-424d-bdc8-01fce5921fb0",
          retrieval_run_id:
            "55d23b7e-13e5-4a89-b25a-b7d8a977d48f",
          source_id:
            "875e032a-cd84-4be7-a526-348467472e5c",
          source_version_id:
            "3435183d-12b1-4e43-8b68-a52f2c94f5cc",
          passage_id:
            "50c475ad-b030-40fd-a1a2-b53402534213",
          title:
            "Corrective Action Procedure",
          text: {
            trust: "untrusted_data",
            provenance_type:
              "retrieved_passage",
            content:
              "Corrective actions shall be verified for effectiveness.",
          },
        });
      },
    );

    it(
      "does not manufacture claim-specific citations from retrieval relevance",
      async () => {
        const { provider } = ports();

        const result =
          await provider.retrieve(
            invocation(),
          );

        expect(result.citations)
          .toEqual([]);
      },
    );

    it(
      "fails closed before retrieval for a cross-organization request factory result",
      async () => {
        const {
          provider,
          retrieve,
          create,
        } = ports();

        create.mockReturnValue(
          retrievalInput(
            "different-organization",
          ),
        );

        await expect(
          provider.retrieve(invocation()),
        ).rejects.toThrow(
          "CAPA intake advisory retrieval scope does not match the authorized organization.",
        );

        expect(retrieve)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "propagates governed retrieval failure instead of fabricating evidence",
      async () => {
        const {
          provider,
          retrieve,
        } = ports();

        retrieve.mockRejectedValue(
          new Error(
            "governed retrieval failed",
          ),
        );

        await expect(
          provider.retrieve(invocation()),
        ).rejects.toThrow(
          "governed retrieval failed",
        );
      },
    );

    it.each([
      [
        "no_result",
        "NO_ELIGIBLE_RESULT",
        [
          "Governed retrieval found no eligible evidence; this does not establish that no requirement or evidence exists.",
        ],
      ],
      [
        "partial",
        "PARTIAL_INDEX",
        [
          "Approved fallback returned partial evidence.",
        ],
      ],
    ] as const)(
      "preserves controlled %s retrieval limitations",
      async (
        outcome,
        reasonCode,
        warnings,
      ) => {
        const base =
          completeResult();

        const result = {
          ...base,
          evidence_package: {
            ...base.evidence_package,
            outcome,
            reason_code: reasonCode,
            passages: [],
            warnings,
            total_character_count: 0,
          },
        } as unknown as
          CapaKnowledgeRetrievalServiceResult;

        const { provider } =
          ports(result);

        const evidence =
          await provider.retrieve(
            invocation(),
          );

        expect(
          evidence.prompt_context,
        ).toEqual([]);

        expect(
          evidence.citations,
        ).toEqual([]);

        expect(
          evidence.warnings.join(" "),
        ).toContain(warnings[0]);

        if (outcome === "no_result") {
          expect(
            evidence.warnings.join(" "),
          ).toContain(reasonCode);
        } else {
          expect(
            evidence.warnings,
          ).toEqual(warnings);
        }
      },
    );

    it(
      "preserves usable partial evidence as untrusted data with its warning",
      async () => {
        const base =
          completeResult();

        const result = {
          ...base,
          evidence_package: {
            ...base.evidence_package,
            outcome: "partial",
            reason_code: "PARTIAL_INDEX",
            warnings: [
              "Approved fallback returned partial evidence.",
            ],
          },
        } as unknown as
          CapaKnowledgeRetrievalServiceResult;

        const { provider } =
          ports(result);

        const evidence =
          await provider.retrieve(
            invocation(),
          );

        expect(
          evidence.prompt_context,
        ).toHaveLength(1);

        expect(
          evidence.prompt_context[0],
        ).toMatchObject({
          text: {
            trust: "untrusted_data",
            provenance_type:
              "retrieved_passage",
            content:
              "Corrective actions shall be verified for effectiveness.",
          },
        });

        expect(
          evidence.warnings,
        ).toEqual([
          "Approved fallback returned partial evidence.",
        ]);

        expect(
          evidence.citations,
        ).toEqual([]);
      },
    );

    it(
      "preserves evidence limitations and precise locators",
      async () => {
        const base =
          completeResult();

        const passage =
          base.evidence_package
            .passages[0]!;

        const result = {
          ...base,
          evidence_package: {
            ...base.evidence_package,
            passages: [{
              ...passage,
              limitations: [
                "Poor OCR on page 3.",
              ],
            }],
          },
        } as unknown as
          CapaKnowledgeRetrievalServiceResult;

        const { provider } =
          ports(result);

        const evidence =
          await provider.retrieve(
            invocation(),
          );

        expect(
          evidence.prompt_context[0],
        ).toMatchObject({
          locators: [{
            kind: "section",
            label: "§ 7.4",
          }],
          limitations: [
            "Poor OCR on page 3.",
          ],
        });
      },
    );
  },
);
