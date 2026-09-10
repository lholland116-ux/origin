import type {
  CapaImplementationEvidenceId,
} from "../domain/capa-types";
import type {
  CapaImplementationEvidenceSource,
} from "./capa-implementation-provenance-contract";

export const CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION =
  "capa-implementation-evidence-1.0.0" as const;

export const CAPA_IMPLEMENTATION_EVIDENCE_KINDS = [
  "controlled_document",
  "training_record",
  "test_or_validation_result",
  "inspection_or_observation",
  "change_control_record",
  "system_record",
  "supplier_record",
  "external_record",
  "other",
] as const;

export type CapaImplementationEvidenceKind =
  (typeof CAPA_IMPLEMENTATION_EVIDENCE_KINDS)[number];

/** S80 records evidence existence; S90 later determines evidence adequacy. */
export interface CapaImplementationEvidence {
  readonly schema_version:
    typeof CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION;
  readonly evidence_id: CapaImplementationEvidenceId;
  readonly approved_action_reference: string;
  readonly evidence_kind: CapaImplementationEvidenceKind;
  readonly description: string;
  /** Domain assertion for when the evidence or activity occurred. */
  readonly evidence_date: string;
  readonly source: CapaImplementationEvidenceSource;
}

export const CAPA_IMPLEMENTATION_EVIDENCE_FIELDS = [
  "schema_version",
  "evidence_id",
  "approved_action_reference",
  "evidence_kind",
  "description",
  "evidence_date",
  "source",
] as const;
