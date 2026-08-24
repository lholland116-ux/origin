import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaKnowledgeCollectionVersion,
  CapaKnowledgePassage,
  CapaKnowledgeSource,
  CapaKnowledgeSourceVersion,
} from "../../lib/capa/knowledge/capa-knowledge-contract";

import type {
  CapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-contract";

import {
  CAPA_KNOWLEDGE_RETRIEVAL_VALIDATION_REASON_CODES,
  CapaKnowledgeRetrievalValidationError,
  evaluateCapaKnowledgeRetrievalEligibility,
  validateCapaKnowledgeRetrievalRequest,
} from "../../lib/capa/knowledge/capa-knowledge-retrieval-validator";

const ORGANIZATION_ID =
  "7c6305db-32d4-48f0-a98f-8cb8c65c4172";
const OTHER_ORGANIZATION_ID =
  "93b74f9f-25db-4bad-a866-99b0cb7b054e";
const COLLECTION_ID =
  "4db5ef13-fd63-447f-bcdc-bf62c34c2dd7";
const COLLECTION_VERSION_ID =
  "038b01aa-9fe8-49db-b257-743037596338";
const SOURCE_ID =
  "d15a4dc2-fb74-4c79-93da-a3e9bc2f0646";
const SOURCE_VERSION_ID =
  "d864bb41-cc89-4fce-8328-6342aa11a7e3";
const PASSAGE_ID =
  "3d68fd96-6ca3-4c96-bdbf-119375862f75";

function request():
  CapaKnowledgeRetrievalRequest {
  return {
    retrieval_run_id:
      "93041279-0420-4635-a4aa-e4acde620b34",
    query_id:
      "d5106ce9-9299-4c20-a357-58eb907258d6",
    request_trace: {
      request_id: "request-001",
      correlation_id: "correlation-001",
    },
    scope: {
      organization_id: ORGANIZATION_ID,
      actor: {
        actor_type: "human",
        actor_id: "user-001",
      },
      active_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: ["SITE-001"],
      permitted_product_ids: ["PRODUCT-001"],
      collection_id: COLLECTION_ID,
      collection_version_id:
        COLLECTION_VERSION_ID,
      approved_global_sources_permitted:
        true,
    },
    task_type:
      "CAPA_INVESTIGATION_SUPPORT",
    query_text:
      "What controls apply to corrective action verification?",
    query_fingerprint: {
      algorithm: "sha256",
      value: "a".repeat(64),
    },
    filters: {
      source_types: ["SRC-01", "SRC-03"],
      jurisdictions: ["US"],
      applicability_tags: ["CAPA"],
      effective_at:
        "2026-08-24T14:00:00.000Z",
      historical_source_versions_permitted:
        false,
    },
    policy: {
      retrieval_policy_version:
        "retrieval-policy-1.0.0",
      source_precedence_policy_version:
        "precedence-policy-1.0.0",
      query_construction_version:
        "query-policy-1.0.0",
      ranking_policy_version:
        "ranking-policy-1.0.0",
      citation_policy_version:
        "citation-policy-1.0.0",
      retrieval_method: "hybrid",
      maximum_candidates: 40,
      maximum_results: 8,
      maximum_total_characters:
        24_000,
      minimum_relevance_score: 0.4,
    },
    requested_at:
      "2026-08-24T14:00:00.000Z",
  } as unknown as CapaKnowledgeRetrievalRequest;
}

function collection():
  CapaKnowledgeCollectionVersion {
  return {
    collection_id: COLLECTION_ID,
    collection_version_id:
      COLLECTION_VERSION_ID,
    organization_id: ORGANIZATION_ID,
    version_number: 1,
    purpose: "CAPA knowledge",
    audience: ["CAPA_OWNER"],
    access_policy: {
      policy_version: "policy-1.0.0",
      permitted_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: [],
      permitted_product_ids: [],
      sensitivity: "internal",
      export_permitted: false,
      excerpt_permitted: true,
      redistribution_permitted: false,
    },
    source_version_ids: [
      SOURCE_VERSION_ID,
    ],
    effective_at:
      "2026-08-01T00:00:00.000Z",
    approved_by: [{
      actor_type: "human",
      actor_id: "quality-reviewer",
    }],
    created_at:
      "2026-08-01T00:00:00.000Z",
  } as unknown as CapaKnowledgeCollectionVersion;
}

function source(): CapaKnowledgeSource {
  return {
    source_id: SOURCE_ID,
    visibility: "organization",
    organization_id: ORGANIZATION_ID,
    current_source_version_id:
      SOURCE_VERSION_ID,
    owner: {
      actor_type: "human",
      actor_id: "quality-owner",
    },
    created_at:
      "2026-08-01T00:00:00.000Z",
    created_by: {
      actor_type: "human",
      actor_id: "quality-owner",
    },
  } as CapaKnowledgeSource;
}

function sourceVersion():
  CapaKnowledgeSourceVersion {
  return {
    source_version_id: SOURCE_VERSION_ID,
    source_id: SOURCE_ID,
    organization_id: ORGANIZATION_ID,
    version_number: 1,
    source_type: "SRC-01",
    authority_class:
      "organization_procedure",
    title: "Corrective Action Procedure",
    issuer: "Example Manufacturer",
    jurisdiction: "US",
    language: "en",
    translation_status: "original",
    status: "current_effective",
    effective_at:
      "2026-08-01T00:00:00.000Z",
    applicability_tags: ["CAPA"],
    origin: "controlled_upload",
    canonical_locator:
      "controlled://procedure/001",
    content_fingerprint: {
      algorithm: "sha256",
      value: "b".repeat(64),
    },
    rights: {
      rights_classification: "owned",
      retention_policy: "quality-record",
      legal_hold: false,
    },
    access_policy: {
      policy_version: "policy-1.0.0",
      permitted_role_ids: ["CAPA_OWNER"],
      permitted_site_ids: ["SITE-001"],
      permitted_product_ids: [
        "PRODUCT-001",
      ],
      sensitivity: "internal",
      export_permitted: false,
      excerpt_permitted: true,
      redistribution_permitted: false,
    },
    onboarding_stage: "active",
    processing_status: "pass",
    processing_version:
      "processing-1.0.0",
    quality_status: "pass",
    quality_notes: [],
    approved_at:
      "2026-08-01T00:00:00.000Z",
    approved_by: {
      actor_type: "human",
      actor_id: "quality-reviewer",
    },
    activated_at:
      "2026-08-01T00:05:00.000Z",
    created_at:
      "2026-08-01T00:00:00.000Z",
    created_by: {
      actor_type: "human",
      actor_id: "quality-owner",
    },
  } as unknown as CapaKnowledgeSourceVersion;
}

function passage(): CapaKnowledgePassage {
  return {
    passage_id: PASSAGE_ID,
    source_version_id: SOURCE_VERSION_ID,
    derivative_id:
      "c64e4881-a1bb-43bc-b9d6-4e23db115ee8",
    organization_id: ORGANIZATION_ID,
    sequence_number: 1,
    segmentation_version:
      "segmenter-1.0.0",
    content:
      "Corrective actions shall be verified for effectiveness.",
    locators: [{
      kind: "section",
      label: "§ 7.4",
    }],
    overlap_passage_ids: [],
    fingerprint: {
      algorithm: "sha256",
      value: "c".repeat(64),
    },
    quality_status: "pass",
    machine_interpretable: true,
    created_at:
      "2026-08-01T00:00:00.000Z",
  } as unknown as CapaKnowledgePassage;
}

function eligibility(
  overrides: {
    request?: CapaKnowledgeRetrievalRequest;
    collection?: CapaKnowledgeCollectionVersion;
    source?: CapaKnowledgeSource;
    sourceVersion?: CapaKnowledgeSourceVersion;
    passage?: CapaKnowledgePassage;
  } = {},
) {
  return evaluateCapaKnowledgeRetrievalEligibility({
    request: overrides.request ?? request(),
    collection:
      overrides.collection ?? collection(),
    source: overrides.source ?? source(),
    source_version:
      overrides.sourceVersion ?? sourceVersion(),
    passage: overrides.passage ?? passage(),
  });
}

function expectReason(
  input: unknown,
  reasonCode: string,
): void {
  expect(() =>
    validateCapaKnowledgeRetrievalRequest(
      input,
    ),
  ).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeRetrievalValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "governed CAPA retrieval validation and eligibility",
  () => {
    it(
      "validates an exact bounded retrieval request",
      () => {
        const original = request();

        expect(
          validateCapaKnowledgeRetrievalRequest(
            original,
          ),
        ).toBe(original);
      },
    );

    it.each([
      undefined,
      null,
      "request",
      [],
    ])(
      "rejects malformed request %p",
      (value) => {
        expectReason(
          value,
          "INVALID_RETRIEVAL_REQUEST",
        );
      },
    );

    it(
      "rejects an invalid retrieval identity",
      () => {
        expectReason(
          {
            ...request(),
            retrieval_run_id: "latest",
          },
          "INVALID_RETRIEVAL_ID",
        );
      },
    );

    it(
      "rejects a malformed request trace",
      () => {
        expectReason(
          {
            ...request(),
            request_trace: {},
          },
          "INVALID_REQUEST_TRACE",
        );
      },
    );

    it(
      "rejects empty active requester roles",
      () => {
        const original = request();

        expectReason(
          {
            ...original,
            scope: {
              ...original.scope,
              active_role_ids: [],
            },
          },
          "INVALID_RETRIEVAL_SCOPE",
        );
      },
    );

    it(
      "rejects a malformed actor",
      () => {
        const original = request();

        expectReason(
          {
            ...original,
            scope: {
              ...original.scope,
              actor: {
                actor_type: "model",
                actor_id: "model-001",
              },
            },
          },
          "INVALID_RETRIEVAL_ACTOR",
        );
      },
    );

    it(
      "rejects an implicit collection version",
      () => {
        const original = request();

        expectReason(
          {
            ...original,
            scope: {
              ...original.scope,
              collection_version_id:
                "latest",
            },
          },
          "INVALID_COLLECTION_REFERENCE",
        );
      },
    );

    it.each([
      "",
      " ",
      "x".repeat(8_001),
    ])(
      "rejects unsafe query text %#",
      (queryText) => {
        expectReason(
          {
            ...request(),
            query_text: queryText,
          },
          "INVALID_QUERY",
        );
      },
    );

    it(
      "rejects a forged query fingerprint",
      () => {
        expectReason(
          {
            ...request(),
            query_fingerprint: {
              algorithm: "md5",
              value: "a".repeat(64),
            },
          },
          "INVALID_QUERY_FINGERPRINT",
        );
      },
    );

    it.each([
      { effective_at: "today" },
      { source_types: ["SRC-99"] },
      {
        jurisdictions: ["US", "US"],
      },
    ])(
      "rejects malformed retrieval filters %#",
      (override) => {
        const original = request();

        expectReason(
          {
            ...original,
            filters: {
              ...original.filters,
              ...override,
            },
          },
          "INVALID_RETRIEVAL_FILTERS",
        );
      },
    );

    it.each([
      { retrieval_method: "open_web" },
      { maximum_candidates: 0 },
      { maximum_results: 41 },
      { maximum_total_characters: 0 },
      { minimum_relevance_score: 1.1 },
      { ranking_policy_version: "latest version" },
    ])(
      "rejects unsafe retrieval policy %#",
      (override) => {
        const original = request();

        expectReason(
          {
            ...original,
            policy: {
              ...original.policy,
              ...override,
            },
          },
          "INVALID_RETRIEVAL_POLICY",
        );
      },
    );

    it(
      "rejects an invalid request timestamp",
      () => {
        expectReason(
          {
            ...request(),
            requested_at: "now",
          },
          "INVALID_TIMESTAMP",
        );
      },
    );

    it(
      "allows an exact eligible organization passage",
      () => {
        expect(eligibility()).toEqual({
          eligible: true,
        });
      },
    );

    it(
      "denies a mismatched collection version",
      () => {
        expect(eligibility({
          collection: {
            ...collection(),
            collection_version_id:
              "a341e63f-957a-4d92-98f4-9c4df7832cca",
          } as CapaKnowledgeCollectionVersion,
        })).toEqual({
          eligible: false,
          reason_code:
            "COLLECTION_VERSION_MISMATCH",
        });
      },
    );

    it(
      "denies a cross-tenant source without disclosure",
      () => {
        expect(eligibility({
          source: {
            ...source(),
            organization_id:
              OTHER_ORGANIZATION_ID,
          } as CapaKnowledgeSource,
        })).toEqual({
          eligible: false,
          reason_code:
            "TENANT_SCOPE_MISMATCH",
        });
      },
    );

    it(
      "denies an inactive or blocked source",
      () => {
        expect(eligibility({
          sourceVersion: {
            ...sourceVersion(),
            status: "blocked",
          } as CapaKnowledgeSourceVersion,
        })).toEqual({
          eligible: false,
          reason_code:
            "SOURCE_STATUS_INELIGIBLE",
        });
      },
    );

    it(
      "denies a future-effective source",
      () => {
        expect(eligibility({
          sourceVersion: {
            ...sourceVersion(),
            effective_at:
              "2026-09-01T00:00:00.000Z",
          } as CapaKnowledgeSourceVersion,
        })).toEqual({
          eligible: false,
          reason_code:
            "EFFECTIVITY_MISMATCH",
        });
      },
    );

    it(
      "denies an unauthorized requester role",
      () => {
        const original = request();

        expect(eligibility({
          request: {
            ...original,
            scope: {
              ...original.scope,
              active_role_ids: [
                "CAPA_AUDITOR",
              ],
            },
          } as CapaKnowledgeRetrievalRequest,
        })).toEqual({
          eligible: false,
          reason_code:
            "ROLE_ACCESS_DENIED",
        });
      },
    );

    it(
      "denies a site applicability mismatch",
      () => {
        const original = request();

        expect(eligibility({
          request: {
            ...original,
            scope: {
              ...original.scope,
              permitted_site_ids: [
                "SITE-OTHER",
              ],
            },
          } as CapaKnowledgeRetrievalRequest,
        })).toEqual({
          eligible: false,
          reason_code:
            "APPLICABILITY_MISMATCH",
        });
      },
    );

    it(
      "denies passage disclosure when excerpts are forbidden",
      () => {
        const original = sourceVersion();

        expect(eligibility({
          sourceVersion: {
            ...original,
            access_policy: {
              ...original.access_policy,
              excerpt_permitted: false,
            },
          } as CapaKnowledgeSourceVersion,
        })).toEqual({
          eligible: false,
          reason_code:
            "LICENSE_ACCESS_DENIED",
        });
      },
    );

    it(
      "denies a jurisdiction mismatch",
      () => {
        const original = request();

        expect(eligibility({
          request: {
            ...original,
            filters: {
              ...original.filters,
              jurisdictions: ["EU"],
            },
          } as CapaKnowledgeRetrievalRequest,
        })).toEqual({
          eligible: false,
          reason_code:
            "JURISDICTION_MISMATCH",
        });
      },
    );

    it(
      "denies a passage requiring manual quality review",
      () => {
        expect(eligibility({
          passage: {
            ...passage(),
            quality_status:
              "manual_review",
          } as CapaKnowledgePassage,
        })).toEqual({
          eligible: false,
          reason_code:
            "PASSAGE_QUALITY_INELIGIBLE",
        });
      },
    );

    it(
      "denies a non-machine-interpretable passage",
      () => {
        expect(eligibility({
          passage: {
            ...passage(),
            machine_interpretable: false,
          } as CapaKnowledgePassage,
        })).toEqual({
          eligible: false,
          reason_code:
            "PASSAGE_NOT_MACHINE_INTERPRETABLE",
        });
      },
    );

    it(
      "denies a passage without a precise locator",
      () => {
        expect(eligibility({
          passage: {
            ...passage(),
            locators: [],
          } as CapaKnowledgePassage,
        })).toEqual({
          eligible: false,
          reason_code:
            "LOCATOR_VALIDATION_FAILED",
        });
      },
    );

    it(
      "permits an approved-global source only when explicitly allowed",
      () => {
        const globalSource = {
          ...source(),
          visibility: "approved_global",
          organization_id: undefined,
        } as CapaKnowledgeSource;
        const globalVersion = {
          ...sourceVersion(),
          organization_id: undefined,
        } as unknown as CapaKnowledgeSourceVersion;
        const globalPassage = {
          ...passage(),
          organization_id: undefined,
        } as unknown as CapaKnowledgePassage;

        expect(eligibility({
          source: globalSource,
          sourceVersion: globalVersion,
          passage: globalPassage,
        })).toEqual({
          eligible: true,
        });

        const original = request();

        expect(eligibility({
          request: {
            ...original,
            scope: {
              ...original.scope,
              approved_global_sources_permitted:
                false,
            },
          } as CapaKnowledgeRetrievalRequest,
          source: globalSource,
          sourceVersion: globalVersion,
          passage: globalPassage,
        })).toEqual({
          eligible: false,
          reason_code:
            "TENANT_SCOPE_MISMATCH",
        });
      },
    );

    it(
      "provides stable validation codes and error identity",
      () => {
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_VALIDATION_REASON_CODES,
        ).toContain(
          "INVALID_RETRIEVAL_POLICY",
        );

        const error =
          new CapaKnowledgeRetrievalValidationError(
            "INVALID_QUERY",
          );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeRetrievalValidationError",
        );
        expect(error.reason_code).toBe(
          "INVALID_QUERY",
        );
      },
    );


    it.each([
      {
        sourceVersion: {
          ...sourceVersion(),
          source_id:
            "aaaaaaaa-0000-4000-8000-000000000001",
        },
        reason: "COLLECTION_VERSION_MISMATCH",
      },
      {
        passage: {
          ...passage(),
          source_version_id:
            "aaaaaaaa-0000-4000-8000-000000000002",
        },
        reason: "COLLECTION_VERSION_MISMATCH",
      },
      {
        collection: {
          ...collection(),
          source_version_ids: [],
        },
        reason: "COLLECTION_VERSION_MISMATCH",
      },
      {
        request: {
          ...request(),
          filters: {
            ...request().filters,
            source_types: ["SRC-02"],
          },
        },
        reason: "APPLICABILITY_MISMATCH",
      },
      {
        request: {
          ...request(),
          filters: {
            ...request().filters,
            jurisdictions: ["EU"],
          },
        },
        reason: "JURISDICTION_MISMATCH",
      },
      {
        request: {
          ...request(),
          filters: {
            ...request().filters,
            applicability_tags: ["other"],
          },
        },
        reason: "APPLICABILITY_MISMATCH",
      },
    ])(
      "covers exact retrieval exclusion boundary %#",
      (override) => {
        expect(
          eligibility(override as never),
        ).toMatchObject({
          eligible: false,
          reason_code: override.reason,
        });
      },
    );


    it.each([
      "service",
      "agent",
      "system",
    ] as const)(
      "validates controlled retrieval actor type %s",
      (actorType) => {
        const original = request();
        const value = {
          ...original,
          request_trace: {
            ...original.request_trace,
            idempotency_key: "retrieval-idempotency-001",
          },
          scope: {
            ...original.scope,
            actor: {
              actor_type: actorType,
              actor_id: actorType + "-001",
              actor_version: "actor-1.0.0",
            },
          },
        } as unknown as CapaKnowledgeRetrievalRequest;

        expect(validateCapaKnowledgeRetrievalRequest(value))
          .toBe(value);
      },
    );

    it(
      "permits an explicitly requested eligible historical source",
      () => {
        const original = request();
        const historicalRequest = {
          ...original,
          filters: {
            ...original.filters,
            historical_source_versions_permitted: true,
          },
        } as unknown as CapaKnowledgeRetrievalRequest;
        const historicalVersion = {
          ...sourceVersion(),
          status: "superseded",
          processing_status: "pass_with_limitations",
          quality_status: "pass_with_limitations",
          retirement_at: "2026-08-20T00:00:00.000Z",
        } as unknown as CapaKnowledgeSourceVersion;

        expect(eligibility({
          request: historicalRequest,
          sourceVersion: historicalVersion,
        })).toEqual({ eligible: true });
      },
    );

    it(
      "denies a passage with unavailable content before locator disclosure",
      () => {
        expect(eligibility({
          passage: {
            ...passage(),
            content: "   ",
          } as CapaKnowledgePassage,
        })).toEqual({
          eligible: false,
          reason_code: "PASSAGE_UNAVAILABLE",
        });
      },
    );

    it(
      "permits an explicitly approved global collection and material set",
      () => {
        const globalCollection = {
          ...collection(),
          organization_id: undefined,
        } as unknown as CapaKnowledgeCollectionVersion;
        const globalSource = {
          ...source(),
          visibility: "approved_global",
          organization_id: undefined,
        } as unknown as CapaKnowledgeSource;
        const globalVersion = {
          ...sourceVersion(),
          organization_id: undefined,
        } as unknown as CapaKnowledgeSourceVersion;
        const globalPassage = {
          ...passage(),
          organization_id: undefined,
        } as unknown as CapaKnowledgePassage;

        expect(eligibility({
          collection: globalCollection,
          source: globalSource,
          sourceVersion: globalVersion,
          passage: globalPassage,
        })).toEqual({ eligible: true });
      },
    );


    it(
      "denies a mismatched collection identity",
      () => {
        expect(eligibility({
          collection: {
            ...collection(),
            collection_id:
              "00000000-0000-4000-8000-000000000097",
          } as CapaKnowledgeCollectionVersion,
        })).toEqual({
          eligible: false,
          reason_code:
            "COLLECTION_VERSION_MISMATCH",
        });
      },
    );


    it(
      "denies a retired collection version",
      () => {
        expect(eligibility({
          collection: {
            ...collection(),
            retired_at:
              "2026-08-20T00:00:00.000Z",
          } as CapaKnowledgeCollectionVersion,
        })).toEqual({
          eligible: false,
          reason_code:
            "COLLECTION_VERSION_MISMATCH",
        });
      },
    );
  },
);
