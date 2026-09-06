import { describe, expect, it, vi } from "vitest";

import {
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
} from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
} from "../../lib/capa/domain/capa-investigation-plan";
import {
  CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
} from "../../lib/capa/domain/capa-root-cause-package";
import {
  RepositoryCapaRootCauseReviewAdvisoryContextResolver,
} from "../../lib/capa/ai/repository-capa-root-cause-review-advisory-context-resolver";

const ORG = "10000000-0000-4000-8000-000000000001" as any;
const USER = "20000000-0000-4000-8000-000000000001" as any;
const CASE = "30000000-0000-4000-8000-000000000001" as any;
const VERSION = "40000000-0000-4000-8000-000000000001" as any;
const PARENT = "40000000-0000-4000-8000-000000000002" as any;

const human = {
  source_type: "human",
  source_reference: null,
  adopted_by_user_id: null,
  adopted_at: null,
};

function ledger(itemId = "E-1", itemCount = 1) {
  const baseItem = {
    item_id: itemId,
    information_class: "user_provided_statement",
    statement: "The controlled record reports parameter A.",
    evidence_status: "current",
    assumption_status: null,
    gap_status: null,
    conflict_status: null,
    provenance: human,
    owner_user_id: null,
    information_date: null,
    source_version: "source-v1",
    context: "Authoritative ledger context",
    linked_capa_objects: [],
    supporting_item_ids: [],
    contradictory_item_ids: [],
    conflict_item_ids: [],
    material_to_conclusion: false,
    critical_to_conclusion: false,
    recommended_next_step: null,
    target_date: null,
    human_disposition: null,
  };

  return {
    items: Array.from({ length: itemCount }, (_, index) => ({
      ...baseItem,
      item_id: index === 0 ? itemId : `E-${index + 1}`,
    })),
  };
}

function rootCause(itemId = "E-1") {
  return {
    hypotheses: [
      {
        hypothesis_id: "H-1",
        statement: "Parameter variation may have contributed.",
        status: "proposed",
        causal_role: "alternative_hypothesis",
        rationale: "The supplied ledger item is relevant to this hypothesis.",
        responsible_user_id: null,
        supporting_evidence_item_ids: [itemId],
        contradictory_evidence_item_ids: [],
        linked_assumption_item_ids: [],
        linked_gap_item_ids: [],
        linked_conflict_item_ids: [],
        material_to_package: true,
        provenance: human,
      },
    ],
    root_cause_not_confirmed: null,
  };
}

function plan() {
  return {
    items: [
      {
        item_id: "INV-1",
        investigation_question: "Why did the event occur?",
        evidence_target: "Controlled event record",
        investigation_method: "Record comparison",
        owner_user_id: USER,
        due_date: "2026-09-30",
        sme_user_ids: [],
        dependency_item_ids: [],
        scope_relationship: "Accepted investigation scope",
        status: "completed",
        disposition: null,
        disposition_rationale: null,
        draft_provenance: human,
      },
    ],
  };
}

function section(
  id: string,
  type: string,
  schema: string,
  content: Record<string, unknown>,
  versionNumber = 1,
) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: id,
    section_type: type,
    version_number: versionNumber,
    schema_version: schema,
    content,
  };
}

function currentSections() {
  return [
    section(
      "S50-LEDGER",
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
      ledger(),
    ),
    section(
      "S50-ROOT",
      CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
      CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
      rootCause(),
    ),
    section(
      "S50-PLAN",
      CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
      CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
      plan(),
    ),
  ];
}

function parentSections() {
  return [
    section(
      "S40-LEDGER",
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
      ledger(),
    ),
    section(
      "S40-ROOT",
      CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
      CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
      rootCause(),
    ),
  ];
}

function setup(overrides: any = {}) {
  const sections = overrides.sections ?? currentSections();
  const prior = overrides.priorSections ?? parentSections();
  const allSections = [...sections, ...prior];
  const capaCase = {
    organization_id: ORG,
    capa_case_id: CASE,
    current_version_id: VERSION,
    status: "S50",
    record_version: 4,
    ...overrides.capaCase,
  };
  const currentVersion = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    version_number: 4,
    status: "S50",
    parent_version_id: PARENT,
    change_reason: "Submitted root cause for review",
    section_version_ids: sections.map((item: any) => item.section_version_id),
    ...overrides.currentVersion,
  };
  const parentVersion = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: PARENT,
    version_number: 3,
    status: "S40",
    change_reason: "Prior investigation version",
    section_version_ids: prior.map((item: any) => item.section_version_id),
    ...overrides.parentVersion,
  };
  const repository = {
    findCaseById: vi.fn().mockResolvedValue(capaCase),
    findCaseVersionById: vi.fn().mockImplementation(async (_org: any, _case: any, id: any) =>
      id === PARENT ? parentVersion : currentVersion,
    ),
    findSectionVersionById: vi.fn().mockImplementation(async (_org: any, _case: any, id: any) =>
      allSections.find((item: any) => item.section_version_id === id) ?? null,
    ),
  };
  const tenant: any = overrides.tenant ?? {
    organization_id: ORG,
    role_assignments: [
      {
        role_assignment_id: "role-assignment-1",
        role_id: "CAPA_REVIEWER",
        scope: "ORGANIZATION",
        effective_at: "2020-01-01T00:00:00.000Z",
      },
    ],
  };
  const resolver = new RepositoryCapaRootCauseReviewAdvisoryContextResolver({
    repository: repository as any,
    authentication: overrides.authentication ?? {
      principal: { principal_type: "human", user_id: USER },
    },
    tenant,
    now: overrides.now ?? (() => new Date("2026-09-05T09:00:00.000Z")),
  });
  return { resolver, repository };
}

