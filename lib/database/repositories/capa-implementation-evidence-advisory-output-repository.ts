import type { TransactionContext } from "../transactions";
import type { CapaImplementationEvidenceAdvisoryContextAssembly, AuthoritativeS80ImplementationEvidenceContext, CapaImplementationEvidenceAdvisoryReferenceManifestEntry } from "../../capa/ai/capa-implementation-evidence-advisory-context";
import type { CapaImplementationEvidenceAdvisoryResponse } from "../../capa/ai/capa-implementation-evidence-advisory-contract";
import type { CapaImplementationEvidenceAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-implementation-evidence-advisory-model-generator";
import type { CorrelationId, RequestId } from "../../capa/domain/capa-types";

export type CapaImplementationEvidenceAdvisoryOutputSaveResult = "saved" | "case_changed";
export interface CapaImplementationEvidenceAdvisoryReferenceManifest { readonly document: Readonly<{ readonly manifest_schema_version: "capa-implementation-evidence-advisory-reference-manifest-1.0.0"; readonly entries: readonly CapaImplementationEvidenceAdvisoryReferenceManifestEntry[] }>; readonly fingerprint_algorithm: "sha256-canonical-json-v1"; readonly reference_manifest_sha256: string; }
export interface CapaImplementationEvidenceAdvisoryOutputRepository {
  save(transaction: TransactionContext, input: { readonly context: AuthoritativeS80ImplementationEvidenceContext; readonly response: CapaImplementationEvidenceAdvisoryResponse; readonly generation_trace: CapaImplementationEvidenceAdvisoryGenerationTraceCapture; readonly reference_manifest: readonly CapaImplementationEvidenceAdvisoryReferenceManifestEntry[]; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<CapaImplementationEvidenceAdvisoryOutputSaveResult>;
  findById(organizationId: string, outputId: string): Promise<CapaImplementationEvidenceAdvisoryOutputRecord | null>;
}
export interface CapaImplementationEvidenceAdvisoryOutputRecord { readonly organization_id: string; readonly capa_case_id: string; readonly case_version_id: string; readonly record_version: number; readonly request_trace: Readonly<{ readonly request_id: RequestId; readonly correlation_id: CorrelationId }>; readonly response: CapaImplementationEvidenceAdvisoryResponse; readonly generation_trace: CapaImplementationEvidenceAdvisoryGenerationTraceCapture; readonly reference_manifest: CapaImplementationEvidenceAdvisoryReferenceManifest; }
