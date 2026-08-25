import type {
  ControlledCode,
} from "../domain/capa-types";

import type {
  CapaRepository,
} from "../../database/repositories/capa-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";

import {
  PolicyBackedCapaIntakeAdvisoryAuthorizer,
} from "../authorization/capa-intake-advisory-authorizer";

import {
  RepositoryCapaIntakeAdvisoryContextResolver,
} from "../ai/repository-capa-intake-advisory-context-resolver";

import {
  ControlledCapaIntakeAdvisoryRetrievalRequestFactory,
  type CapaIntakeAdvisoryRetrievalConfiguration,
} from "../ai/capa-intake-advisory-retrieval-request-factory";

import {
  createGovernedCapaIntakeAdvisoryEvidenceProvider,
} from "../ai/capa-intake-advisory-evidence-provider";

import {
  createCapaIntakeAdvisoryControlledPromptRenderer,
} from "../ai/capa-intake-advisory-controlled-prompt-renderer";

import {
  createCapaIntakeAdvisoryModelGenerator,
  type CapaIntakeAdvisoryStructuredModelClient,
} from "../ai/capa-intake-advisory-model-generator";

import {
  createCapaIntakeAdvisoryService,
  type CapaIntakeAdvisoryOutputRepository,
  type CapaIntakeAdvisoryService,
} from "../ai/capa-intake-advisory-service";

import {
  createActivationBackedCapaIntakeAdvisoryAgentGate,
} from "../ai/capa-intake-advisory-agent-gate";

import type {
  CapaAgentActivationService,
} from "../ai/capa-agent-activation-service";

import type {
  CapaPromptAssemblyService,
} from "../ai/capa-prompt-service";

import type {
  CapaKnowledgeRetrievalService,
} from "../knowledge/capa-knowledge-retrieval-service";

import type {
  CapaAiOutputId,
  CapaAiRunId,
  CapaPromptPackageId,
} from "../ai/capa-prompt-contract";

import type {
  CapaRequestContext,
} from "../../security/supabase-capa-context";

/**
 * Trusted server composition inputs for one request-scoped CAPA intake
 * advisory service.
 *
 * Provider-specific model configuration and persistence remain outside this
 * module. Browser-controlled data must never construct this dependency set.
 */
export interface CapaIntakeAdvisoryRuntimeFactoryDependencies {
  readonly request_context:
    CapaRequestContext;

  readonly capa_repository:
    CapaRepository;

  readonly transaction_manager:
    TransactionManager;

  readonly output_repository:
    CapaIntakeAdvisoryOutputRepository;

  readonly authorization_policy:
    CapaAuthorizationPolicy;

  readonly agent_activation_service:
    CapaAgentActivationService;

  readonly knowledge_retrieval_service:
    CapaKnowledgeRetrievalService;

  readonly prompt_assembly_service:
    CapaPromptAssemblyService;

  readonly structured_model_client:
    CapaIntakeAdvisoryStructuredModelClient;

  readonly retrieval_configuration:
    CapaIntakeAdvisoryRetrievalConfiguration;

  readonly intake_section_type:
    ControlledCode;

  readonly now: () => Date;

  readonly generate_uuid:
    () => string;
}

/**
 * Creates one request-scoped governed CAPA intake advisory service.
 *
 * Authentication and tenant authority are captured from CapaRequestContext
 * for this request only. No request-specific authorization state is retained
 * in a process-shared advisory service.
 */
export function createRequestScopedCapaIntakeAdvisoryService(
  dependencies:
    CapaIntakeAdvisoryRuntimeFactoryDependencies,
): CapaIntakeAdvisoryService {
  const contextResolver =
    new RepositoryCapaIntakeAdvisoryContextResolver({
      repository:
        dependencies.capa_repository,

      authentication:
        dependencies.request_context
          .authentication,

      tenant:
        dependencies.request_context.tenant,

      intake_section_type:
        dependencies.intake_section_type,

      now:
        dependencies.now,
    });

  const authorizer =
    new PolicyBackedCapaIntakeAdvisoryAuthorizer({
      authentication:
        dependencies.request_context
          .authentication,

      tenant:
        dependencies.request_context.tenant,

      policy:
        dependencies.authorization_policy,

      now:
        dependencies.now,
    });

  const retrievalRequestFactory =
    new ControlledCapaIntakeAdvisoryRetrievalRequestFactory({
      configuration:
        dependencies.retrieval_configuration,

      now:
        dependencies.now,

      create_retrieval_run_id:
        dependencies.generate_uuid,

      create_query_id:
        dependencies.generate_uuid,
    });

  const evidenceProvider =
    createGovernedCapaIntakeAdvisoryEvidenceProvider(
      dependencies
        .knowledge_retrieval_service,
      retrievalRequestFactory,
    );

  const promptRenderer =
    createCapaIntakeAdvisoryControlledPromptRenderer({
      configuration:
        dependencies.prompt_assembly_service
          .configuration,

      identity_factory: {
        createPromptPackageId() {
          return dependencies
            .generate_uuid() as
              CapaPromptPackageId;
        },
      },

      clock: {
        now:
          dependencies.now,
      },
    });

  const generator =
    createCapaIntakeAdvisoryModelGenerator({
      prompt_renderer:
        promptRenderer,

      model_client:
        dependencies
          .structured_model_client,

      id_factory: {
        createRunId() {
          return dependencies
            .generate_uuid() as
              CapaAiRunId;
        },

        createOutputId() {
          return dependencies
            .generate_uuid() as
              CapaAiOutputId;
        },
      },
    });

  return createCapaIntakeAdvisoryService({
    context_resolver:
      contextResolver,

    authorizer,

    agent_gate:
      createActivationBackedCapaIntakeAdvisoryAgentGate(
        dependencies
          .agent_activation_service,
      ),

    evidence_provider:
      evidenceProvider,

    generator,

    output_repository:
      dependencies.output_repository,

    transaction_manager:
      dependencies.transaction_manager,

    integrity_guard:
      contextResolver,
  });
}
