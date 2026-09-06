import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { CapaInvestigationActiveAdoptionRepository } from "../../database/repositories/capa-investigation-active-adoption-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaRequestContext } from "../../security/supabase-capa-context";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import { PolicyBackedCapaInvestigationActiveAdoptionAuthorizer } from "../authorization/capa-investigation-active-adoption-authorizer";
import { adoptCapaInvestigationActiveAiProposals, type AdoptCapaInvestigationActiveAiProposalsCommand, type AdoptCapaInvestigationActiveAiProposalsDependencies, type AdoptCapaInvestigationActiveAiProposalsResult, type CapaInvestigationActiveAdoptionIdGenerator } from "./adopt-capa-investigation-active-ai-proposals";
import type { CapaInvestigationActiveAdoptionSourceResolver } from "./capa-investigation-active-adoption-source-resolver";
import type { CapaInvestigationActiveWorkspaceDraftRepository } from "../../database/repositories/capa-investigation-active-workspace-draft-repository";

export type CapaInvestigationActiveAdoptionServiceCommand = AdoptCapaInvestigationActiveAiProposalsCommand;
export interface CapaInvestigationActiveAdoptionService { adopt(command: CapaInvestigationActiveAdoptionServiceCommand): Promise<AdoptCapaInvestigationActiveAiProposalsResult>; }
export interface CapaInvestigationActiveAdoptionRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly transaction_manager: TransactionManager;
  readonly adoption_repository: CapaInvestigationActiveAdoptionRepository;
  readonly audit_repository: AuditRepository;
  readonly source_resolver: CapaInvestigationActiveAdoptionSourceResolver;
  readonly workspace_repository: CapaInvestigationActiveWorkspaceDraftRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly audit_schema_version: string;
}
export function createRequestScopedCapaInvestigationActiveAdoptionService(dependencies: CapaInvestigationActiveAdoptionRuntimeFactoryDependencies): CapaInvestigationActiveAdoptionService {
  const authorizer = new PolicyBackedCapaInvestigationActiveAdoptionAuthorizer({ authentication: dependencies.request_context.authentication, tenant: dependencies.request_context.tenant, policy: dependencies.authorization_policy });
  const ids: CapaInvestigationActiveAdoptionIdGenerator = { generateAdoptionId: () => dependencies.generate_uuid() as never, generateAuditEventId: () => dependencies.generate_uuid() as never };
  const serviceDependencies: AdoptCapaInvestigationActiveAiProposalsDependencies = { tenant: dependencies.request_context.tenant, adopter: { actor_type: "human", actor_id: dependencies.request_context.owner_user_id }, transaction_manager: dependencies.transaction_manager, adoption_repository: dependencies.adoption_repository, audit_repository: dependencies.audit_repository, authorizer, source_resolver: dependencies.source_resolver, workspace_repository: dependencies.workspace_repository, id_generator: ids, clock: { now: dependencies.now }, configuration: { audit_schema_version: dependencies.audit_schema_version } };
  return { adopt(command) { return adoptCapaInvestigationActiveAiProposals(serviceDependencies, command); } };
}
