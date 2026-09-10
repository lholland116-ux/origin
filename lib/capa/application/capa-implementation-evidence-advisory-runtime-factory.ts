import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import type { CapaAgentActivationService } from "../ai/capa-agent-activation-service";
import { createActivationBackedCapaImplementationEvidenceAdvisoryAgentGate } from "../ai/capa-implementation-evidence-advisory-agent-gate";
import { PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer } from "../ai/capa-implementation-evidence-advisory-authorizer";
import { RepositoryCapaImplementationEvidenceAdvisoryContextResolver } from "../ai/capa-implementation-evidence-advisory-context";
import { CapaImplementationEvidenceAdvisoryModelGenerator, type CapaImplementationEvidenceAdvisoryGenerationTraceCapture, type CapaImplementationEvidenceAdvisoryStructuredModelClient } from "../ai/capa-implementation-evidence-advisory-model-generator";
import { CapaImplementationEvidenceAdvisoryService, type CapaImplementationEvidenceAdvisoryServiceDependencies } from "../ai/capa-implementation-evidence-advisory-service";
import type { CapaImplementationWorkspaceService } from "./capa-implementation-workspace-service";
import type { CapaImplementationEvidenceAdvisoryKnowledgeProvider } from "../ai/capa-implementation-evidence-advisory-context";
import type { CapaImplementationEvidenceAdvisoryOutputRepository } from "../../database/repositories/capa-implementation-evidence-advisory-output-repository";
import type { TransactionManager } from "../../database/transactions";
import { CapaImplementationEvidenceAdvisoryAdoptionService, type CapaImplementationEvidenceAdvisoryAdoptionDependencies } from "../ai/capa-implementation-evidence-advisory-adoption-service";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { AuditEventId } from "../domain/capa-types";

export interface CapaImplementationEvidenceAdvisoryRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly workspace_service: CapaImplementationWorkspaceService;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly agent_activation_service: CapaAgentActivationService;
  readonly structured_model_client: CapaImplementationEvidenceAdvisoryStructuredModelClient;
  readonly output_repository: CapaImplementationEvidenceAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
  readonly knowledge_provider?: CapaImplementationEvidenceAdvisoryKnowledgeProvider;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
}

export function createRequestScopedCapaImplementationEvidenceAdvisoryService(dependencies: CapaImplementationEvidenceAdvisoryRuntimeFactoryDependencies): CapaImplementationEvidenceAdvisoryService {
  const resolver = new RepositoryCapaImplementationEvidenceAdvisoryContextResolver({ workspace_service: dependencies.workspace_service, authentication: dependencies.request_context.authentication, tenant: dependencies.request_context.tenant, now: dependencies.now, knowledge_provider: dependencies.knowledge_provider });
  const generator = new CapaImplementationEvidenceAdvisoryModelGenerator({ model_client: dependencies.structured_model_client, createRunId: () => dependencies.generate_uuid() as never, createPromptPackageId: () => dependencies.generate_uuid() as never, createOutputId: () => dependencies.generate_uuid() as never, now: () => dependencies.now().toISOString() as never });
  const serviceDependencies: CapaImplementationEvidenceAdvisoryServiceDependencies = { context_resolver: resolver, authorizer: new PolicyBackedCapaImplementationEvidenceAdvisoryAuthorizer(dependencies.request_context, dependencies.authorization_policy, dependencies.now), agent_gate: createActivationBackedCapaImplementationEvidenceAdvisoryAgentGate(dependencies.agent_activation_service), generator, output_repository: dependencies.output_repository, transaction_manager: dependencies.transaction_manager };
  return new CapaImplementationEvidenceAdvisoryService(serviceDependencies);
}

export interface CapaImplementationEvidenceAdvisoryAdoptionRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly workspace_service: CapaImplementationWorkspaceService;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly output_repository: CapaImplementationEvidenceAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
  readonly audit_repository?: AuditRepository;
  readonly audit_schema_version?: string;
  readonly now: () => Date;
  readonly generate_audit_event_id: () => AuditEventId;
}

export function createRequestScopedCapaImplementationEvidenceAdvisoryAdoptionService(dependencies: CapaImplementationEvidenceAdvisoryAdoptionRuntimeFactoryDependencies): CapaImplementationEvidenceAdvisoryAdoptionService {
  const adoptionDependencies: CapaImplementationEvidenceAdvisoryAdoptionDependencies = { request_context: dependencies.request_context, authorization_policy: dependencies.authorization_policy, output_repository: dependencies.output_repository, workspace_service: dependencies.workspace_service, transaction_manager: dependencies.transaction_manager, audit_repository: dependencies.audit_repository, audit_schema_version: dependencies.audit_schema_version, now: dependencies.now, generate_audit_event_id: dependencies.generate_audit_event_id };
  return new CapaImplementationEvidenceAdvisoryAdoptionService(adoptionDependencies);
}
