export interface CapaExistingCaseSummary {
  readonly capaCaseId: string;
  readonly caseNumber: string;
  readonly status: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly sectionVersionId: string;
  readonly createdAt: string;
  readonly initiatingEvent: string;
  readonly sourceType: string;
  readonly sourceReference?: string;
  readonly organizationReference?: string;
  readonly correlationId: string;
  readonly retrievalVerified: boolean;
}

export interface ParseCapaExistingCaseOptions {
  readonly expectedCaseId: string;
  readonly fallbackCorrelationId: string;
}

function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Parses the authoritative tenant-scoped CAPA GET response used when a
 * human explicitly opens an existing CAPA from the workspace.
 *
 * Browser list-row data is never sufficient to construct the controlled
 * case view. The full server representation must match the selected case
 * and contain a valid current intake section.
 */
export function parseCapaExistingCaseResponse(
  value: unknown,
  options: ParseCapaExistingCaseOptions,
): CapaExistingCaseSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const capa = value.capa;

  if (!isRecord(capa)) {
    return null;
  }

  if (
    capa.capa_case_id !==
      options.expectedCaseId ||
    typeof capa.case_number !== "string" ||
    typeof capa.status !== "string" ||
    typeof capa.record_version !== "number" ||
    !Number.isInteger(
      capa.record_version,
    ) ||
    capa.record_version < 1 ||
    typeof capa.current_version_id !==
      "string" ||
    typeof capa.created_at !== "string" ||
    !Array.isArray(capa.sections)
  ) {
    return null;
  }

  const intakeSection =
    capa.sections.find(
      (candidate) => {
        if (!isRecord(candidate)) {
          return false;
        }

        const content =
          candidate.content;

        return (
          typeof candidate
            .section_version_id ===
            "string" &&
          isRecord(content) &&
          typeof content
            .initiating_event ===
            "string"
        );
      },
    );

  if (!isRecord(intakeSection)) {
    return null;
  }

  const sectionVersionId =
    intakeSection.section_version_id;

  if (
    typeof sectionVersionId !==
      "string"
  ) {
    return null;
  }

  const content =
    intakeSection.content;

  if (!isRecord(content)) {
    return null;
  }

  const initiatingEvent =
    content.initiating_event;

  if (
    typeof initiatingEvent !==
      "string"
  ) {
    return null;
  }

  const source =
    content.source;

  if (
    !isRecord(source) ||
    typeof source.source_type !==
      "string"
  ) {
    return null;
  }

  const sourceReference =
    source.source_reference;

  if (
    sourceReference !== undefined &&
    typeof sourceReference !== "string"
  ) {
    return null;
  }

  const organizationReference =
    content.organization_reference;

  if (
    organizationReference !==
      undefined &&
    typeof organizationReference !==
      "string"
  ) {
    return null;
  }

  const correlationId =
    typeof value.correlation_id ===
      "string"
      ? value.correlation_id
      : options.fallbackCorrelationId;

  return Object.freeze({
    capaCaseId:
      capa.capa_case_id,
    caseNumber:
      capa.case_number,
    status:
      capa.status,
    recordVersion:
      capa.record_version,
    currentVersionId:
      capa.current_version_id,
    sectionVersionId,
    createdAt:
      capa.created_at,
    initiatingEvent,
    sourceType:
      source.source_type,
    ...(sourceReference === undefined
      ? {}
      : {
          sourceReference,
        }),
    ...(organizationReference ===
    undefined
      ? {}
      : {
          organizationReference,
        }),
    correlationId,
    retrievalVerified: true,
  });
}
