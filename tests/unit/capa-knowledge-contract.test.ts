import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_KNOWLEDGE_DERIVATIVE_KINDS,
  CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHMS,
  CAPA_KNOWLEDGE_INGESTION_REASON_CODES,
  CAPA_KNOWLEDGE_LOCATOR_KINDS,
  CAPA_KNOWLEDGE_ONBOARDING_STAGES,
  CAPA_KNOWLEDGE_PROCESSING_STATUSES,
  CAPA_KNOWLEDGE_QUALITY_STATUSES,
  CAPA_KNOWLEDGE_RETRIEVAL_ELIGIBLE_STATUSES,
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
  CAPA_KNOWLEDGE_SOURCE_TYPES,
  CAPA_KNOWLEDGE_VISIBILITIES,
  isCapaKnowledgeSourceStatusRetrievalEligible,
  type CapaKnowledgeOriginalArtifact,
  type CapaKnowledgeSourceVersion,
} from "../../lib/capa/knowledge/capa-knowledge-contract";

describe(
  "governed CAPA knowledge contract",
  () => {
    it(
      "defines the approved source-type model",
      () => {
        expect(
          CAPA_KNOWLEDGE_SOURCE_TYPES,
        ).toEqual([
          "SRC-01",
          "SRC-02",
          "SRC-03",
          "SRC-04",
          "SRC-05",
          "SRC-06",
          "SRC-07",
          "SRC-08",
          "SRC-09",
          "SRC-10",
        ]);
      },
    );

    it(
      "defines explicit tenant and approved-global visibility",
      () => {
        expect(
          CAPA_KNOWLEDGE_VISIBILITIES,
        ).toEqual([
          "organization",
          "approved_global",
        ]);
        expect(
          CAPA_KNOWLEDGE_VISIBILITIES,
        ).not.toContain("public_uncontrolled");
      },
    );

    it(
      "defines the complete controlled source lifecycle",
      () => {
        expect(
          CAPA_KNOWLEDGE_SOURCE_STATUSES,
        ).toEqual([
          "draft",
          "current_effective",
          "future",
          "superseded",
          "withdrawn",
          "archived",
          "unverified",
          "blocked",
        ]);
      },
    );

    it(
      "permits only current effective sources by status",
      () => {
        expect(
          CAPA_KNOWLEDGE_RETRIEVAL_ELIGIBLE_STATUSES,
        ).toEqual([
          "current_effective",
        ]);

        for (
          const status
          of CAPA_KNOWLEDGE_SOURCE_STATUSES
        ) {
          expect(
            isCapaKnowledgeSourceStatusRetrievalEligible(
              status,
            ),
          ).toBe(
            status ===
              "current_effective",
          );
        }
      },
    );

    it(
      "fixes the controlled onboarding sequence",
      () => {
        expect(
          CAPA_KNOWLEDGE_ONBOARDING_STAGES,
        ).toEqual([
          "registered",
          "quarantined",
          "identified",
          "verified",
          "assessed",
          "processed",
          "validated",
          "approved",
          "active",
        ]);
      },
    );

    it(
      "defines fail-closed processing and quality outcomes",
      () => {
        expect(
          CAPA_KNOWLEDGE_PROCESSING_STATUSES,
        ).toEqual([
          "pending",
          "running",
          "pass",
          "pass_with_limitations",
          "manual_review",
          "failed",
          "blocked",
        ]);
        expect(
          CAPA_KNOWLEDGE_QUALITY_STATUSES,
        ).toEqual([
          "pass",
          "pass_with_limitations",
          "manual_review",
          "failed",
          "blocked",
        ]);
      },
    );

    it(
      "separates original artifacts from controlled derivatives",
      () => {
        expect(
          CAPA_KNOWLEDGE_DERIVATIVE_KINDS,
        ).toEqual([
          "extracted_text",
          "ocr_text",
          "normalized_text",
        ]);
        expect(
          CAPA_KNOWLEDGE_DERIVATIVE_KINDS,
        ).not.toContain(
          "original_bytes",
        );

        const artifact = {
          quarantined: true,
          storage_reference:
            "controlled://artifact",
        } as unknown as
          CapaKnowledgeOriginalArtifact;

        expect(artifact.quarantined)
          .toBe(true);
        expect(artifact)
          .not.toHaveProperty("content");
      },
    );

    it(
      "defines stable locators and SHA-256 fingerprints",
      () => {
        expect(
          CAPA_KNOWLEDGE_LOCATOR_KINDS,
        ).toEqual([
          "page",
          "section",
          "paragraph",
          "table",
          "row",
          "sheet",
          "cell_range",
          "character_range",
        ]);
        expect(
          CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHMS,
        ).toEqual([
          "sha256",
        ]);
      },
    );

    it(
      "defines stable idempotent ingestion outcomes",
      () => {
        expect(
          CAPA_KNOWLEDGE_INGESTION_REASON_CODES,
        ).toContain(
          "IDENTICAL_INPUT_ALREADY_REGISTERED",
        );
        expect(
          CAPA_KNOWLEDGE_INGESTION_REASON_CODES,
        ).toContain(
          "TENANT_SCOPE_DENIED",
        );
        expect(
          CAPA_KNOWLEDGE_INGESTION_REASON_CODES,
        ).toContain(
          "MANUAL_REVIEW_REQUIRED",
        );
        expect(
          CAPA_KNOWLEDGE_INGESTION_REASON_CODES,
        ).not.toContain(
          "AUTO_APPROVED",
        );
      },
    );

    it(
      "keeps approval and activation attributable",
      () => {
        const version = {
          approved_at:
            "2026-08-24T12:00:00.000Z",
          approved_by: {
            actor_type: "human",
            actor_id: "quality-reviewer",
          },
          activated_at:
            "2026-08-24T12:05:00.000Z",
        } as unknown as
          CapaKnowledgeSourceVersion;

        expect(version.approved_by)
          .toMatchObject({
            actor_type: "human",
          });
        expect(version)
          .not.toHaveProperty(
            "model_approved",
          );
      },
    );
  },
);
