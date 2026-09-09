import type { IsoDateTime } from "../domain/capa-types";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaActionPlanWorkspaceDraftRepository } from "../../database/repositories/capa-action-plan-workspace-draft-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { CapaAgentActivationService } from "../ai/capa-agent-activation-service";
import { createActivationBackedCapaActionPlanAdvisoryAgentGate } from "../ai/capa-action-plan-advisory-agent-gate";
import { CapaActionPlanAdvisoryModelGenerator, type CapaActionPlanAdvisoryStructuredModelClient } from "../ai/capa-action-plan-advisory-model-generator";
import { CapaActionPlanAdvisoryService } from "../ai/capa-action-plan-advisory-service";
import { RepositoryCapaActionPlanAdvisoryContextResolver } from "../ai/repository-capa-action-plan-advisory-context-resolver";
import { PolicyBackedCapaActionPlanAdvisoryAuthorizer } from "../authorization/capa-action-plan-advisory-authorizer";
import type { CapaActionPlanAdvisoryOutputRepository } from "../../database/repositories/capa-action-plan-advisory-output-repository";
import type { CapaAiOutputId, CapaAiRunId, CapaPromptPackageId } from "../ai/capa-prompt-contract";

export interface CapaActionPlanAdvisoryRuntimeFactoryDependencies { readonly request_context: CapaRequestContext; readonly capa_repository: CapaRepository; readonly workspace_repository: CapaActionPlanWorkspaceDraftRepository; readonly authorization_policy: CapaAuthorizationPolicy; readonly agent_activation_service: CapaAgentActivationService; readonly structured_model_client: CapaActionPlanAdvisoryStructuredModelClient; readonly output_repository: CapaActionPlanAdvisoryOutputRepository; readonly transaction_manager: TransactionManager; readonly now: () => Date; readonly generate_uuid: () => string; }
function trustedIsoNow(now: () => Date): IsoDateTime { const value = now(); if (!Number.isFinite(value.getTime())) throw new Error("CONTROLLED_CLOCK_INVALID"); return value.toISOString() as IsoDateTime; }
export function createRequestScopedCapaActionPlanAdvisoryService(dependencies: CapaActionPlanAdvisoryRuntimeFactoryDependencies): CapaActionPlanAdvisoryService {
  const resolver = new RepositoryCapaActionPlanAdvisoryContextResolver({ repository: dependencies.capa_repository, workspace_repository: dependencies.workspace_repository, authentication: dependencies.request_context.authentication, tenant: dependencies.request_context.tenant, now: dependencies.now });
  const authorizer = new PolicyBackedCapaActionPlanAdvisoryAuthorizer({ authentication: dependencies.request_context.authentication, tenant: dependencies.request_context.tenant, policy: dependencies.authorization_policy, now: dependencies.now });
  const generator = new CapaActionPlanAdvisoryModelGenerator({ model_client: dependencies.structured_model_client, createRunId: () => dependencies.generate_uuid() as CapaAiRunId, createPromptPackageId: () => dependencies.generate_uuid() as CapaPromptPackageId, createOutputId: () => dependencies.generate_uuid() as CapaAiOutputId, now: () => trustedIsoNow(dependencies.now) });
  return new CapaActionPlanAdvisoryService({ context_resolver: resolver, authorizer, agent_gate: createActivationBackedCapaActionPlanAdvisoryAgentGate(dependencies.agent_activation_service), generator, output_repository: dependencies.output_repository, transaction_manager: dependencies.transaction_manager });
}
