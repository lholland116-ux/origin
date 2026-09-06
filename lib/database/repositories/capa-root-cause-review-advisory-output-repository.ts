import type { CapaRootCauseReviewAdvisoryResponse } from "../../capa/ai/capa-root-cause-review-advisory-contract";
import type { CapaRootCauseReviewAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS50RootCauseReviewContext, CapaRootCauseReviewAdvisoryReferenceManifestEntry } from "../../capa/ai/capa-root-cause-review-advisory-context";
import type { CorrelationId, RequestId } from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export type CapaRootCauseReviewAdvisoryOutputSaveResult = "saved" | "case_changed";

export interface CapaRootCauseReviewAdvisoryReferenceManifest {
  readonly document: Readonly<{
    readonly manifest_schema_version: "capa-root-cause-review-reference-manifest-1.0.0";
    readonly entries: readonly CapaRootCauseReviewAdvisoryReferenceManifestEntry[];
  }>;
  readonly fingerprint_algorithm: "sha256-canonical-json-v1";
  readonly reference_manifest_sha256: string;
}

export interface CapaRootCauseReviewAdvisoryOutputRepository {
  save(transaction: TransactionContext, input: {
    readonly context: AuthoritativeS50RootCauseReviewContext;
    readonly response: CapaRootCauseReviewAdvisoryResponse;
    readonly generation_trace: CapaRootCauseReviewAdvisoryGenerationTraceCapture;
    readonly reference_manifest: readonly CapaRootCauseReviewAdvisoryReferenceManifestEntry[];
    readonly request_id: RequestId;
    readonly correlation_id: CorrelationId;
  }): Promise<CapaRootCauseReviewAdvisoryOutputSaveResult>;
  findById(organizationId: string, outputId: string): Promise<CapaRootCauseReviewAdvisoryOutputRecord | null>;
}

export interface CapaRootCauseReviewAdvisoryOutputRecord {
  readonly organization_id: string;
  readonly capa_case_id: string;
  readonly case_version_id: string;
  readonly record_version: number;
  readonly request_trace: Readonly<{
    readonly request_id: RequestId;
    readonly correlation_id: CorrelationId;
  }>;
  readonly response: CapaRootCauseReviewAdvisoryResponse;
  readonly generation_trace: CapaRootCauseReviewAdvisoryGenerationTraceCapture;
  readonly reference_manifest: CapaRootCauseReviewAdvisoryReferenceManifest;
}
