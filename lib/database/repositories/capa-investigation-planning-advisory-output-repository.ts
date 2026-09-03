import type { CapaInvestigationPlanAdvisoryResponse } from "../../capa/ai/capa-investigation-planning-advisory-contract";
import type { CapaInvestigationPlanningAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { AuthoritativeS30InvestigationPlanningContext } from "../../capa/ai/capa-investigation-planning-advisory-context";
import type { CorrelationId, RequestId } from "../../capa/domain/capa-types";
import type { TransactionContext } from "../transactions";

export type CapaInvestigationPlanningAdvisoryOutputSaveResult =
  | "saved"
  | "case_changed";

export interface CapaInvestigationPlanningAdvisoryOutputRepository {
  save(
    transaction: TransactionContext,
    input: {
      readonly context: AuthoritativeS30InvestigationPlanningContext;
      readonly response: CapaInvestigationPlanAdvisoryResponse;
      readonly generation_trace:
        CapaInvestigationPlanningAdvisoryGenerationTraceCapture;
      readonly request_id: RequestId;
      readonly correlation_id: CorrelationId;
    },
  ): Promise<CapaInvestigationPlanningAdvisoryOutputSaveResult>;
}
