import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";
import type {
  CapaInvestigationPlanningAdoptionRepository,
} from "../../database/repositories/capa-investigation-planning-adoption-repository";
import type {
  TransactionManager,
} from "../../database/transactions";
import type {
  CapaRequestContext,
} from "../../security/supabase-capa-context";
import {
  PolicyBackedCapaInvestigationPlanningAdoptionAuthorizer,
} from "../authorization/capa-investigation-planning-adoption-authorizer";
import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";
import {
  adoptCapaInvestigationPlanningAiProposals,
  type AdoptCapaInvestigationPlanningAiProposalsCommand,
  type AdoptCapaInvestigationPlanningAiProposalsDependencies,
  type AdoptCapaInvestigationPlanningAiProposalsResult,
  type CapaInvestigationPlanningAdoptionIdGenerator,
} from "./adopt-capa-investigation-planning-ai-proposals";

export type CapaInvestigationPlanningAdoptionServiceCommand =
  AdoptCapaInvestigationPlanningAiProposalsCommand;

export interface CapaInvestigationPlanningAdoptionService {
  adopt(
    command: CapaInvestigationPlanningAdoptionServiceCommand,
  ): Promise<AdoptCapaInvestigationPlanningAiProposalsResult>;
}

export interface CapaInvestigationPlanningAdoptionRuntimeFactoryDependencies {
  readonly request_context: CapaRequestContext;
  readonly transaction_manager: TransactionManager;
  readonly adoption_repository: CapaInvestigationPlanningAdoptionRepository;
  readonly audit_repository: AuditRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly now: () => Date;
  readonly generate_uuid: () => string;
  readonly audit_schema_version: string;
}

export function createRequestScopedCapaInvestigationPlanningAdoptionService(
  dependencies: CapaInvestigationPlanningAdoptionRuntimeFactoryDependencies,
): CapaInvestigationPlanningAdoptionService {
  const authorizer =
    new PolicyBackedCapaInvestigationPlanningAdoptionAuthorizer({
      authentication: dependencies.request_context.authentication,
      tenant: dependencies.request_context.tenant,
      policy: dependencies.authorization_policy,
    });

  const idGenerator: CapaInvestigationPlanningAdoptionIdGenerator = {
    generateAdoptionId() {
      return dependencies.generate_uuid() as never;
    },
    generateAuditEventId() {
      return dependencies.generate_uuid() as never;
    },
  };

  const serviceDependencies: AdoptCapaInvestigationPlanningAiProposalsDependencies = {
    tenant: dependencies.request_context.tenant,
    adopter: {
      actor_type: "human",
      actor_id: dependencies.request_context.owner_user_id,
    },
    transaction_manager: dependencies.transaction_manager,
    adoption_repository: dependencies.adoption_repository,
    audit_repository: dependencies.audit_repository,
    authorizer,
    id_generator: idGenerator,
    clock: { now: dependencies.now },
    configuration: {
      audit_schema_version: dependencies.audit_schema_version,
    },
  };

  return {
    adopt(command) {
      return adoptCapaInvestigationPlanningAiProposals(
        serviceDependencies,
        command,
      );
    },
  };
}
