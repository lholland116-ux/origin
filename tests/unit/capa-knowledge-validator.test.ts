import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  OrganizationId,
} from "../../lib/capa/domain/capa-types";

import {
  CAPA_KNOWLEDGE_VALIDATION_REASON_CODES,
  CapaKnowledgeValidationError,
  assertCapaKnowledgeOrganizationScope,
  validateCapaKnowledgeRegistration,
  type CapaKnowledgeValidationReasonCode,
} from "../../lib/capa/knowledge/capa-knowledge-validator";

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

const SOURCE_ID =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90";

const SOURCE_VERSION_ID =
  "a65d17e5-4688-4412-aa08-f2832b37f671";

const SUCCESSOR_VERSION_ID =
  "779594ce-cb78-4818-a173-4c1e8217637f";

function source() {
  return {
    source_id: SOURCE_ID,
    visibility: "organization",
    organization_id:
      ORGANIZATION_ID,
    current_source_version_id:
      SOURCE_VERSION_ID,
    owner: {
      actor_type: "human",
      actor_id: "knowledge-owner",
    },
    created_at:
      "2026-08-24T12:00:00.000Z",
    created_by: {
      actor_type: "human",
      actor_id: "knowledge-owner",
    },
  };
}

function sourceVersion() {
  return {
    source_version_id:
      SOURCE_VERSION_ID,
    source_id: SOURCE_ID,
    organization_id:
      ORGANIZATION_ID,
    version_number: 1,
    source_type: "SRC-01",
    authority_class:
      "ORGANIZATION_CONTROLLED",
    title: "CAPA Procedure",
    issuer: "Example Manufacturer",
    publisher: "Quality Systems",
    jurisdiction: "United States",
    region: "Georgia",
    document_number: "SOP-QA-001",
    edition: "3",
    language: "en",
    translation_status: "ORIGINAL",
    status: "current_effective",
    publication_date: "2026-08-01",
    effective_at:
      "2026-08-20T00:00:00.000Z",
    applicability_tags: [
      "CAPA",
    ],
    origin: "CONTROLLED_UPLOAD",
    canonical_locator:
      "controlled://SOP-QA-001/3",
    content_fingerprint: {
      algorithm: "sha256",
      value: "a".repeat(64),
    },
    rights: {
      rights_classification:
        "CUSTOMER_OWNED",
      retention_policy:
        "QUALITY_RECORD",
      legal_hold: false,
    },
    access_policy: {
      policy_version:
        "knowledge-access-1.0.0",
      permitted_role_ids: [
        "CAPA_OWNER",
      ],
      permitted_site_ids: [],
      permitted_product_ids: [],
      sensitivity:
        "ORGANIZATION_CONFIDENTIAL",
      export_permitted: false,
      excerpt_permitted: true,
      redistribution_permitted:
        false,
    },
    onboarding_stage: "active",
    processing_status: "pass",
    processing_version:
      "knowledge-processing-1.0.0",
    quality_status: "pass",
    quality_notes: [],
    next_review_at:
      "2027-08-20T00:00:00.000Z",
    approved_at:
      "2026-08-19T14:00:00.000Z",
    approved_by: {
      actor_type: "human",
      actor_id: "quality-reviewer",
    },
    activated_at:
      "2026-08-20T00:00:00.000Z",
    created_at:
      "2026-08-18T12:00:00.000Z",
    created_by: {
      actor_type: "human",
      actor_id: "knowledge-owner",
    },
  };
}

function expectReason(
  sourceInput: unknown,
  versionInput: unknown,
  reason:
    CapaKnowledgeValidationReasonCode,
) {
  expect(
    () =>
      validateCapaKnowledgeRegistration(
        sourceInput,
        versionInput,
      ),
  ).toThrowError(
    expect.objectContaining({
      name:
        "CapaKnowledgeValidationError",
      reason_code: reason,
    }),
  );
}

