import type {
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  OrganizationId,
} from "../domain/capa-types";

import type {
  CapaToolAdapter,
  CapaToolDefinition,
  CapaToolExecutionRequest,
} from "./capa-tool-contract";

import type {
  CapaToolAdapterRegistry,
  CapaToolPayloadValidator,
} from "./capa-tool-gateway";

/** Narrow read-only persistence surface required by TOOL-CASE-READ. */
export interface CapaCaseReadRepository {
  findCaseById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaCase | null>;

  findCaseVersionById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    caseVersionId: CapaCaseVersionId,
  ): Promise<CapaCaseVersion | null>;

  findSectionVersionById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sectionVersionId: CapaSectionVersionId,
  ): Promise<CapaSectionVersion | null>;
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);
  return prototype === Object.prototype ||
    prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every(
      (key, index) =>
        key === expected[index],
    );
}

/** Exact v1 payload validation for the initial case-read tool. */
export class CapaCaseReadPayloadValidator
  implements CapaToolPayloadValidator {
  validateInput(
    definition: CapaToolDefinition,
    input: unknown,
  ): boolean {
    return definition.tool_id ===
      "TOOL-CASE-READ" &&
      definition.input_schema_version ===
        "tool-case-read-input-1.0.0" &&
      isPlainRecord(input) &&
      hasExactKeys(input, [
        "include_sections",
      ]) &&
      typeof input.include_sections ===
        "boolean";
  }

  validateOutput(
    definition: CapaToolDefinition,
    output: unknown,
  ): boolean {
    if (
      definition.tool_id !==
        "TOOL-CASE-READ" ||
      definition.output_schema_version !==
        "tool-case-read-output-1.0.0" ||
      !isPlainRecord(output)
    ) {
      return false;
    }

    if (output.status === "not_found") {
      return hasExactKeys(output, [
        "status",
      ]);
    }

    return output.status === "found" &&
      hasExactKeys(output, [
        "status",
        "capa_case",
        "current_version",
        "section_versions",
      ]) &&
      isPlainRecord(output.capa_case) &&
      isPlainRecord(output.current_version) &&
      Array.isArray(
        output.section_versions,
      ) &&
      output.section_versions.every(
        isPlainRecord,
      );
  }
}

/** Tenant-scoped, read-only exact-version CAPA case adapter. */
export class CapaCaseReadToolAdapter
  implements CapaToolAdapter {
  readonly tool_id =
    "TOOL-CASE-READ" as const;
  readonly tool_version =
    "tool-case-read-1.0.0" as never;

  constructor(
    private readonly repository:
      CapaCaseReadRepository,
  ) {}

  async execute(
    request: CapaToolExecutionRequest,
  ): Promise<
    Readonly<Record<string, unknown>>
  > {
    if (
      request.capa_case_id === undefined ||
      request.organization_id !==
        request.resource_organization_id ||
      !isPlainRecord(request.input) ||
      typeof request.input
        .include_sections !== "boolean"
    ) {
      throw new Error(
        "Invalid controlled CAPA case-read request.",
      );
    }

    const organizationId =
      request.organization_id;
    const capaCaseId =
      request.capa_case_id;
    const capaCase =
      await this.repository.findCaseById(
        organizationId,
        capaCaseId,
      );

    if (capaCase === null) {
      return Object.freeze({
        status: "not_found",
      });
    }

    if (
      capaCase.organization_id !==
        organizationId ||
      capaCase.capa_case_id !== capaCaseId
    ) {
      throw new Error(
        "Repository returned an invalid CAPA tenant scope.",
      );
    }

    const currentVersion =
      await this.repository
        .findCaseVersionById(
          organizationId,
          capaCaseId,
          capaCase.current_version_id,
        );

    if (currentVersion === null) {
      return Object.freeze({
        status: "not_found",
      });
    }

    if (
      currentVersion.organization_id !==
        organizationId ||
      currentVersion.capa_case_id !==
        capaCaseId ||
      currentVersion.case_version_id !==
        capaCase.current_version_id
    ) {
      throw new Error(
        "Repository returned an invalid CAPA current version.",
      );
    }

    const sectionVersions:
      CapaSectionVersion[] = [];

    if (request.input.include_sections) {
      for (
        const sectionVersionId
        of currentVersion
          .section_version_ids
      ) {
        const section =
          await this.repository
            .findSectionVersionById(
              organizationId,
              capaCaseId,
              sectionVersionId,
            );

        if (section === null) {
          return Object.freeze({
            status: "not_found",
          });
        }

        if (
          section.organization_id !==
            organizationId ||
          section.capa_case_id !==
            capaCaseId ||
          section.section_version_id !==
            sectionVersionId
        ) {
          throw new Error(
            "Repository returned an invalid CAPA section version.",
          );
        }

        sectionVersions.push(section);
      }
    }

    return Object.freeze({
      status: "found",
      capa_case: capaCase,
      current_version: currentVersion,
      section_versions:
        Object.freeze(sectionVersions),
    });
  }
}

/** Exact-version adapter registry containing only the approved case reader. */
export function createInitialCapaToolAdapterRegistry(
  repository: CapaCaseReadRepository,
): CapaToolAdapterRegistry {
  const caseReader =
    new CapaCaseReadToolAdapter(
      repository,
    );

  return Object.freeze({
    findExact(
      toolId: CapaToolDefinition["tool_id"],
      toolVersion: string,
    ) {
      return toolId === caseReader.tool_id &&
        toolVersion ===
          caseReader.tool_version
        ? caseReader
        : null;
    },
  });
}
