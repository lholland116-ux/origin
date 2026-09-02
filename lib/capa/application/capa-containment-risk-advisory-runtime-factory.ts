import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { CapaContainmentRiskAdvisoryOutputRepository } from "../../database/repositories/capa-containment-risk-advisory-output-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import { PolicyBackedCapaContainmentRiskAdvisoryAuthorizer } from "../authorization/capa-containment-risk-advisory-authorizer";
import type { CapaAgentActivationService } from "../ai/capa-agent-activation-service";
import { createActivationBackedCapaContainmentRiskAdvisoryAgentGate } from "../ai/capa-containment-risk-advisory-agent-gate";
import { CapaContainmentRiskAdvisoryModelGenerator, type CapaContainmentRiskAdvisoryStructuredModelClient } from "../ai/capa-containment-risk-advisory-model-generator";
import { CapaContainmentRiskAdvisoryService } from "../ai/capa-containment-risk-advisory-service";
import { RepositoryCapaContainmentRiskAdvisoryContextResolver } from "../ai/repository-capa-containment-risk-advisory-context-resolver";
import type { CapaAiOutputId, CapaAiRunId, CapaPromptPackageId } from "../ai/capa-prompt-contract";
import type { IsoDateTime } from "../domain/capa-types";
import type { CapaCaseId, OrganizationId } from "../domain/capa-types";
import type { CapaContainmentRiskAdvisoryUntrustedHumanDraft } from "../ai/capa-containment-risk-advisory-contract";

export interface CapaContainmentRiskAdvisoryRuntimeFactoryDependencies {
  readonly capa_repository: CapaRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly agent_activation_service: CapaAgentActivationService;
  readonly structured_model_client: CapaContainmentRiskAdvisoryStructuredModelClient;
  readonly output_repository: CapaContainmentRiskAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
  readonly intake_section_type: string;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
}

function trustedIsoNow(now: () => Date): IsoDateTime {
  const current = now();
  if (!Number.isFinite(current.getTime())) throw new Error("CONTROLLED_CLOCK_INVALID");
  return current.toISOString() as IsoDateTime;
}

export function createRequestScopedCapaContainmentRiskAdvisoryService(
  request_context: CapaRequestContext,
  dependencies: CapaContainmentRiskAdvisoryRuntimeFactoryDependencies,
): CapaContainmentRiskAdvisoryService {
  const contextResolver = new RepositoryCapaContainmentRiskAdvisoryContextResolver({ repository: dependencies.capa_repository, authentication: request_context.authentication, tenant: request_context.tenant, intake_section_type: dependencies.intake_section_type, now: dependencies.now });
  const authorizer = new PolicyBackedCapaContainmentRiskAdvisoryAuthorizer({ authentication: request_context.authentication, tenant: request_context.tenant, policy: dependencies.authorization_policy, now: dependencies.now });
  const generator = new CapaContainmentRiskAdvisoryModelGenerator({
    model_client: dependencies.structured_model_client,
    createRunId: () => dependencies.generate_uuid() as CapaAiRunId,
    createPromptPackageId: () => dependencies.generate_uuid() as CapaPromptPackageId,
    createOutputId: () => dependencies.generate_uuid() as CapaAiOutputId,
    now: () => trustedIsoNow(dependencies.now),
  });
  return new CapaContainmentRiskAdvisoryService({
    context_resolver: {
      resolve: (input) => contextResolver.resolve({ organization_id: input.organization_id as OrganizationId, capa_case_id: input.capa_case_id as CapaCaseId, ...(input.untrusted_human_draft === null ? {} : { untrusted_human_draft: input.untrusted_human_draft as CapaContainmentRiskAdvisoryUntrustedHumanDraft }) }),
      assertCaseUnchanged: (context) => contextResolver.assertCaseUnchanged(context),
    },
    authorizer,
    agent_gate: createActivationBackedCapaContainmentRiskAdvisoryAgentGate(dependencies.agent_activation_service),
    generator,
    output_repository: dependencies.output_repository,
    transaction_manager: dependencies.transaction_manager,
  });
}
