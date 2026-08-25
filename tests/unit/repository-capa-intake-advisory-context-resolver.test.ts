import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  RepositoryCapaIntakeAdvisoryContextResolver,
} from "../../lib/capa/ai/repository-capa-intake-advisory-context-resolver";

const ORG =
  "10000000-0000-4000-8000-000000000001";
const USER =
  "20000000-0000-4000-8000-000000000001";
const CASE =
  "30000000-0000-4000-8000-000000000001";
const VERSION =
  "40000000-0000-4000-8000-000000000001";
const SECTION =
  "50000000-0000-4000-8000-000000000001";

function setup() {
  const capaCase = {
    organization_id: ORG,
    capa_case_id: CASE,
    current_version_id: VERSION,
    status: "S10",
    record_version: 2,
  };
  const caseVersion = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    status: "S10",
    version_number: 2,
    section_version_ids: [SECTION],
  };
  const section = {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: SECTION,
    section_type: "INTAKE",
    content: {
      initiating_event:
        "Controlled production discrepancy.",
      source: {
        source_type:
          "NONCONFORMANCE",
        source_reference: "NCR-1",
      },
      organization_reference:
        "CAPA-LOCAL-1",
    },
  };
  const repository = {
    findCaseById:
      vi.fn().mockResolvedValue(capaCase),
    findCaseVersionById:
      vi.fn().mockResolvedValue(
        caseVersion,
      ),
    findSectionVersionById:
      vi.fn().mockResolvedValue(section),
  };
  const resolver =
    new RepositoryCapaIntakeAdvisoryContextResolver({
      repository,
      authentication: {
        principal: {
          principal_type: "human",
          user_id: USER,
        },
      },
      tenant: {
        organization_id: ORG,
        role_assignments: [
          {
            role_assignment_id:
              "60000000-0000-4000-8000-000000000001",
            role_id: "CAPA_OWNER",
            status: "active",
            scope_code: "ORGANIZATION",
            effective_at:
              "2026-08-25T17:00:00.000Z",
          },
        ],
      },
      intake_section_type: "INTAKE",
      now: () =>
        new Date(
          "2026-08-25T18:00:00.000Z",
        ),
    } as never);

  return {
    resolver,
    repository,
    capaCase,
    caseVersion,
    section,
  };
}

const invocation = {
  organization_id: ORG,
  capa_case_id: CASE,
  user_id: USER,
  request_id: "request-1",
  correlation_id: "correlation-1",
  request: {
    requested_output:
      "intake_analysis",
    focus: null,
  },
} as never;

describe(
  "repository CAPA intake advisory context resolver",
  () => {
    it("resolves only immutable current S10 intake context", async () => {
      const test = setup();
      const result =
        await test.resolver.resolve(
          invocation,
        );

      expect(result).toMatchObject({
        organization_id: ORG,
        capa_case_id: CASE,
        case_version_id: VERSION,
        record_version: 2,
        workflow_state: "S10",
        user_id: USER,
        active_role_ids: ["CAPA_OWNER"],
      });
      expect(
        result?.minimum_case_context,
      ).toEqual([
        expect.objectContaining({
          field_code:
            "intake.initiating_event",
          source_object_id: SECTION,
        }),
        expect.objectContaining({
          field_code: "intake.source",
          source_object_id: SECTION,
        }),
        expect.objectContaining({
          field_code:
            "intake.organization_reference",
          source_object_id: SECTION,
        }),
      ]);
    });

    for (const mismatch of [
      { status: "S00" },
      { organization_id: "other-org" },
      { record_version: 3 },
    ]) {
      it(`fails closed for case mismatch ${Object.keys(mismatch)[0]}`, async () => {
        const test = setup();
        test.repository.findCaseById
          .mockResolvedValue({
            ...test.capaCase,
            ...mismatch,
          });

        await expect(
          test.resolver.resolve(invocation),
        ).resolves.toBeNull();
      });
    }

    it("fails closed when the immutable current version is missing", async () => {
      const test = setup();
      test.repository
        .findCaseVersionById
        .mockResolvedValue(null);

      await expect(
        test.resolver.resolve(invocation),
      ).resolves.toBeNull();
    });

    it("fails closed when intake section identity is ambiguous", async () => {
      const test = setup();
      test.repository
        .findSectionVersionById
        .mockResolvedValue({
          ...test.section,
          section_type: "OTHER",
        });

      await expect(
        test.resolver.resolve(invocation),
      ).resolves.toBeNull();
    });

    it("detects a changed case after model assistance", async () => {
      const test = setup();
      const context =
        await test.resolver.resolve(
          invocation,
        );

      expect(context).not.toBeNull();

      test.repository.findCaseById
        .mockResolvedValue({
          ...test.capaCase,
          record_version: 3,
        });

      await expect(
        test.resolver
          .assertCaseUnchanged(
            context as never,
          ),
      ).resolves.toBe(false);
    });

    it("accepts an unchanged case after advisory generation", async () => {
      const test = setup();
      const context =
        await test.resolver.resolve(
          invocation,
        );

      await expect(
        test.resolver
          .assertCaseUnchanged(
            context as never,
          ),
      ).resolves.toBe(true);
    });
  },
);
