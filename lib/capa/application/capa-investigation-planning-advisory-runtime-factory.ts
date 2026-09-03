import type { ControlledCode, IsoDateTime } from "../domain/capa-types";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { CapaAgentActivationService } from "../ai/capa-agent-activation-service";
import {
  createActivationBackedCapaInvestigationPlanningAdvisoryAgentGate,
} from "../ai/capa-investigation-planning-advisory-agent-gate";
import {
  CapaInvestigationPlanningAdvisoryModelGenerator,
} from "../ai/capa-investigation-planning-advisory-model-generator";
import type {
  CapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "../ai/capa-investigation-planning-advisory-model-profile";
import {
  CapaInvestigationPlanningAdvisoryService,
} from "../ai/capa-investigation-planning-advisory-service";
import {
  RepositoryCapaInvestigationPlanningAdvisoryContextResolver,
} from "../ai/repository-capa-investigation-planning-advisory-context-resolver";
import {
  PolicyBackedCapaInvestigationPlanningAdvisoryAuthorizer,
} from "../authorization/capa-investigation-planning-advisory-authorizer";
import type {
  CapaInvestigationPlanningAdvisoryOutputRepository,
} from "../../database/repositories/capa-investigation-planning-advisory-output-repository";
import type {
  CapaAiOutputId,
  CapaAiRunId,
  CapaPromptPackageId,
} from "../ai/capa-prompt-contract";

export interface CapaInvestigationPlanningAdvisoryRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly capa_repository: CapaRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly agent_activation_service: CapaAgentActivationService;
  readonly structured_model_client:
    CapaInvestigationPlanningAdvisoryStructuredModelClient;
  readonly output_repository:
    CapaInvestigationPlanningAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
  readonly intake_section_type: ControlledCode;
  readonly intake_schema_version?: string;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
}

function trustedIsoNow(now: () => Date): IsoDateTime {
  const current = now();
  if (!Number.isFinite(current.getTime())) {
    throw new Error("CONTROLLED_CLOCK_INVALID");
  }
  return current.toISOString() as IsoDateTime;
}

export function createRequestScopedCapaInvestigationPlanningAdvisoryService(
  dependencies: CapaInvestigationPlanningAdvisoryRuntimeFactoryDependencies,
): CapaInvestigationPlanningAdvisoryService {
  const contextResolver =
    new RepositoryCapaInvestigationPlanningAdvisoryContextResolver({
      repository: dependencies.capa_repository,
      authentication: dependencies.request_context.authentication,
      tenant: dependencies.request_context.tenant,
      intake_section_type: dependencies.intake_section_type,
      intake_schema_version: dependencies.intake_schema_version,
      now: dependencies.now,
    });

  const authorizer =
    new PolicyBackedCapaInvestigationPlanningAdvisoryAuthorizer({
      authentication: dependencies.request_context.authentication,
      tenant: dependencies.request_context.tenant,
      policy: dependencies.authorization_policy,
      now: dependencies.now,
    });

  const generator = new CapaInvestigationPlanningAdvisoryModelGenerator({
    model_client: dependencies.structured_model_client,
    createRunId: () => dependencies.generate_uuid() as CapaAiRunId,
    createPromptPackageId: () =>
      dependencies.generate_uuid() as CapaPromptPackageId,
    createOutputId: () => dependencies.generate_uuid() as CapaAiOutputId,
    now: () => trustedIsoNow(dependencies.now),
  });

  return new CapaInvestigationPlanningAdvisoryService({
    context_resolver: {
      resolve: (input) => contextResolver.resolve(input),
      assertCaseUnchanged: (context) =>
        contextResolver.assertCaseUnchanged(context),
    },
    authorizer,
    agent_gate:
      createActivationBackedCapaInvestigationPlanningAdvisoryAgentGate(
        dependencies.agent_activation_service,
      ),
    generator,
    output_repository: dependencies.output_repository,
    transaction_manager: dependencies.transaction_manager,
  });
}
