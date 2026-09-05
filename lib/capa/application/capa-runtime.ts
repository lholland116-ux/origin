import type {
  ApproveCapaScopeDependencies,
} from "./approve-capa-scope";

import type {
  AcceptCapaContainmentRiskDependencies,
} from "./accept-capa-containment-risk";

import type {
  ReleaseCapaInvestigationDependencies,
} from "./release-capa-investigation";

import type {
  SubmitCapaRootCausePackageDependencies,
} from "./submit-capa-root-cause-package";

import type {
  UpdateCapaInvestigationProgressDependencies,
} from "./update-capa-investigation-progress";

import type {
  CreateCapaDependencies,
} from "./create-capa";

import type {
  SubmitCapaIntakeDependencies,
} from "./submit-capa-intake";

import type {
  CapaRepository,
} from "../../database/repositories/capa-repository";

import type {
  CapaKnowledgeRepository,
} from "../../database/repositories/capa-knowledge-repository";

import type {
  CapaKnowledgeRetrievalService,
} from "../knowledge/capa-knowledge-retrieval-service";

import type {
  CapaPromptAssemblyService,
} from "../ai/capa-prompt-service";

import type {
  CapaAgentActivationService,
} from "../ai/capa-agent-activation-service";

import type {
  CapaToolGateway,
} from "../ai/capa-tool-gateway";

import type {
  CapaKnowledgeCitationReviewService,
} from "../knowledge/capa-knowledge-citation-review-service";

import type {
  CapaIntakeAdvisoryService,
} from "../ai/capa-intake-advisory-service";

import type {
  CapaContainmentRiskAdvisoryService,
} from "../ai/capa-containment-risk-advisory-service";

import type {
  CapaInvestigationPlanningAdvisoryService,
} from "../ai/capa-investigation-planning-advisory-service";
import type {
  CapaInvestigationActiveAdvisoryService,
} from "../ai/capa-investigation-active-advisory-service";

import type {
  CapaAiOutputReviewService,
} from "./capa-ai-output-review-runtime-factory";

import type {
  CapaRequestContext,
} from "../../security/supabase-capa-context";
import type { CapaParticipantEligibilityRepository } from "../../database/repositories/capa-participant-eligibility-repository";
import type {
  CapaInvestigationPlanningAdoptionService,
} from "./capa-investigation-planning-adoption-runtime-factory";
import type {
  CapaInvestigationActiveAdoptionService,
} from "./capa-investigation-active-adoption-runtime-factory";
import type {
  CapaInvestigationActiveWorkspaceDraftService,
} from "./capa-investigation-active-workspace-draft-service";

/**
 * Provider-neutral CAPA application runtime.
 *
 * The API layer depends on this contract rather than a specific
 * development, database, ORM, or hosting implementation.
 *
 * Implementations may use in-memory persistence for isolated development
 * and tests or durable PostgreSQL persistence for controlled deployed
 * environments.
 */
export interface CapaRuntime {
  readonly participant_eligibility_repository: CapaParticipantEligibilityRepository;
  /**
   * Tenant-scoped repository used by read operations.
   */
  readonly database: CapaRepository;

  /**
   * Governed knowledge persistence boundary. This does not expose source
   * approval, activation, retrieval ranking or model invocation authority.
   */
  readonly knowledge_repository:
    CapaKnowledgeRepository;

  /**
   * Governed retrieval orchestration. This boundary returns authorized,
   * bounded evidence and exact citation validation only. It cannot invoke a
   * model, mutate workflow state, approve work or determine compliance.
   */
  readonly knowledge_retrieval_service:
    CapaKnowledgeRetrievalService;

  /** Creates one request-scoped, tenant-bound human review service. */
  readonly create_knowledge_citation_review_service?: (
    context: CapaRequestContext,
  ) => CapaKnowledgeCitationReviewService;

  /**
   * Creates one request-scoped, tenant-bound human review service for
   * immutable CAPA AI intake-advisory output.
   *
   * Optional while a runtime lacks the durable append-only review
   * persistence required by M5G Change Set 6. Callers must fail closed
   * when this capability is absent.
   */
  readonly create_ai_output_review_service?: (
    context: CapaRequestContext,
  ) => CapaAiOutputReviewService;

