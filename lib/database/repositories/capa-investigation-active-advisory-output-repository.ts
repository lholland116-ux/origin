import type { CapaInvestigationActiveAdvisoryResponse } from "../../capa/ai/capa-investigation-active-advisory-contract";
import type { CapaInvestigationActiveAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS40InvestigationActiveContext, CapaInvestigationActiveAdvisoryReferenceManifestEntry } from "../../capa/ai/capa-investigation-active-advisory-context";
import type { CorrelationId, RequestId } from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export type CapaInvestigationActiveAdvisoryOutputSaveResult = "saved" | "case_changed";

export type CapaInvestigationActiveAdvisoryPersistedGenerationTrace = Pick<
  CapaInvestigationActiveAdvisoryGenerationTraceCapture,
  | "trace_schema_version"
  | "package"
  | "store"
  | "evidence_manifest"
  | "policy_manifest"
  | "fingerprints"
  | "model_profile_version"
>;

export interface CapaInvestigationActiveAdvisoryOutputRepository {
  save(transaction: TransactionContext, input: {
    readonly context: AuthoritativeS40InvestigationActiveContext;
    readonly response: CapaInvestigationActiveAdvisoryResponse;
    readonly generation_trace: CapaInvestigationActiveAdvisoryGenerationTraceCapture;
    readonly reference_manifest: readonly CapaInvestigationActiveAdvisoryReferenceManifestEntry[];
    readonly request_id: RequestId;
    readonly correlation_id: CorrelationId;
  }): Promise<CapaInvestigationActiveAdvisoryOutputSaveResult>;

  findById(
    organizationId: string,
    outputId: string,
  ): Promise<CapaInvestigationActiveAdvisoryOutputRecord | null>;
}

export interface CapaInvestigationActiveAdvisoryOutputRecord {
  readonly organization_id: string;
  readonly capa_case_id: string;
  readonly case_version_id: string;
  readonly record_version: number;
  readonly response: CapaInvestigationActiveAdvisoryResponse;
  readonly generation_trace: CapaInvestigationActiveAdvisoryPersistedGenerationTrace;
  readonly reference_manifest: ReturnType<typeof import("../../capa/ai/capa-investigation-active-advisory-reference-manifest").createCapaInvestigationActiveAdvisoryReferenceManifest>;
}
