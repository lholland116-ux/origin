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
  CapaPromptAssemblyService,
} from "../ai/capa-prompt-service";

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
}