function invocation(overrides: any = {}) {
  return { organization_id: ORG, capa_case_id: CASE, ...overrides };
}

describe("S50 root-cause review advisory context resolver", () => {
  it("resolves authoritative S50 material and deterministic controlled references", async () => {
    const result = await setup().resolver.resolve(invocation());

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    expect(result.assembly.authoritative).toMatchObject({
      trust: "authoritative_server_context",
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: VERSION,
      record_version: 4,
      workflow_state: "S50",
      actor: USER,
      comparison_version: { version_number: 3 },
    });
    expect(result.assembly.reference_manifest[0]).toMatchObject({
      reference_key: "R1",
      source_kind: "ledger_item",
      source_id: "E-1",
      version_scope: "current",
    });
    expect(result.assembly.model_safe_context.references[0]).toMatchObject({
      reference_key: "R1",
      trust: "authoritative_server_context",
      source_kind: "ledger_item",
      version_scope: "current",
    });
    expect(JSON.stringify(result.assembly.model_safe_context)).not.toContain(
      "S50-LEDGER",
    );
    expect(JSON.stringify(result.assembly.model_safe_context)).not.toContain(
      "E-1",
    );
    expect(Object.isFrozen(result.assembly)).toBe(true);
    expect(Object.isFrozen(result.assembly.model_safe_context.references)).toBe(true);
  });

  it("rejects a nonhuman principal before loading authoritative case data", async () => {
    const result = await setup({
      authentication: {
        principal: { principal_type: "service", service_id: "service-1" },
      },
    }).resolver.resolve(invocation());

    expect(result.status).toBe("not_found_or_not_authorized");
  });

  it("rejects a human principal with no active tenant role assignments", async () => {
    const result = await setup({
      tenant: {
        organization_id: ORG,
        role_assignments: [],
      },
    }).resolver.resolve(invocation());

    expect(result.status).toBe("not_found_or_not_authorized");
  });

  it.each([
    ["wrong organization", { organization_id: "other-org" }],
    ["wrong CAPA case", { capa_case_id: "other-case" }],
  ])(
    "rejects a current case version with a %s binding",
    async (_label, override) => {
      const result = await setup({
        currentVersion: override,
      }).resolver.resolve(invocation());

      expect(result.status).toBe("invalid_authoritative_context");
    },
  );

  it("rejects a current case version whose workflow state differs from the case", async () => {
    const result = await setup({
      currentVersion: { status: "S40" },
    }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it("rejects duplicate current section version IDs", async () => {
    const result = await setup({
      currentVersion: {
        section_version_ids: ["S50-LEDGER", "S50-LEDGER", "S50-ROOT"],
      },
    }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it("rejects S40, S60 and tenant-mismatched context", async () => {
    expect(
      (await setup({ capaCase: { status: "S40" } }).resolver.resolve(invocation())).status,
    ).toBe("wrong_workflow_state");
    expect(
      (await setup({ capaCase: { status: "S60" } }).resolver.resolve(invocation())).status,
    ).toBe("wrong_workflow_state");
    expect(
      (await setup().resolver.resolve(invocation({ organization_id: "other-org" }))).status,
    ).toBe("not_found_or_not_authorized");
  });

  it("fails closed for missing or stale required sections", async () => {
    const missingRoot = currentSections().filter(
      (item) => item.section_type !== CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
    );
    expect(
      (await setup({ sections: missingRoot }).resolver.resolve(invocation())).status,
    ).toBe("invalid_authoritative_context");

    const stale = currentSections();
    stale[0] = { ...stale[0], schema_version: "old-ledger-0.1.0" };
    expect(
      (await setup({ sections: stale }).resolver.resolve(invocation())).status,
    ).toBe("invalid_authoritative_context");

    const noParent = setup({ currentVersion: { parent_version_id: null } });
    const noParentResult = await noParent.resolver.resolve(invocation());
    expect(noParentResult.status).toBe("resolved");
    if (noParentResult.status === "resolved") {
      expect(noParentResult.assembly.authoritative.comparison_version).toBeNull();
      expect(noParentResult.assembly.model_safe_context.comparison_version_number).toBeNull();
    }
  });

  it("fails closed when the current case version or its section binding is stale", async () => {
    // This assertion covers the required record-version mismatch:
    // caseVersion.version_number !== capaCase.record_version.
    expect(
      (await setup({ currentVersion: { version_number: 3 } }).resolver.resolve(invocation())).status,
    ).toBe("invalid_authoritative_context");

    const staleSectionId = setup({
      currentVersion: { section_version_ids: ["missing-section"] },
    });
    expect(
      (await staleSectionId.resolver.resolve(invocation())).status,
    ).toBe("invalid_authoritative_context");
  });

  it.each([
    ["parent version is not older", { version_number: 4 }],
    ["parent organization is mismatched", { organization_id: "other-org" }],
    ["parent CAPA case is mismatched", { capa_case_id: "other-case" }],
    ["parent identity differs from its declared ID", { case_version_id: "other-parent" }],
  ])(
    "fails closed when %s",
    async (_label, override) => {
      const result = await setup({
        parentVersion: override,
      }).resolver.resolve(invocation());

      expect(result.status).toBe("invalid_authoritative_context");
    },
  );

  it("fails closed when a parent section binding is stale or belongs to another tenant", async () => {
    const staleParentSection = parentSections();
    staleParentSection[0] = {
      ...staleParentSection[0],
      organization_id: "other-org",
    };

    const result = await setup({
      priorSections: staleParentSection,
    }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it.each([
    ["the wrong schema version", (sections: any[]) => {
      const updated = [...sections];
      updated[2] = { ...updated[2], schema_version: "old-plan-0.1.0" };
      return updated;
    }],
    ["invalid content", (sections: any[]) => {
      const updated = [...sections];
      updated[2] = {
        ...updated[2],
        content: {
          ...updated[2].content,
          items: [{
            ...updated[2].content.items[0],
            status: "completed",
            disposition: "COMPLETED",
            disposition_rationale: "Invalid completed disposition",
          }],
        },
      };
      return updated;
    }],
  ])(
    "fails closed for an Investigation Plan with %s",
    async (_label, mutate) => {
      const result = await setup({
        sections: mutate(currentSections()),
      }).resolver.resolve(invocation());

      expect(result.status).toBe("invalid_authoritative_context");
    },
  );

  it("fails closed for invalid Investigation Ledger content", async () => {
    const sections = currentSections();
    sections[0] = {
      ...sections[0],
      content: {
        items: [{
          ...ledger().items[0],
          evidence_status: "invalid-status",
        }],
      },
    };

    const result = await setup({ sections }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it("fails closed for invalid Root-Cause Package content", async () => {
    const sections = currentSections();
    sections[1] = {
      ...sections[1],
      content: {
        ...rootCause(),
        hypotheses: [{
          ...rootCause().hypotheses[0],
          status: "invalid-status",
        }],
      },
    };

    const result = await setup({ sections }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it("fails closed at domain validation when a hypothesis references an unrepresented Ledger item", async () => {
    const sections = currentSections();
    sections[1] = {
      ...sections[1],
      content: rootCause("E-MISSING"),
    };

    const result = await setup({ sections }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it("fails closed when authoritative material would exceed the 200-reference limit", async () => {
    const sections = currentSections();
    sections[0] = {
      ...sections[0],
      content: ledger("E-1", 201),
    };

    const result = await setup({ sections }).resolver.resolve(invocation());

    expect(result.status).toBe("invalid_authoritative_context");
  });

  it("assertCaseUnchanged returns true for the unchanged authoritative S50 case", async () => {
    const subject = setup();
    const result = await subject.resolver.resolve(invocation());

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    await expect(
      subject.resolver.assertCaseUnchanged(result.assembly.authoritative),
    ).resolves.toBe(true);
  });

  it.each([
    ["current version changes", { current_version_id: "new-version" }],
    ["record version changes", { record_version: 5 }],
    ["workflow state changes", { status: "S40" }],
  ])(
    "assertCaseUnchanged returns false when the %s",
    async (_label, change) => {
      const subject = setup();
      const result = await subject.resolver.resolve(invocation());

      expect(result.status).toBe("resolved");
      if (result.status !== "resolved") return;

      subject.repository.findCaseById.mockResolvedValue({
        organization_id: ORG,
        capa_case_id: CASE,
        current_version_id: VERSION,
        status: "S50",
        record_version: 4,
        ...change,
      });

      await expect(
        subject.resolver.assertCaseUnchanged(result.assembly.authoritative),
      ).resolves.toBe(false);
    },
  );
});
