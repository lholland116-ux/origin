import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  OrganizationId,
} from "../../lib/capa/domain/capa-types";

import {
  CapaKnowledgeRepositoryConfigurationError,
  CapaKnowledgeRepositoryError,
  capaKnowledgeScopeOrganizationId,
  isCapaKnowledgeApprovedGlobalScope,
  type CapaKnowledgeScope,
} from "../../lib/database/repositories/capa-knowledge-repository";

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

describe(
  "governed CAPA knowledge repository contract",
  () => {
    it(
      "resolves an explicit organization scope",
      () => {
        const scope = {
          visibility: "organization",
          organization_id:
            ORGANIZATION_ID,
        } satisfies CapaKnowledgeScope;

        expect(
          capaKnowledgeScopeOrganizationId(
            scope,
          ),
        ).toBe(ORGANIZATION_ID);
        expect(
          isCapaKnowledgeApprovedGlobalScope(
            scope,
          ),
        ).toBe(false);
      },
    );

    it(
      "maps approved-global scope without manufacturing a tenant identity",
      () => {
        const scope = {
          visibility:
            "approved_global",
        } satisfies CapaKnowledgeScope;

        expect(
          capaKnowledgeScopeOrganizationId(
            scope,
          ),
        ).toBeNull();
        expect(
          isCapaKnowledgeApprovedGlobalScope(
            scope,
          ),
        ).toBe(true);
        expect(scope).not.toHaveProperty(
          "organization_id",
        );
      },
    );

    it(
      "provides stable repository failures",
      () => {
        const error =
          new CapaKnowledgeRepositoryError();
        const configurationError =
          new CapaKnowledgeRepositoryConfigurationError(
            "Invalid scope.",
          );

        expect(error.name).toBe(
          "CapaKnowledgeRepositoryError",
        );
        expect(error.message).toBe(
          "The governed CAPA knowledge repository operation failed.",
        );
        expect(configurationError)
          .toBeInstanceOf(
            CapaKnowledgeRepositoryError,
          );
        expect(configurationError.name)
          .toBe(
            "CapaKnowledgeRepositoryConfigurationError",
          );
        expect(configurationError.message)
          .toBe("Invalid scope.");
      },
    );
  },
);
