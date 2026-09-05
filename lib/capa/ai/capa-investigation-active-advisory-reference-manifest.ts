import {
  fingerprintCanonicalJson,
} from "./capa-ai-generation-trace";
import type {
  CapaInvestigationActiveAdvisoryContextAssembly,
  CapaInvestigationActiveAdvisoryModelSafeContext,
  CapaInvestigationActiveAdvisoryReferenceManifestEntry,
  CapaInvestigationActiveAdvisoryReferenceSourceKind,
  CapaInvestigationActiveAdvisoryReferenceTrust,
} from "./capa-investigation-active-advisory-context";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES,
} from "./repository-capa-investigation-active-advisory-context-resolver";

export const CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION =
  "capa-investigation-active-reference-manifest-1.0.0" as const;
export const CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM =
  "sha256-canonical-json-v1" as const;

export interface CapaInvestigationActiveAdvisoryReferenceManifestDocument {
  readonly manifest_schema_version:
    typeof CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION;
  readonly workflow_state: "S40";
  readonly entries:
    readonly CapaInvestigationActiveAdvisoryReferenceManifestEntry[];
}

export class CapaInvestigationActiveAdvisoryReferenceManifestError extends Error {
  constructor() {
    super("The controlled S40 advisory reference manifest is invalid.");
    this.name = "CapaInvestigationActiveAdvisoryReferenceManifestError";
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

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

function validTrust(value: unknown): value is CapaInvestigationActiveAdvisoryReferenceTrust {
  return value === "authoritative_server_context" || value === "untrusted_human_draft";
}

function validSourceKind(value: unknown): value is CapaInvestigationActiveAdvisoryReferenceSourceKind {
  return value === "investigation_plan_item" || value === "ledger_item" ||
    value === "causal_hypothesis" || value === "root_cause_not_confirmed";
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
}

export function validateCapaInvestigationActiveAdvisoryModelSafeContext(
  value: unknown,
): CapaInvestigationActiveAdvisoryModelSafeContext {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, [
      "trust",
      "workflow_state",
      "references",
    ])
  ) {
    throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
  }

  const record = value as Record<string, unknown>;
  if (
    record.trust !== "model_safe_context" ||
    record.workflow_state !== "S40" ||
    !Array.isArray(record.references) ||
    record.references.length > CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES
  ) {
    throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
  }

  const seen = new Set<string>();
  for (const reference of record.references) {
    if (
      typeof reference !== "object" || reference === null ||
      Array.isArray(reference)
    ) {
      throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
    }
    const candidate = reference as Record<string, unknown>;
    if (
      !validReferenceKey(candidate.reference_key) ||
      seen.has(candidate.reference_key) ||
      !validTrust(candidate.trust) ||
      !validSourceKind(candidate.source_kind) ||
      Object.prototype.hasOwnProperty.call(candidate, "source_id") ||
      (candidate.trust === "authoritative_server_context" &&
        candidate.source_kind !== "investigation_plan_item") ||
      (candidate.trust === "untrusted_human_draft" &&
        candidate.source_kind === "investigation_plan_item")
    ) {
      throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
    }
    seen.add(candidate.reference_key);
  }

  return value as CapaInvestigationActiveAdvisoryModelSafeContext;
}

export function validateCapaInvestigationActiveAdvisoryReferenceManifest(
  document: unknown,
  modelSafeContext: unknown,
): CapaInvestigationActiveAdvisoryReferenceManifestDocument {
  if (
    typeof document !== "object" || document === null || Array.isArray(document) ||
    (document as Record<string, unknown>).manifest_schema_version !==
      CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION ||
    (document as Record<string, unknown>).workflow_state !== "S40" ||
    !exactKeys(document as Record<string, unknown>, [
      "manifest_schema_version",
      "workflow_state",
      "entries",
    ]) ||
    !Array.isArray((document as Record<string, unknown>).entries)
  ) throw new CapaInvestigationActiveAdvisoryReferenceManifestError();

  const validatedModelSafeContext =
    validateCapaInvestigationActiveAdvisoryModelSafeContext(modelSafeContext);

  const source = (document as Record<string, unknown>).entries as unknown[];
  if (source.length > CAPA_INVESTIGATION_ACTIVE_ADVISORY_MAXIMUM_REFERENCES ||
    source.length !== validatedModelSafeContext.references.length) {
    throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
  }
  const modelReferences = new Map(validatedModelSafeContext.references.map((reference) => [reference.reference_key, reference]));
  const seen = new Set<string>();
  const entries = source.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
    }
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).length !== 4 || !validReferenceKey(record.reference_key) ||
      seen.has(record.reference_key) || !validTrust(record.trust) ||
      !validSourceKind(record.source_kind) || typeof record.source_id !== "string" ||
      record.source_id.trim().length === 0) {
      throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
    }
    const matching = modelReferences.get(record.reference_key as never);
    if (matching === undefined || matching.trust !== record.trust ||
      matching.source_kind !== record.source_kind) {
      throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
    }
    seen.add(record.reference_key);
    return Object.freeze({
      reference_key: record.reference_key as never,
      trust: record.trust,
      source_kind: record.source_kind,
      source_id: record.source_id,
    });
  });
  if (seen.size !== modelReferences.size) throw new CapaInvestigationActiveAdvisoryReferenceManifestError();
  return freeze({
    manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
    workflow_state: "S40" as const,
    entries: Object.freeze(entries),
  });
}

export function createCapaInvestigationActiveAdvisoryReferenceManifest(
  context: Pick<CapaInvestigationActiveAdvisoryContextAssembly, "reference_manifest" | "model_safe_context">,
): Readonly<{
  document: CapaInvestigationActiveAdvisoryReferenceManifestDocument;
  fingerprint_algorithm: typeof CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM;
  reference_manifest_sha256: string;
}> {
  const document = validateCapaInvestigationActiveAdvisoryReferenceManifest({
    manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
    workflow_state: "S40",
    entries: context.reference_manifest,
  }, context.model_safe_context);
  return Object.freeze({
    document,
    fingerprint_algorithm: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
    reference_manifest_sha256: fingerprintCanonicalJson(document),
  });
}
