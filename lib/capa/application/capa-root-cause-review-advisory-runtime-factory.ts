import type { IsoDateTime } from "../domain/capa-types";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { CapaAgentActivationService } from "../ai/capa-agent-activation-service";
import { createActivationBackedCapaRootCauseReviewAdvisoryAgentGate } from "../ai/capa-root-cause-review-advisory-agent-gate";
import {
  CapaRootCauseReviewAdvisoryModelGenerator,
  type CapaRootCauseReviewAdvisoryStructuredModelClient,
} from "../ai/capa-root-cause-review-advisory-model-generator";
import { CapaRootCauseReviewAdvisoryService } from "../ai/capa-root-cause-review-advisory-service";
import { RepositoryCapaRootCauseReviewAdvisoryContextResolver } from "../ai/repository-capa-root-cause-review-advisory-context-resolver";
import { PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer } from "../authorization/capa-root-cause-review-advisory-authorizer";
import type { CapaRootCauseReviewAdvisoryOutputRepository } from "../../database/repositories/capa-root-cause-review-advisory-output-repository";
import type { CapaAiOutputId, CapaAiRunId, CapaPromptPackageId } from "../ai/capa-prompt-contract";

export interface CapaRootCauseReviewAdvisoryRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly agent_activation_service: CapaAgentActivationService;
  readonly structured_model_client: CapaRootCauseReviewAdvisoryStructuredModelClient;
  readonly output_repository: CapaRootCauseReviewAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
}

function trustedIsoNow(now: () => Date): IsoDateTime {
  const value = now();
  if (!Number.isFinite(value.getTime())) throw new Error("CONTROLLED_CLOCK_INVALID");
  return value.toISOString() as IsoDateTime;
}

export function createRequestScopedCapaRootCauseReviewAdvisoryService(
  dependencies: CapaRootCauseReviewAdvisoryRuntimeFactoryDependencies,
): CapaRootCauseReviewAdvisoryService {
  const resolver = new RepositoryCapaRootCauseReviewAdvisoryContextResolver({
    repository: dependencies.capa_repository,
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    now: dependencies.now,
  });
  const authorizer = new PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer({
    authentication: dependencies.request_context.authentication,
    tenant: dependencies.request_context.tenant,
    policy: dependencies.authorization_policy,
    now: dependencies.now,
  });
  const generator = new CapaRootCauseReviewAdvisoryModelGenerator({
    model_client: dependencies.structured_model_client,
    createRunId: () => dependencies.generate_uuid() as CapaAiRunId,
    createPromptPackageId: () => dependencies.generate_uuid() as CapaPromptPackageId,
    createOutputId: () => dependencies.generate_uuid() as CapaAiOutputId,
    now: () => trustedIsoNow(dependencies.now),
  });

  return new CapaRootCauseReviewAdvisoryService({
    context_resolver: resolver,
    authorizer,
    agent_gate: createActivationBackedCapaRootCauseReviewAdvisoryAgentGate(
      dependencies.agent_activation_service,
    ),
    generator,
    output_repository: dependencies.output_repository,
    transaction_manager: dependencies.transaction_manager,
  });
}
