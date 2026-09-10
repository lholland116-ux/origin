/** Vendor-neutral source and provenance vocabulary for S80 evidence. */

export const CAPA_IMPLEMENTATION_PROVENANCE_ORIGIN_KINDS = [
  "human_observation",
  "lvtchat_record",
  "uploaded_artifact",
  "external_system",
  "controlled_document",
  "other",
] as const;

export type CapaImplementationProvenanceOriginKind =
  (typeof CAPA_IMPLEMENTATION_PROVENANCE_ORIGIN_KINDS)[number];

export const CAPA_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KINDS = [
  "lvtchat",
  "qms",
  "erp",
  "mes",
  "plm",
  "lms",
  "lims",
  "supplier_system",
  "other",
] as const;

export type CapaImplementationProvenanceSourceSystemKind =
  (typeof CAPA_IMPLEMENTATION_PROVENANCE_SOURCE_SYSTEM_KINDS)[number];

/**
 * Describes where an evidence assertion came from without naming a vendor
 * or trusting client-owned actor/timestamp metadata.
 */
export interface CapaImplementationEvidenceSource {
  readonly origin_kind: CapaImplementationProvenanceOriginKind;
  readonly source_system_kind:
    CapaImplementationProvenanceSourceSystemKind;
  readonly source_system_name: string | null;
  readonly source_record_reference: string | null;
  readonly source_record_version: string | number | null;
  readonly artifact_reference: string | null;
}

export const CAPA_IMPLEMENTATION_PROVENANCE_FIELDS = [
  "origin_kind",
  "source_system_kind",
  "source_system_name",
  "source_record_reference",
  "source_record_version",
  "artifact_reference",
] as const;
