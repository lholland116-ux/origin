import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
} from "../../lib/capa/domain/capa-investigation-plan";
import {
  RepositoryCapaInvestigationActiveAdvisoryContextResolver,
} from "../../lib/capa/ai/repository-capa-investigation-active-advisory-context-resolver";

const ORG =
  "10000000-0000-4000-8000-000000000001" as any;
const USER =
  "20000000-0000-4000-8000-000000000001" as any;
const CASE =
  "30000000-0000-4000-8000-000000000001" as any;
const VERSION =
  "40000000-0000-4000-8000-000000000001" as any;
const PLAN =
  "50000000-0000-4000-8000-000000000001" as any;

const human = {
  source_type: "human",
  source_reference: null,
  adopted_by_user_id: null,
  adopted_at: null,
};

function plan(
  itemOverrides: Record<string, unknown> = {},
) {
  return {
    items: [
      {
        item_id: "INV-1",
        investigation_question:
          "Why did the seal fail?",
        evidence_target:
          "Equipment and batch records",
        investigation_method:
          "Controlled record comparison",
        owner_user_id: USER,
        due_date: "2026-09-30",
        sme_user_ids: [],
        dependency_item_ids: [],
        scope_relationship:
          "Approved affected packaging scope",
        status: "in_progress",
        disposition: null,
        disposition_rationale: null,
        draft_provenance: human,
        ...itemOverrides,
      },
    ],
  };
}

function ledger() {
  return {
    items: [
      {
        item_id: "E-1",
        information_class:
          "user_provided_statement",
        statement:
          "The setup record reports parameter A.",
        evidence_status: "current",
        assumption_status: null,
        gap_status: null,
        conflict_status: null,
        provenance: human,
        owner_user_id: null,
        information_date: null,
        source_version: null,
        context: "Current workspace draft",
        linked_capa_objects: [],
        supporting_item_ids: [],
        contradictory_item_ids: [],
        conflict_item_ids: [],
        material_to_conclusion: false,
        critical_to_conclusion: false,
        recommended_next_step: null,
        target_date: null,
        human_disposition: null,
      },
      {
        item_id: "A-1",
        information_class: "assumption",
        statement:
          "All affected units used the same setup.",
        evidence_status: null,
        assumption_status: "open",
        gap_status: null,
        conflict_status: null,
        provenance: human,
        owner_user_id: null,
        information_date: null,
        source_version: null,
        context: null,
        linked_capa_objects: [],
        supporting_item_ids: [],
        contradictory_item_ids: [],
        conflict_item_ids: [],
        material_to_conclusion: true,
        critical_to_conclusion: false,
        recommended_next_step: null,
        target_date: null,
        human_disposition: null,
      },
    ],
  };
}

function rootCause() {
  return {
    hypotheses: [
      {
        hypothesis_id: "H-1",
        statement:
          "Setup variation may have contributed.",
        status: "proposed",
        causal_role: "alternative_hypothesis",
        rationale:
          "The current draft evidence does not exclude variation.",
        responsible_user_id: null,
        supporting_evidence_item_ids: ["E-1"],
        contradictory_evidence_item_ids: [],
        linked_assumption_item_ids: ["A-1"],
        linked_gap_item_ids: [],
        linked_conflict_item_ids: [],
        material_to_package: true,
        provenance: human,
      },
    ],
    root_cause_not_confirmed: null,
  };
}

function validDraft() {
  return {
    trust: "untrusted_human_draft",
    evidence_assumption_ledger: ledger(),
    root_cause_package: rootCause(),
  };
}

function makePlanSection(
  overrides: Record<string, unknown> = {},
) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: PLAN,
    section_type:
      CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
    version_number: 1,
    schema_version:
      CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
    content: plan(),
    ...overrides,
  };
}

function setup(overrides: any = {}) {
  const sections =
    overrides.sections ??
    [makePlanSection()];

  const capaCase = {
    organization_id: ORG,
    capa_case_id: CASE,
    current_version_id: VERSION,
    status: "S40",
    record_version: 4,
    ...overrides.capaCase,
  };

  const caseVersion = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    status: "S40",
    version_number: 4,
    section_version_ids:
      sections.map(
        (section: any) =>
          section.section_version_id,
      ),
    ...overrides.version,
  };

  const repository = {
    findCaseById:
      vi.fn().mockResolvedValue(capaCase),
    findCaseVersionById:
      vi.fn().mockResolvedValue(caseVersion),
    findSectionVersionById:
      vi.fn().mockImplementation(
        async (
          _organizationId: any,
          _caseId: any,
          sectionVersionId: any,
        ) =>
          sections.find(
            (section: any) =>
              section.section_version_id ===
              sectionVersionId,
          ) ?? null,
      ),
  };

  const tenant: any = {
    organization_id: ORG,
    authorization_policy_version:
      "policy-1",
    role_assignments: [
      {
        role_assignment_id:
          "role-assignment-1",
        role_id: "CAPA_OWNER",
        scope: "ORGANIZATION",
        effective_at:
          "2020-01-01T00:00:00.000Z",
      },
    ],
  };

  const resolver =
    new RepositoryCapaInvestigationActiveAdvisoryContextResolver({
      repository: repository as any,
      authentication:
        overrides.authentication ?? {
          principal: {
            principal_type: "human",
            user_id: USER,
          },
        },
      tenant,
      now:
        overrides.now ??
        (() =>
          new Date(
            "2026-09-05T09:00:00.000Z",
          )),
    });

  return {
    resolver,
    repository,
    tenant,
    capaCase,
    caseVersion,
  };
}

