import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  OrganizationId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaToolDefinition,
  CapaToolExecutionRequest,
} from "../../lib/capa/ai/capa-tool-contract";

import {
  CapaCaseReadPayloadValidator,
  CapaCaseReadToolAdapter,
  createInitialCapaToolAdapterRegistry,
  type CapaCaseReadRepository,
} from "../../lib/capa/ai/capa-case-read-tool";

import {
  createInitialCapaToolRegistry,
} from "../../lib/capa/ai/capa-tool-registry";

const ORGANIZATION =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;
const OTHER_ORGANIZATION =
  "660e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;
const CASE_ID =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as
    CapaCaseId;
const VERSION_ID =
  "a65d17e5-4688-4412-aa08-f2832b37f671" as
    CapaCaseVersionId;
const SECTION_ID =
  "779594ce-cb78-4818-a173-4c1e8217637f" as
    CapaSectionVersionId;

function capaCase(
  overrides: Partial<CapaCase> = {},
): CapaCase {
  return {
    organization_id: ORGANIZATION,
    capa_case_id: CASE_ID,
    current_version_id: VERSION_ID,
    status: "S10",
    ...overrides,
  } as CapaCase;
}

function currentVersion(
  overrides: Partial<CapaCaseVersion> = {},
): CapaCaseVersion {
  return {
    organization_id: ORGANIZATION,
    capa_case_id: CASE_ID,
    case_version_id: VERSION_ID,
    status: "S10",
    section_version_ids: [SECTION_ID],
    ...overrides,
  } as CapaCaseVersion;
}

function section(
  overrides: Partial<CapaSectionVersion> = {},
): CapaSectionVersion {
  return {
    organization_id: ORGANIZATION,
    capa_case_id: CASE_ID,
    section_version_id: SECTION_ID,
    content: {
      initiating_event:
        "Seal defects exceeded threshold.",
    },
    ...overrides,
  } as CapaSectionVersion;
}

function repository(
  overrides: Partial<
    CapaCaseReadRepository
  > = {},
): CapaCaseReadRepository {
  return {
    findCaseById:
      vi.fn(async () => capaCase()),
    findCaseVersionById:
      vi.fn(async () =>
        currentVersion()),
    findSectionVersionById:
      vi.fn(async () => section()),
    ...overrides,
  };
}

function request(
  overrides: Partial<
    CapaToolExecutionRequest
  > = {},
): CapaToolExecutionRequest {
  return {
    organization_id: ORGANIZATION,
    resource_organization_id:
      ORGANIZATION,
    capa_case_id: CASE_ID,
    tool_id: "TOOL-CASE-READ",
    tool_version:
      "tool-case-read-1.0.0" as never,
    agent_id: "AG-INTAKE",
    agent_version:
      "ag-intake-1.0.0" as never,
    workflow_state: "S10",
    operation:
      "draft_intake_analysis",
    input_schema_version:
      "tool-case-read-input-1.0.0" as never,
    expected_output_schema_version:
      "tool-case-read-output-1.0.0" as never,
    input_data_class:
      "authorized_case_data",
    input: {
      include_sections: true,
    },
    request_trace: {} as never,
    ...overrides,
  };
}

function definition(): CapaToolDefinition {
  const value =
    createInitialCapaToolRegistry()
      .findExact(
        "TOOL-CASE-READ",
        "tool-case-read-1.0.0",
      );

  if (value === null) {
    throw new Error(
      "Expected case-read definition.",
    );
  }

  return value;
}

