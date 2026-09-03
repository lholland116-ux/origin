import { describe, expect, it, vi } from "vitest";

import { RepositoryCapaInvestigationPlanningAdvisoryContextResolver } from "../../lib/capa/ai/repository-capa-investigation-planning-advisory-context-resolver";

const ORG = "10000000-0000-4000-8000-000000000001" as any;
const USER = "20000000-0000-4000-8000-000000000001" as any;
const CASE = "30000000-0000-4000-8000-000000000001" as any;
const VERSION = "40000000-0000-4000-8000-000000000001" as any;
const INTAKE = "50000000-0000-4000-8000-000000000001" as any;
const SCOPE = "60000000-0000-4000-8000-000000000001" as any;
const RISK = "70000000-0000-4000-8000-000000000001" as any;

function validScope() {
  return {
    problem_statement:
      "Thread depth is below the drawing requirement on sampled units.",
    scope_dimensions: {
      what: "Primary-port thread depth",
      where: "Machining operation 40",
      when: "2026-08-28 production",
      extent: "12 of 50 sampled units",
      detection_method: "Final dimensional inspection",
    },
    affected_scope_elements: [
      { element_type: "product", value: "Device family A" },
      { element_type: "process", value: "Machining operation 40" },
    ],
    included_scope: ["Batch under investigation"],
    exclusions: [
      {
        subject: "Earlier verified lot",
        rationale: "Independent records show a different setup.",
      },
    ],
    extent_summary: {
      magnitude: "12 nonconforming sampled units",
      frequency: "12 of 50 sampled",
      trend: null,
      affected_population: "Batch population under investigation",
    },
    priority: "High",
    target_dates: [
      { label: "Investigation target", target_date: "2026-09-15" },
    ],
    applicability: {
      decision: "capa_applicable",
      rationale: "A systemic investigation is required.",
    },
    source_reference: "NCR-2026-0042",
    evidence_references: ["inspection-record-001"],
    unresolved_scope_gaps: [],
    required_escalations: [
      {
        process: "Regulatory assessment",
        reference: "RA-2026-001",
        status: "resolved",
        rationale: "Qualified review completed before G-01.",
      },
    ],
  };
}

function validRisk() {
  return {
    actions: [],
    impact_scope: {
      products: [],
      processes: [],
      data: [],
      customers: [],
      patients: [],
    },
    risk_evaluation: null,
    missing_risk_information: [],
    escalations: [],
  };
}

function makeSection(
  sectionVersionId: any,
  sectionType: string,
  schemaVersion: string,
  content: Record<string, unknown>,
) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: sectionVersionId,
    section_type: sectionType,
    version_number: 2,
    schema_version: schemaVersion,
    content,
  };
}

function makeSections() {
  return [
    makeSection(INTAKE, "CAPA.INTAKE", "intake-1.0.0", {
      initiating_event: "Thread-depth nonconformance",
      source: {
        source_type: "NCR",
        source_reference: "NCR-2026-0042",
      },
      organization_reference: "ORG-001",
    }),
    makeSection(SCOPE, "CAPA.SCOPE", "capa-scope-1.1.0", validScope()),
    makeSection(
      RISK,
      "CAPA.CONTAINMENT_RISK",
      "capa-containment-risk-1.0.0",
      validRisk(),
    ),
  ];
}

function setup(overrides: any = {}) {
  const sections = overrides.sections ?? makeSections();
  const capaCase = {
    organization_id: ORG,
    capa_case_id: CASE,
    current_version_id: VERSION,
    status: "S30",
    record_version: 2,
    ...overrides.capaCase,
  };
  const caseVersion = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    status: "S30",
    version_number: 2,
    section_version_ids: sections.map((section: any) =>
      section.section_version_id,
    ),
    ...overrides.version,
  };
  const repository = {
    findCaseById: vi.fn().mockResolvedValue(capaCase),
    findCaseVersionById: vi.fn().mockResolvedValue(caseVersion),
    findSectionVersionById: vi.fn().mockImplementation(
      async (_organizationId: any, _caseId: any, sectionVersionId: any) =>
        sections.find((section: any) =>
          section.section_version_id === sectionVersionId,
        ) ?? null,
    ),
  };
  const tenant: any = {
    organization_id: ORG,
    role_assignments: [
      {
        role_assignment_id: "role-assignment-1",
        role_id: "CAPA_OWNER",
        scope: "ORGANIZATION",
        effective_at: "2020-01-01T00:00:00.000Z",
      },
    ],
  };
  const resolver =
    new RepositoryCapaInvestigationPlanningAdvisoryContextResolver({
      repository: repository as any,
      authentication: overrides.authentication ?? {
        principal: { principal_type: "human", user_id: USER },
      },
      tenant,
      intake_section_type: "CAPA.INTAKE" as any,
      intake_schema_version: "intake-1.0.0",
      now: overrides.now ?? (() => new Date("2026-09-01T00:00:00.000Z")),
    });

  return { resolver, repository, tenant };
}

