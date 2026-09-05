import type { IsoDateTime } from "../domain/capa-types";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { CapaAgentActivationService } from "../ai/capa-agent-activation-service";
import { createActivationBackedCapaInvestigationActiveAdvisoryAgentGate } from "../ai/capa-investigation-active-advisory-agent-gate";
import { CapaInvestigationActiveAdvisoryModelGenerator } from "../ai/capa-investigation-active-advisory-model-generator";
import type { CapaInvestigationActiveAdvisoryStructuredModelClient } from "../ai/capa-investigation-active-advisory-model-profile";
import { CapaInvestigationActiveAdvisoryService } from "../ai/capa-investigation-active-advisory-service";
import { RepositoryCapaInvestigationActiveAdvisoryContextResolver } from "../ai/repository-capa-investigation-active-advisory-context-resolver";
import { PolicyBackedCapaInvestigationActiveAdvisoryAuthorizer } from "../authorization/capa-investigation-active-advisory-authorizer";
import type { CapaInvestigationActiveAdvisoryOutputRepository } from "../../database/repositories/capa-investigation-active-advisory-output-repository";
import type { CapaAiOutputId, CapaAiRunId, CapaPromptPackageId } from "../ai/capa-prompt-contract";

export interface CapaInvestigationActiveAdvisoryRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly agent_activation_service: CapaAgentActivationService;
  readonly structured_model_client: CapaInvestigationActiveAdvisoryStructuredModelClient;
  readonly output_repository: CapaInvestigationActiveAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
}
function trustedIsoNow(now: () => Date): IsoDateTime { const value = now(); if (!Number.isFinite(value.getTime())) throw new Error("CONTROLLED_CLOCK_INVALID"); return value.toISOString() as IsoDateTime; }
export function createRequestScopedCapaInvestigationActiveAdvisoryService(dependencies: CapaInvestigationActiveAdvisoryRuntimeFactoryDependencies): CapaInvestigationActiveAdvisoryService {
  const resolver = new RepositoryCapaInvestigationActiveAdvisoryContextResolver({ repository: dependencies.capa_repository, authentication: dependencies.request_context.authentication, tenant: dependencies.request_context.tenant, now: dependencies.now });
  const authorizer = new PolicyBackedCapaInvestigationActiveAdvisoryAuthorizer({ authentication: dependencies.request_context.authentication, tenant: dependencies.request_context.tenant, policy: dependencies.authorization_policy, now: dependencies.now });
  const generator = new CapaInvestigationActiveAdvisoryModelGenerator({ model_client: dependencies.structured_model_client, createRunId: () => dependencies.generate_uuid() as CapaAiRunId, createPromptPackageId: () => dependencies.generate_uuid() as CapaPromptPackageId, createOutputId: () => dependencies.generate_uuid() as CapaAiOutputId, now: () => trustedIsoNow(dependencies.now) });
  return new CapaInvestigationActiveAdvisoryService({ context_resolver: resolver, authorizer, agent_gate: createActivationBackedCapaInvestigationActiveAdvisoryAgentGate(dependencies.agent_activation_service), generator, output_repository: dependencies.output_repository, transaction_manager: dependencies.transaction_manager });
}
