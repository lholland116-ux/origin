import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_KNOWLEDGE_INDEX_STATUSES,
  CapaKnowledgeRetrievalRepositoryError,
  isCapaKnowledgeIndexSearchable,
  type CapaKnowledgeRetrievalIndexEntry,
  type CapaKnowledgeRetrievalIndexRepository,
} from "../../lib/database/repositories/capa-knowledge-retrieval-repository";

describe(
  "governed CAPA knowledge retrieval repository contract",
  () => {
    it(
      "defines the complete controlled index lifecycle",
      () => {
        expect(
          CAPA_KNOWLEDGE_INDEX_STATUSES,
        ).toEqual([
          "pending",
          "ready",
          "partial",
          "blocked",
          "retired",
        ]);
        expect(
          Object.isFrozen(
            CAPA_KNOWLEDGE_INDEX_STATUSES,
          ),
        ).toBe(false);
      },
    );

    it.each([
      ["pending", false],
      ["ready", true],
      ["partial", true],
      ["blocked", false],
      ["retired", false],
    ] as const)(
      "maps index status %s to searchable %s",
      (status, expected) => {
        expect(
          isCapaKnowledgeIndexSearchable(
            status,
          ),
        ).toBe(expected);
      },
    );

    it(
      "keeps tenant and approved-global visibility explicit",
      () => {
        const organizationEntry = {
          organization_id:
            "00000000-0000-4000-8000-000000000001",
          approved_global: false,
        } as Pick<
          CapaKnowledgeRetrievalIndexEntry,
          "organization_id" |
          "approved_global"
        >;
        const globalEntry = {
          approved_global: true,
        } as Pick<
          CapaKnowledgeRetrievalIndexEntry,
          "organization_id" |
          "approved_global"
        >;

        expect(
          organizationEntry.organization_id,
        ).toBeDefined();
        expect(
          organizationEntry.approved_global,
        ).toBe(false);
        expect(
          globalEntry.organization_id,
        ).toBeUndefined();
        expect(
          globalEntry.approved_global,
        ).toBe(true);
      },
    );

    it(
      "requires metadata-only candidate search and governed writes",
      () => {
        const repository = {
          findEntry: async () => null,
          search: async (search) => ({
            retrieval_run_id:
              search.request.retrieval_run_id,
            retrieval_method:
              search.request.policy.retrieval_method,
            index_version:
              "index-1.0.0" as never,
            index_status:
              "ready" as const,
            candidates: [],
          }),
          insertEntry: async () => undefined,
          replaceDerivedEntry:
            async () => "replaced" as const,
        } satisfies CapaKnowledgeRetrievalIndexRepository;

        expect(repository.findEntry)
          .toEqual(expect.any(Function));
        expect(repository.search)
          .toEqual(expect.any(Function));
        expect(repository.insertEntry)
          .toEqual(expect.any(Function));
        expect(repository.replaceDerivedEntry)
          .toEqual(expect.any(Function));
        expect(repository)
          .not.toHaveProperty("deleteEntry");
      },
    );

    it(
      "provides a stable controlled repository failure",
      () => {
        const error =
          new CapaKnowledgeRetrievalRepositoryError();

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(
          "CapaKnowledgeRetrievalRepositoryError",
        );
        expect(error.message).toBe(
          "The governed CAPA knowledge retrieval repository operation failed.",
        );
      },
    );
  },
);
