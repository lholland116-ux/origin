import type { CapaActionPlanAdvisoryResponse } from "../../capa/ai/capa-action-plan-advisory-contract";
import type { CapaActionPlanAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS60ActionPlanContext, CapaActionPlanAdvisoryReferenceManifestEntry } from "../../capa/ai/capa-action-plan-advisory-context";
import type { CorrelationId, RequestId } from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";
export type CapaActionPlanAdvisoryOutputSaveResult = "saved" | "case_changed";

export interface CapaActionPlanAdvisoryReferenceManifest { readonly document: Readonly<{ readonly manifest_schema_version: "capa-action-plan-advisory-reference-manifest-1.0.0"; readonly entries: readonly CapaActionPlanAdvisoryReferenceManifestEntry[] }>; readonly fingerprint_algorithm: "sha256-canonical-json-v1"; readonly reference_manifest_sha256: string; }
export interface CapaActionPlanAdvisoryOutputRepository { save(transaction: TransactionContext, input: { readonly context: AuthoritativeS60ActionPlanContext; readonly response: CapaActionPlanAdvisoryResponse; readonly generation_trace: CapaActionPlanAdvisoryGenerationTraceCapture; readonly reference_manifest: readonly CapaActionPlanAdvisoryReferenceManifestEntry[]; readonly request_id: RequestId; readonly correlation_id: CorrelationId }): Promise<"saved" | "case_changed">; findById(organizationId: string, outputId: string): Promise<CapaActionPlanAdvisoryOutputRecord | null>; }
export interface CapaActionPlanAdvisoryOutputRecord { readonly organization_id: string; readonly capa_case_id: string; readonly case_version_id: string; readonly record_version: number; readonly request_trace: Readonly<{ request_id: RequestId; correlation_id: CorrelationId }>; readonly response: CapaActionPlanAdvisoryResponse; readonly generation_trace: CapaActionPlanAdvisoryGenerationTraceCapture; readonly reference_manifest: CapaActionPlanAdvisoryReferenceManifest; }
