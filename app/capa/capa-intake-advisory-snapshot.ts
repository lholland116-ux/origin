const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SNAPSHOT_FIELDS =
  new Set([
    "capa_case_id",
    "case_version_id",
    "record_version",
  ]);

export interface CapaIntakeAdvisorySnapshot {
  readonly capaCaseId:
    string;

  readonly caseVersionId:
    string;

  readonly recordVersion:
    number;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validUuid(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    UUID_PATTERN.test(value)
  );
}

export function parseCapaIntakeAdvisorySnapshot(
  value: unknown,
): CapaIntakeAdvisorySnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const keys =
    Object.keys(value);

  if (
    keys.length !==
      SNAPSHOT_FIELDS.size ||
    keys.some(
      (key) =>
        !SNAPSHOT_FIELDS.has(key),
    )
  ) {
    return null;
  }

  if (
    !validUuid(
      value.capa_case_id,
    ) ||
    !validUuid(
      value.case_version_id,
    ) ||
    !Number.isSafeInteger(
      value.record_version,
    ) ||
    typeof value.record_version !==
      "number" ||
    value.record_version < 1
  ) {
    return null;
  }

  return Object.freeze({
    capaCaseId:
      value.capa_case_id,

    caseVersionId:
      value.case_version_id,

    recordVersion:
      value.record_version,
  });
}