describe(
  "CAPA case-read tool adapter",
  () => {
    it(
      "returns the exact current aggregate, version and sections",
      async () => {
        const data = repository();
        const adapter =
          new CapaCaseReadToolAdapter(data);

        const output = await adapter.execute(
          request(),
        );

        expect(output).toEqual({
          status: "found",
          capa_case: capaCase(),
          current_version:
            currentVersion(),
          section_versions: [section()],
        });
        expect(data.findCaseById)
          .toHaveBeenCalledWith(
            ORGANIZATION,
            CASE_ID,
          );
        expect(
          data.findCaseVersionById,
        ).toHaveBeenCalledWith(
          ORGANIZATION,
          CASE_ID,
          VERSION_ID,
        );
        expect(
          data.findSectionVersionById,
        ).toHaveBeenCalledWith(
          ORGANIZATION,
          CASE_ID,
          SECTION_ID,
        );
      },
    );

    it(
      "supports a bounded aggregate read without sections",
      async () => {
        const data = repository();
        const adapter =
          new CapaCaseReadToolAdapter(data);

        const output = await adapter.execute(
          request({
            input: {
              include_sections: false,
            },
          }),
        );

        expect(output).toMatchObject({
          status: "found",
          section_versions: [],
        });
        expect(
          data.findSectionVersionById,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        name: "case",
        overrides: {
          findCaseById:
            vi.fn(async () => null),
        },
      },
      {
        name: "current version",
        overrides: {
          findCaseVersionById:
            vi.fn(async () => null),
        },
      },
      {
        name: "section version",
        overrides: {
          findSectionVersionById:
            vi.fn(async () => null),
        },
      },
    ])(
      "returns tenant-safe not_found for a missing $name",
      async ({ overrides }) => {
        const adapter =
          new CapaCaseReadToolAdapter(
            repository(overrides),
          );

        await expect(
          adapter.execute(request()),
        ).resolves.toEqual({
          status: "not_found",
        });
      },
    );

    it.each([
      {
        name: "missing case identity",
        changes: {
          capa_case_id: undefined,
        },
      },
      {
        name: "tenant mismatch",
        changes: {
          resource_organization_id:
            OTHER_ORGANIZATION,
        },
      },
      {
        name: "malformed input",
        changes: {
          input: {},
        },
      },
    ])(
      "rejects $name before reading",
      async ({ changes }) => {
        const data = repository();
        const adapter =
          new CapaCaseReadToolAdapter(data);

        await expect(
          adapter.execute(
            request(changes),
          ),
        ).rejects.toThrow(
          "Invalid controlled CAPA case-read request.",
        );
        expect(data.findCaseById)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed for a forged repository tenant result",
      async () => {
        const adapter =
          new CapaCaseReadToolAdapter(
            repository({
              findCaseById:
                vi.fn(async () =>
                  capaCase({
                    organization_id:
                      OTHER_ORGANIZATION,
                  })),
            }),
          );

        await expect(
          adapter.execute(request()),
        ).rejects.toThrow(
          "Repository returned an invalid CAPA tenant scope.",
        );
      },
    );

    it(
      "fails closed for a forged current-version relationship",
      async () => {
        const adapter =
          new CapaCaseReadToolAdapter(
            repository({
              findCaseVersionById:
                vi.fn(async () =>
                  currentVersion({
                    capa_case_id:
                      "777e8400-e29b-41d4-a716-446655440000" as
                        CapaCaseId,
                  })),
            }),
          );

        await expect(
          adapter.execute(request()),
        ).rejects.toThrow(
          "Repository returned an invalid CAPA current version.",
        );
      },
    );

    it(
      "fails closed for a forged section relationship",
      async () => {
        const adapter =
          new CapaCaseReadToolAdapter(
            repository({
              findSectionVersionById:
                vi.fn(async () =>
                  section({
                    organization_id:
                      OTHER_ORGANIZATION,
                  })),
            }),
          );

        await expect(
          adapter.execute(request()),
        ).rejects.toThrow(
          "Repository returned an invalid CAPA section version.",
        );
      },
    );

    it(
      "resolves only the exact approved adapter version",
      () => {
        const registry =
          createInitialCapaToolAdapterRegistry(
            repository(),
          );

        expect(
          registry.findExact(
            "TOOL-CASE-READ",
            "tool-case-read-1.0.0",
          ),
        ).toBeInstanceOf(
          CapaCaseReadToolAdapter,
        );
        expect(
          registry.findExact(
            "TOOL-CASE-READ",
            "latest",
          ),
        ).toBeNull();
        expect(
          registry.findExact(
            "TOOL-RETRIEVE",
            "tool-retrieve-1.0.0",
          ),
        ).toBeNull();
      },
    );
  },
);

describe(
  "CAPA case-read payload validation",
  () => {
    const validator =
      new CapaCaseReadPayloadValidator();

    it(
      "accepts an exact null-prototype input record",
      () => {
        const input = Object.assign(
          Object.create(null),
          { include_sections: true },
        );

        expect(
          validator.validateInput(
            definition(),
            input,
          ),
        ).toBe(true);
      },
    );

    it.each([
      { include_sections: true },
      { include_sections: false },
    ])(
      "accepts exact input %j",
      (input) => {
        expect(
          validator.validateInput(
            definition(),
            input,
          ),
        ).toBe(true);
      },
    );

    it.each([
      null,
      {},
      { include_sections: "yes" },
      {
        include_sections: true,
        extra: true,
      },
    ])(
      "rejects malformed input %j",
      (input) => {
        expect(
          validator.validateInput(
            definition(),
            input,
          ),
        ).toBe(false);
      },
    );

    it(
      "accepts exact found and not-found outputs",
      () => {
        expect(
          validator.validateOutput(
            definition(),
            { status: "not_found" },
          ),
        ).toBe(true);
        expect(
          validator.validateOutput(
            definition(),
            {
              status: "found",
              capa_case: capaCase(),
              current_version:
                currentVersion(),
              section_versions: [
                section(),
              ],
            },
          ),
        ).toBe(true);
      },
    );

    it.each([
      null,
      { status: "not_found", extra: true },
      { status: "found" },
      {
        status: "found",
        capa_case: capaCase(),
        current_version:
          currentVersion(),
        section_versions: [null],
      },
    ])(
      "rejects malformed output %j",
      (output) => {
        expect(
          validator.validateOutput(
            definition(),
            output,
          ),
        ).toBe(false);
      },
    );
  },
);
