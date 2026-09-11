import { describe, expect, it } from "vitest";
import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
} from "../../lib/capa/domain/capa-implementation-review-decision";
import {
  CapaImplementationReviewDecisionRepositoryError,
} from "../../lib/database/repositories/capa-implementation-review-decision-repository";
import {
  InMemoryCapaImplementationReviewDecisionRepository,
} from "../../lib/database/in-memory/in-memory-capa-implementation-review-decision-repository";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000001";
const BASELINE = "40000000-0000-4000-8000-000000000001";
const RESULT = "50000000-0000-4000-8000-000000000001";
const REVIEWER = "60000000-0000-4000-8000-000000000001";
const AUDIT = "70000000-0000-4000-8000-000000000001";
const AT = "2026-09-09T12:00:00.000Z";
const TRANSACTION = {} as never;

function decision(overrides: Record<string, unknown> = {}): any {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    source_case_version_id: SOURCE,
    implementation_review_baseline_section_version_id:
      BASELINE,
    schema_version:
      CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
    decision: "accept",
    rationale: "The implementation evidence is acceptable.",
    reviewer_user_id: REVIEWER,
    decided_at: AT,
    resulting_case_version_id: RESULT,
    transition_audit_event_id: AUDIT,
    ...overrides,
  };
}

describe(
  "in-memory CAPA implementation-review decision repository",
  () => {
    it("saves and finds one tenant-scoped immutable decision", async () => {
      const repository =
        new InMemoryCapaImplementationReviewDecisionRepository();

      await expect(
        repository.saveDecision(TRANSACTION, decision()),
      ).resolves.toMatchObject({
        status: "saved",
        decision: decision(),
      });
      await expect(
        repository.findDecision(
          ORG as never,
          CASE as never,
          SOURCE as never,
        ),
      ).resolves.toMatchObject(decision());
      await expect(
        repository.findDecision(
          "80000000-0000-4000-8000-000000000001" as never,
          CASE as never,
          SOURCE as never,
        ),
      ).resolves.toBeNull();
      await expect(
        repository.findDecisionInTransaction(
          TRANSACTION,
          ORG as never,
          CASE as never,
          SOURCE as never,
        ),
      ).resolves.toMatchObject(decision());
    });

    it.each(["accept", "return"] as const)(
      "conflicts with a second %s decision for the same S90 baseline",
      async (secondDecision) => {
        const repository =
          new InMemoryCapaImplementationReviewDecisionRepository();
        await repository.saveDecision(TRANSACTION, decision());

        await expect(
          repository.saveDecision(
            TRANSACTION,
            decision({
              decision: secondDecision,
              rationale:
                secondDecision === "return"
                  ? "The implementation requires rework."
                  : "The implementation remains acceptable.",
            }),
          ),
        ).resolves.toMatchObject({
          status: "conflict",
          reason_code: "DECISION_ALREADY_COMMITTED",
          decision: decision(),
        });
      },
    );

    it("rejects malformed committed records before persistence", async () => {
      expect(() =>
        new InMemoryCapaImplementationReviewDecisionRepository([
          decision({
            implementation_review_baseline_section_version_id:
              "not-a-uuid",
          }),
        ]),
      ).toThrow(CapaImplementationReviewDecisionRepositoryError);

      const repository =
        new InMemoryCapaImplementationReviewDecisionRepository();
      await expect(
        repository.saveDecision(
          TRANSACTION,
          decision({ rationale: "   " }),
        ),
      ).rejects.toThrow(CapaImplementationReviewDecisionRepositoryError);
    });

    it("does not expose mutable stored state", async () => {
      const repository =
        new InMemoryCapaImplementationReviewDecisionRepository();
      const saved = await repository.saveDecision(
        TRANSACTION,
        decision(),
      );
      if (saved.status !== "saved") {
        throw new Error("expected saved decision");
      }

      const found = await repository.findDecision(
        ORG as never,
        CASE as never,
        SOURCE as never,
      );
      expect(Object.isFrozen(saved.decision)).toBe(true);
      expect(found).not.toBe(saved.decision);
      expect(found).toEqual(saved.decision);
    });
  },
);
