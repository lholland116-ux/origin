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