describe(
  "governed CAPA knowledge validation",
  () => {
    it(
      "validates and freezes an activatable organization source",
      () => {
        const result =
          validateCapaKnowledgeRegistration(
            source(),
            sourceVersion(),
          );

        expect(result.source.source_id)
          .toBe(SOURCE_ID);
        expect(
          result.source_version.status,
        ).toBe("current_effective");
        expect(Object.isFrozen(result))
          .toBe(true);
      },
    );

    it.each([
      null,
      [],
    ])(
      "rejects malformed source %#",
      (value) => {
        expectReason(
          value,
          sourceVersion(),
          "INVALID_SOURCE",
        );
      },
    );

    it(
      "rejects an invalid source identity",
      () => {
        expectReason(
          {
            ...source(),
            source_id: "not-a-uuid",
          },
          sourceVersion(),
          "INVALID_SOURCE_ID",
        );
      },
    );

    it(
      "rejects an invalid visibility",
      () => {
        expectReason(
          {
            ...source(),
            visibility: "public",
          },
          sourceVersion(),
          "INVALID_VISIBILITY_SCOPE",
        );
      },
    );

    it(
      "rejects an invalid owner actor",
      () => {
        expectReason(
          {
            ...source(),
            owner: {
              actor_type: "model",
              actor_id: "",
            },
          },
          sourceVersion(),
          "INVALID_ACTOR_REFERENCE",
        );
      },
    );

    it(
      "rejects an invalid source timestamp",
      () => {
        expectReason(
          {
            ...source(),
            created_at: "yesterday",
          },
          sourceVersion(),
          "INVALID_TIMESTAMP",
        );
      },
    );

    it.each([
      null,
      [],
    ])(
      "rejects malformed source version %#",
      (value) => {
        expectReason(
          source(),
          value,
          "INVALID_SOURCE_VERSION",
        );
      },
    );

    it(
      "rejects an invalid source-version identity",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            source_version_id:
              SOURCE_ID,
          },
          "INVALID_SOURCE_VERSION_ID",
        );
      },
    );

    it(
      "rejects a source-version relationship mismatch",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            source_id:
              SUCCESSOR_VERSION_ID,
          },
          "INVALID_SOURCE_VERSION_ID",
        );
      },
    );

    it(
      "rejects a cross-organization version",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            organization_id:
              "660e8400-e29b-41d4-a716-446655440000",
          },
          "INVALID_VISIBILITY_SCOPE",
        );
      },
    );

    it(
      "accepts an approved-global source without a tenant identity",
      () => {
        const globalSource = {
          ...source(),
          visibility:
            "approved_global",
          organization_id: undefined,
        };
        const globalVersion = {
          ...sourceVersion(),
          organization_id: undefined,
        };

        expect(
          validateCapaKnowledgeRegistration(
            globalSource,
            globalVersion,
          ).source.visibility,
        ).toBe("approved_global");
      },
    );

    it(
      "rejects an invalid version number",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            version_number: 0,
          },
          "INVALID_VERSION_NUMBER",
        );
      },
    );

    it(
      "rejects an invalid source type",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            source_type: "OPEN-WEB",
          },
          "INVALID_SOURCE_TYPE",
        );
      },
    );

    it(
      "rejects incomplete identifying metadata",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            title: "",
          },
          "INVALID_SOURCE_METADATA",
        );
      },
    );

    it(
      "rejects an invalid source status",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            status: "approved",
          },
          "INVALID_SOURCE_STATUS",
        );
      },
    );

    it(
      "rejects a malformed content fingerprint",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            content_fingerprint: {
              algorithm: "sha256",
              value: "abc",
            },
          },
          "INVALID_FINGERPRINT",
        );
      },
    );

    it(
      "rejects an invalid onboarding stage",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            onboarding_stage:
              "auto_approved",
          },
          "INVALID_ONBOARDING_STAGE",
        );
      },
    );

    it(
      "rejects an invalid processing status",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            processing_status:
              "complete",
          },
          "INVALID_PROCESSING_STATUS",
        );
      },
    );

    it(
      "rejects an invalid quality status",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            quality_status: "unknown",
          },
          "INVALID_QUALITY_STATUS",
        );
      },
    );

    it(
      "rejects an invalid access policy",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            access_policy: {},
          },
          "INVALID_ACCESS_POLICY",
        );
      },
    );

    it(
      "rejects an invalid rights policy",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            rights: {},
          },
          "INVALID_RIGHTS_POLICY",
        );
      },
    );

    it(
      "rejects an invalid version timestamp",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            effective_at: "invalid",
          },
          "INVALID_TIMESTAMP",
        );
      },
    );

    it(
      "rejects retirement before effectivity",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            retirement_at:
              "2026-08-19T00:00:00.000Z",
          },
          "INVALID_EFFECTIVITY",
        );
      },
    );

    it(
      "rejects an invalid supersession identity",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            supersedes_source_version_id:
              "not-a-uuid",
          },
          "INVALID_SUPERSESSION",
        );
      },
    );

    it(
      "requires human approval at the approved stage",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            status: "draft",
            onboarding_stage:
              "approved",
            approved_at: undefined,
            approved_by: undefined,
            activated_at: undefined,
          },
          "APPROVAL_REQUIRED",
        );
      },
    );

    it(
      "requires an activation timestamp at the active stage",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            status: "draft",
            activated_at: undefined,
          },
          "ACTIVATION_REQUIRED",
        );
      },
    );

    it(
      "blocks current-effective activation after failed processing",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            processing_status:
              "failed",
          },
          "SOURCE_NOT_ACTIVATABLE",
        );
      },
    );

    it(
      "requires a successor for a superseded source",
      () => {
        expectReason(
          source(),
          {
            ...sourceVersion(),
            status: "superseded",
            onboarding_stage:
              "validated",
            approved_at: undefined,
            approved_by: undefined,
            activated_at: undefined,
          },
          "INVALID_SUPERSESSION",
        );
      },
    );

    it(
      "enforces the active organization at use",
      () => {
        const validated =
          validateCapaKnowledgeRegistration(
            source(),
            sourceVersion(),
          );

        expect(
          () =>
            assertCapaKnowledgeOrganizationScope(
              "660e8400-e29b-41d4-a716-446655440000" as
                OrganizationId,
              validated.source,
            ),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "INVALID_VISIBILITY_SCOPE",
          }),
        );

        expect(
          () =>
            assertCapaKnowledgeOrganizationScope(
              ORGANIZATION_ID,
              validated.source,
            ),
        ).not.toThrow();
      },
    );

    it(
      "provides stable controlled errors",
      () => {
        const error =
          new CapaKnowledgeValidationError(
            "INVALID_SOURCE",
          );

        expect(error.name).toBe(
          "CapaKnowledgeValidationError",
        );
        expect(error.reason_code).toBe(
          "INVALID_SOURCE",
        );
        expect(error.message).toBe(
          "The governed CAPA knowledge source is invalid.",
        );
        expect(
          CAPA_KNOWLEDGE_VALIDATION_REASON_CODES,
        ).not.toContain(
          "AUTO_APPROVED",
        );
      },
    );
  },
);