function invocation(overrides: any = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    ...overrides,
  };
}

function resolvedAssembly(result: any): any {
  return result.status === "resolved" ? result.assembly : undefined;
}

describe(
  "S40 investigation-active advisory context resolver",
  () => {
    it("resolves authoritative S40 plan without pretending draft root-cause content is authoritative", async () => {
      const result =
        await setup().resolver.resolve(
          invocation({
            untrusted_human_draft:
              validDraft(),
          }),
        );

      expect(
        resolvedAssembly(result)?.authoritative,
      ).toMatchObject({
        trust:
          "authoritative_server_context",
        organization_id: ORG,
        capa_case_id: CASE,
        case_version_id: VERSION,
        record_version: 4,
        workflow_state: "S40",
        actor: USER,
      });

      expect(
        resolvedAssembly(result)?.authoritative
          .investigation_plan.items[0],
      ).toMatchObject({
        item_id: "INV-1",
        status: "in_progress",
      });

      expect(
        resolvedAssembly(result)?.reference_manifest,
      ).toEqual([
        expect.objectContaining({
          reference_key: "R1",
          trust:
            "authoritative_server_context",
          source_kind:
            "investigation_plan_item",
          source_id: "INV-1",
        }),
        expect.objectContaining({
          reference_key: "R2",
          trust:
            "untrusted_human_draft",
          source_kind: "ledger_item",
          source_id: "E-1",
        }),
        expect.objectContaining({
          reference_key: "R3",
          trust:
            "untrusted_human_draft",
          source_kind: "ledger_item",
          source_id: "A-1",
        }),
        expect.objectContaining({
          reference_key: "R4",
          trust:
            "untrusted_human_draft",
          source_kind:
            "causal_hypothesis",
          source_id: "H-1",
        }),
      ]);

      expect(
        resolvedAssembly(result)?.model_safe_context
          .references,
      ).toHaveLength(4);

      expect(
        resolvedAssembly(result)?.model_safe_context
          .references[3],
      ).toMatchObject({
        reference_key: "R4",
        trust:
          "untrusted_human_draft",
        source_kind:
          "causal_hypothesis",
        supporting_reference_keys: ["R2"],
        linked_assumption_reference_keys:
          ["R3"],
      });

      const modelJson =
        JSON.stringify(
          resolvedAssembly(result)?.model_safe_context,
        );

      expect(modelJson).not.toContain(
        "INV-1",
      );
      expect(modelJson).not.toContain(
        "E-1",
      );
      expect(modelJson).not.toContain(
        "A-1",
      );
      expect(modelJson).not.toContain(
        "H-1",
      );

      expect(result.status).toBe("resolved");
      expect(Object.isFrozen(resolvedAssembly(result))).toBe(
        true,
      );
      expect(
        Object.isFrozen(
          resolvedAssembly(result)?.authoritative,
        ),
      ).toBe(true);
      expect(
        Object.isFrozen(
          resolvedAssembly(result)?.reference_manifest,
        ),
      ).toBe(true);
      expect(
        Object.isFrozen(
          resolvedAssembly(result)?.model_safe_context,
        ),
      ).toBe(true);
    });

    it("supports an authoritative S40 plan with no workspace draft", async () => {
      const result =
        await setup().resolver.resolve(
          invocation(),
        );

      expect(
        resolvedAssembly(result)?.reference_manifest,
      ).toHaveLength(1);

      expect(
        resolvedAssembly(result)?.model_safe_context
          .references,
      ).toEqual([
        expect.objectContaining({
          reference_key: "R1",
          source_kind:
            "investigation_plan_item",
          trust:
            "authoritative_server_context",
        }),
      ]);
    });

    it("preserves nullable authoritative plan fields in model-safe references", async () => {
      const result = await setup({
        sections: [
          makePlanSection({
            content: plan({
              investigation_question: null,
              evidence_target: null,
              investigation_method: null,
              scope_relationship: null,
            }),
          }),
        ],
      }).resolver.resolve(invocation());

      expect(resolvedAssembly(result)?.model_safe_context.references[0]).toMatchObject({
        reference_key: "R1",
        source_kind: "investigation_plan_item",
        investigation_question: null,
        evidence_target: null,
        investigation_method: null,
        scope_relationship: null,
      });
    });

    it("requires human, tenant-bound, current S40 state and an active role", async () => {
      expect(
        await setup({
          capaCase: { status: "S30" },
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "wrong_workflow_state" });

      expect(
        await setup({
          version: { status: "S30" },
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "wrong_workflow_state" });

      expect(
        await setup({
          version: { version_number: 5 },
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });

      expect(
        await setup({
          authentication: {
            principal: {
              principal_type: "service",
            },
          },
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "not_found_or_not_authorized" });

      const wrongTenant = setup();
      wrongTenant.tenant.organization_id =
        "other-org";

      expect(
        await wrongTenant.resolver.resolve(
          invocation(),
        ),
      ).toEqual({ status: "not_found_or_not_authorized" });

      const noRole = setup();
      noRole.tenant.role_assignments = [
        {
          role_assignment_id: "future",
          role_id: "CAPA_OWNER",
          scope: "ORGANIZATION",
          effective_at:
            "2030-01-01T00:00:00.000Z",
        },
      ];

      expect(
        await noRole.resolver.resolve(
          invocation(),
        ),
      ).toEqual({ status: "not_found_or_not_authorized" });
    });

    it("fails closed for missing, duplicate, malformed, or misbound authoritative plan sections", async () => {
      expect(
        await setup({
          sections: [],
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });

      const planSection =
        makePlanSection();

      expect(
        await setup({
          sections: [
            planSection,
            makePlanSection({
              section_version_id:
                "60000000-0000-4000-8000-000000000001",
            }),
          ],
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });

      expect(
        await setup({
          sections: [
            makePlanSection({
              schema_version:
                "wrong-schema",
            }),
          ],
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });

      expect(
        await setup({
          sections: [
            makePlanSection({
              content: {},
            }),
          ],
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });

      expect(
        await setup({
          sections: [
            makePlanSection({
              organization_id:
                "other-org",
            }),
          ],
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });

      expect(
        await setup({
          sections: [
            makePlanSection({
              capa_case_id:
                "other-case",
            }),
          ],
        }).resolver.resolve(invocation()),
      ).toEqual({ status: "invalid_authoritative_context" });
    });

    it("fails closed for malformed untrusted workspace drafts", async () => {
      expect(
        await setup().resolver.resolve(
          invocation({
            untrusted_human_draft: {
              ...validDraft(),
              forged_authority: true,
            },
          }),
        ),
      ).toEqual({ status: "invalid_authoritative_context" });

      const malformed =
        validDraft() as any;

      malformed.root_cause_package
        .hypotheses[0]
        .supporting_evidence_item_ids =
        ["UNKNOWN"];

      expect(
        await setup().resolver.resolve(
          invocation({
            untrusted_human_draft:
              malformed,
          }),
        ),
      ).toEqual({ status: "invalid_authoritative_context" });
    });

    it("accepts a carried-forward immutable investigation-plan section in a newer S40 case version", async () => {
      const result =
        await setup({
          sections: [
            makePlanSection({
              version_number: 1,
            }),
          ],
          capaCase: {
            record_version: 7,
          },
          version: {
            version_number: 7,
          },
        }).resolver.resolve(
          invocation(),
        );

      expect(
        resolvedAssembly(result)?.authoritative,
      ).toMatchObject({
        workflow_state: "S40",
        record_version: 7,
      });
    });
  },
);

describe(
  "S40 investigation-active advisory stale-state assertion",
  () => {
    it("returns true only while the authoritative case/version remain current", async () => {
      const current = setup();

      const resolved =
        await current.resolver.resolve(
          invocation(),
        );

      expect(
        await current.resolver
          .assertCaseUnchanged(
            resolvedAssembly(resolved)!.authoritative,
          ),
      ).toBe(true);

      current.repository.findCaseById
        .mockResolvedValueOnce({
          ...current.capaCase,
          record_version: 5,
        });

      expect(
        await current.resolver
          .assertCaseUnchanged(
            resolvedAssembly(resolved)!.authoritative,
          ),
      ).toBe(false);

      current.repository.findCaseById
        .mockRejectedValueOnce(
          new Error("repository"),
        );

      expect(
        await current.resolver
          .assertCaseUnchanged(
            resolvedAssembly(resolved)!.authoritative,
          ),
      ).toBe(false);
    });
  },
);