function invocation(overrides: any = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    ...overrides,
  };
}

const validDraft = {
  trust: "untrusted_human_draft",
  content: {
    items: [
      {
        local_key: "D1",
        investigation_question: "Does the setup record explain the deviation?",
        evidence_target: "Setup record",
        investigation_method: "Record review",
        scope_relationship: "Tests the included machining operation",
        due_date_consideration: "Review before the planning meeting",
        dependency_local_keys: [],
        owner_selected: true,
      },
    ],
  },
};

describe("S30 investigation-planning context resolver", () => {
  it("resolves a frozen authoritative S30 context with accepted scope and risk", async () => {
    const result = await setup().resolver.resolve(invocation());

    expect(result?.authoritative).toMatchObject({
      trust: "authoritative_server_context",
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: VERSION,
      record_version: 2,
      workflow_state: "S30",
      actor: USER,
      intake_scope: {
        initiating_event: "Thread-depth nonconformance",
        organization_reference: "ORG-001",
      },
    });
    expect(result?.authoritative.accepted_scope.source_reference).toBe(
      "NCR-2026-0042",
    );
    expect(result?.authoritative.accepted_containment_risk).toEqual(validRisk());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.authoritative)).toBe(true);
    expect(Object.isFrozen(result?.authoritative.active_roles)).toBe(true);
    expect(Object.isFrozen(result?.authoritative.accepted_scope)).toBe(true);
    expect(Object.isFrozen(result?.authoritative.accepted_containment_risk)).toBe(
      true,
    );
  });

  it("requires S30, the current version, and exact tenant/case/section binding", async () => {
    expect(
      await setup({ capaCase: { organization_id: "other-org" } }).resolver.resolve(
        invocation(),
      ),
    ).toBeNull();
    expect(
      await setup().resolver.resolve(
        invocation({ capa_case_id: "other-case" }),
      ),
    ).toBeNull();
    expect(
      await setup({ capaCase: { status: "S20" } }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await setup({ version: { status: "S20" } }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await setup({ version: { version_number: 3 } }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await (() => {
        const mismatchedTenant = setup();
        mismatchedTenant.tenant.organization_id = "other-org";
        return mismatchedTenant.resolver.resolve(invocation());
      })(),
    ).toBeNull();

    const wrongSectionId = setup();
    wrongSectionId.repository.findSectionVersionById.mockImplementation(
      async (_organizationId: any, _caseId: any, sectionVersionId: any) => {
        const section = makeSections().find((candidate: any) =>
          candidate.section_version_id === sectionVersionId,
        );
        return section?.section_version_id === INTAKE
          ? { ...section, section_version_id: "80000000-0000-4000-8000-000000000001" }
          : section ?? null;
      },
    );
    expect(
      await wrongSectionId.resolver.resolve(invocation()),
    ).toBeNull();

    const wrongSectionOrganization = setup();
    wrongSectionOrganization.repository.findSectionVersionById.mockImplementation(
      async (_organizationId: any, _caseId: any, sectionVersionId: any) => {
        const section = makeSections().find((candidate: any) =>
          candidate.section_version_id === sectionVersionId,
        );
        return section?.section_version_id === INTAKE
          ? { ...section, organization_id: "other-org" }
          : section ?? null;
      },
    );
    expect(
      await wrongSectionOrganization.resolver.resolve(invocation()),
    ).toBeNull();

    const wrongSectionCase = setup();
    wrongSectionCase.repository.findSectionVersionById.mockImplementation(
      async (_organizationId: any, _caseId: any, sectionVersionId: any) => {
        const section = makeSections().find((candidate: any) =>
          candidate.section_version_id === sectionVersionId,
        );
        return section?.section_version_id === INTAKE
          ? { ...section, capa_case_id: "other-case" }
          : section ?? null;
      },
    );
    expect(
      await wrongSectionCase.resolver.resolve(invocation()),
    ).toBeNull();
  });

  it("accepts immutable section versions carried into a newer S30 case version", async () => {
    const sections = makeSections().map((section) => ({
      ...section,
      version_number: 1,
    }));
    const result = await setup({
      sections,
      capaCase: { record_version: 4 },
      version: { version_number: 4 },
    }).resolver.resolve(invocation());

    expect(result?.authoritative).toMatchObject({
      record_version: 4,
      workflow_state: "S30",
    });
  });

  it("fails closed for missing, duplicate, or malformed authoritative sections", async () => {
    expect(await setup({ sections: [] }).resolver.resolve(invocation())).toBeNull();

    const sections = makeSections();
    expect(
      await setup({
        sections: [
          ...sections,
          makeSection("80000000-0000-4000-8000-000000000001", "CAPA.SCOPE", "capa-scope-1.1.0", validScope()),
        ],
      }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await setup({
        sections: [sections[0], sections[1]],
      }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await setup({
        sections: [
          makeSection(INTAKE, "CAPA.INTAKE", "intake-1.0.0", {
            initiating_event: "event",
            source: { source_type: "NCR" },
            organization_reference: "ORG-001",
          }),
          sections[1],
          sections[2],
        ],
      }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await setup({
        sections: [sections[0], { ...sections[1], content: {} }, sections[2]],
      }).resolver.resolve(invocation()),
    ).toBeNull();
    expect(
      await setup({
        sections: [sections[0], sections[1], { ...sections[2], content: {} }],
      }).resolver.resolve(invocation()),
    ).toBeNull();
  });

  it("uses trusted active roles and separates the untrusted draft without internal IDs", async () => {
    const result = await setup().resolver.resolve(
      invocation({ untrusted_human_draft: validDraft }),
    );

    expect(result?.untrusted_human_draft).toMatchObject({
      trust: "untrusted_human_draft",
      content: { items: [{ local_key: "D1", owner_selected: true }] },
    });
    expect(result?.untrusted_human_draft).not.toHaveProperty(
      "content.items[0].owner_user_id",
    );
    expect(result?.untrusted_human_draft).not.toHaveProperty(
      "content.items[0].item_id",
    );
    expect(result?.authoritative).not.toHaveProperty("owner_user_id");
    expect(Object.isFrozen(result?.untrusted_human_draft)).toBe(true);

    const noActiveRole = setup();
    noActiveRole.tenant.role_assignments = [
      {
        role_assignment_id: "future",
        role_id: "CAPA_OWNER",
        scope: "ORGANIZATION",
        effective_at: "2030-01-01T00:00:00.000Z",
      },
    ];
    expect(await noActiveRole.resolver.resolve(invocation())).toBeNull();

    expect(
      await setup({
        authentication: { principal: { principal_type: "service" } },
      }).resolver.resolve(invocation()),
    ).toBeNull();
  });

  it("fails closed for malformed untrusted drafts", async () => {
    expect(
      await setup().resolver.resolve(
        invocation({
          untrusted_human_draft: {
            ...validDraft,
            content: { items: [{ ...validDraft.content.items[0], owner_user_id: USER }] },
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("S30 investigation-planning stale-state assertion", () => {
  it("returns true only while the authoritative case and version are unchanged", async () => {
    const current = setup();
    const resolved = await current.resolver.resolve(invocation());
    expect(await current.resolver.assertCaseUnchanged(resolved!.authoritative)).toBe(
      true,
    );

    for (const change of [
      { record_version: 3 },
      { current_version_id: "80000000-0000-4000-8000-000000000001" },
      { status: "S40" },
    ]) {
      const changed = setup();
      const context = (await changed.resolver.resolve(invocation()))!.authoritative;
      changed.repository.findCaseById.mockResolvedValue({
        organization_id: ORG,
        capa_case_id: CASE,
        current_version_id: VERSION,
        status: "S30",
        record_version: 2,
        ...change,
      });
      expect(await changed.resolver.assertCaseUnchanged(context)).toBe(false);
    }
  });

  it("returns false when the current version cannot be read or changes", async () => {
    const missingVersion = setup();
    const context = (await missingVersion.resolver.resolve(invocation()))!.authoritative;
    missingVersion.repository.findCaseVersionById.mockResolvedValue(null);
    expect(await missingVersion.resolver.assertCaseUnchanged(context)).toBe(false);

    const changedVersion = setup();
    const changedContext = (await changedVersion.resolver.resolve(invocation()))!.authoritative;
    changedVersion.repository.findCaseVersionById.mockResolvedValue({
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: VERSION,
      status: "S30",
      version_number: 3,
    });
    expect(await changedVersion.resolver.assertCaseUnchanged(changedContext)).toBe(
      false,
    );
  });
});