  /**
   * Creates one request-scoped governed CAPA intake advisory service.
   *
   * Authentication, tenant membership and authorization authority remain
   * bound to the trusted server-resolved request context. The runtime must
   * not expose a process-shared advisory service carrying request-specific
   * authority.
   *
   * Optional only during M5G 5C runtime composition. Production and
   * development implementations are wired in 5C.5.
   */
  readonly create_intake_advisory_service: (
    context: CapaRequestContext,
  ) => CapaIntakeAdvisoryService;

  /**
   * Creates one request-scoped S20 containment/risk advisory service from
   * trusted server authentication and tenant context. This AI advisory-only
   * capability is separate from human-controlled G-02 acceptance and cannot
   * advance workflow or perform G-02.
   */
  readonly create_containment_risk_advisory_service: (
    context: CapaRequestContext,
  ) => CapaContainmentRiskAdvisoryService;

  /**
   * Creates one request-scoped S30 investigation-planning advisory service.
   *
   * This capability is advisory-only. It cannot adopt a proposal, perform
   * G-03, advance S30 to S40, or replace the human-controlled release
   * operation.
   */
  readonly create_investigation_planning_advisory_service: (
    context: CapaRequestContext,
  ) => CapaInvestigationPlanningAdvisoryService;

  /** Creates one request-scoped human S30 AI-proposal adoption service. */
  readonly create_investigation_planning_adoption_service: (
    context: CapaRequestContext,
  ) => CapaInvestigationPlanningAdoptionService;

  /** Creates an AG-RCA advisory-only S40 service; it cannot perform S40→S50. */
  readonly create_investigation_active_advisory_service: (
    context: CapaRequestContext,
  ) => CapaInvestigationActiveAdvisoryService;

  /** Creates a human-controlled selective S40 adoption service; it cannot perform S40→S50. */
  readonly create_investigation_active_adoption_service: (
    context: CapaRequestContext,
  ) => CapaInvestigationActiveAdoptionService;

  /** Creates a request-scoped durable S40 human workspace service. */
  readonly create_investigation_active_workspace_draft_service: (
    context: CapaRequestContext,
  ) => CapaInvestigationActiveWorkspaceDraftService;

  /**
   * Application dependencies used by controlled CAPA commands.
   */
  readonly dependencies: CreateCapaDependencies;

  /**
   * Application dependencies for the controlled S00 to S10 transition.
   * Kept separate so workflow authorization configuration cannot be
   * confused with CAPA creation configuration.
   */
  readonly submit_intake_dependencies:
    SubmitCapaIntakeDependencies;

  /**
   * Application dependencies for the human-controlled G-01 S10 to S20
   * scope-acceptance transition.
   *
   * Kept separate from ordinary workflow-transition dependencies because
   * G-01 requires scope validation, explicit human confirmation, fresh
   * step-up authentication and paired approval/state-transition auditing.
   */
  readonly approve_scope_dependencies:
    ApproveCapaScopeDependencies;

  /** Human-controlled G-02 S20 to S30 acceptance dependencies. */
  readonly accept_containment_risk_dependencies:
    AcceptCapaContainmentRiskDependencies;

  /** Human-controlled G-03 S30 to S40 investigation release dependencies. */
  readonly release_investigation_dependencies:
    ReleaseCapaInvestigationDependencies;

  /** Human-controlled same-state S40 investigation progress dependencies. */
  readonly update_investigation_progress_dependencies:
    UpdateCapaInvestigationProgressDependencies;

  /** Human-controlled S40 to S50 root-cause submission dependencies. */
  readonly submit_root_cause_dependencies:
    SubmitCapaRootCausePackageDependencies;

  /**
   * Controlled provider-neutral prompt assembly. This boundary does not
   * invoke a model or possess workflow mutation authority.
   */
  readonly prompt_assembly_service:
    CapaPromptAssemblyService;

  /**
   * Fail-closed exact-version agent eligibility boundary. It does not
   * invoke models or tools and has no workflow mutation authority.
   */
  readonly agent_activation_service:
    CapaAgentActivationService;

  /**
   * Governed, audited, exact-version CAPA tool execution boundary.
   * Approved adapters expose no direct workflow mutation authority.
   */
  readonly tool_gateway: CapaToolGateway;
}
