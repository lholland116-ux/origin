import type { CapaContainmentRiskAdvisoryResponse } from "../../capa/ai/capa-containment-risk-advisory-contract";
import type { CapaContainmentRiskAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS20ContainmentRiskContext } from "../../capa/ai/capa-containment-risk-advisory-context";
import type { CorrelationId, RequestId } from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export type CapaContainmentRiskAdvisoryOutputSaveResult = "saved" | "case_changed";

export interface CapaContainmentRiskAdvisoryOutputRepository {
  save(
    transaction: TransactionContext,
    input: {
      readonly context: AuthoritativeS20ContainmentRiskContext;
      readonly response: CapaContainmentRiskAdvisoryResponse;
      readonly generation_trace: CapaContainmentRiskAdvisoryGenerationTraceCapture;
      readonly request_id: RequestId;
      readonly correlation_id: CorrelationId;
    },
  ): Promise<CapaContainmentRiskAdvisoryOutputSaveResult>;
}
