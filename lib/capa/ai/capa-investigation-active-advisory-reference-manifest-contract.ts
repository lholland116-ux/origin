import type {
  CapaInvestigationActiveAdvisoryReferenceManifestEntry,
} from "./capa-investigation-active-advisory-context";

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES = 100;

export const CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION =
  "capa-investigation-active-reference-manifest-1.0.0" as const;

export const CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM =
  "sha256-canonical-json-v1" as const;

function validReferenceKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^R([1-9][0-9]*)$/.exec(value);
  if (match === null) return false;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) &&
    number >= 1 &&
    number <= CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES;
}

export function isCapaInvestigationActiveAdvisoryReferenceKey(
  value: unknown,
): value is CapaInvestigationActiveAdvisoryReferenceManifestEntry["reference_key"] {
  return validReferenceKey(value);
}
