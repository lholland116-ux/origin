import type {
  CapaRuntime,
} from "./capa-runtime";

import {
  getCapaDevelopmentRuntime,
} from "./capa-development-runtime";

import {
  getCapaProductionRuntime,
  type CapaProductionRuntime,
} from "./capa-production-runtime";

import {
  resolveDevelopmentCapaRequestContext,
  type SupabaseCapaContextResolver,
} from "../../security/supabase-capa-context";

/**
 * Fail-closed CAPA runtime selection.
 *
 * Production must always use durable PostgreSQL persistence, durable
 * tenant resolution and durable authorization. The development runtime
 * remains available only in explicitly non-production environments.
 */

export type CapaRuntimeMode =
  | "development"
  | "durable";

export interface CapaRuntimeSelection {
  readonly mode:
    CapaRuntimeMode;

  readonly runtime:
    CapaRuntime;

  readonly resolve_context:
    SupabaseCapaContextResolver;
}

export interface CapaRuntimeSelectionOptions {
  /**
   * Defaults to NODE_ENV.
   */
  readonly environment?: string;

  /**
   * Defaults to CAPA_RUNTIME_MODE.
   *
   * Supported values are development and durable.
   */
  readonly configured_mode?: string;

  /**
   * Test and composition seams.
   */
  readonly get_development_runtime?:
    () => CapaRuntime;

  readonly resolve_development_context?:
    SupabaseCapaContextResolver;

  readonly get_production_runtime?:
    () => CapaProductionRuntime;
}

export class CapaRuntimeSelectionError
  extends Error {
  constructor(message: string) {
    super(message);

    this.name =
      "CapaRuntimeSelectionError";
  }
}

function resolveRuntimeMode(
  environment: string | undefined,
  configuredMode: string | undefined,
): CapaRuntimeMode {
  if (
    configuredMode !== undefined &&
    configuredMode !== "development" &&
    configuredMode !== "durable"
  ) {
    throw new CapaRuntimeSelectionError(
      "CAPA_RUNTIME_MODE must be either development or durable.",
    );
  }

  const mode =
    configuredMode ??
    (
      environment === "production"
        ? "durable"
        : "development"
    );

  if (
    environment === "production" &&
    mode !== "durable"
  ) {
    throw new CapaRuntimeSelectionError(
      "The CAPA development runtime is prohibited in production.",
    );
  }

  return mode;
}

/**
 * Selects one coherent CAPA runtime and context-resolver pair.
 *
 * Persistence and context resolution must be selected together. Mixing a
 * durable database with the temporary single-user development tenant—or
 * mixing durable membership resolution with in-memory persistence—is not
 * permitted.
 */
export function selectCapaRuntime(
  options:
    CapaRuntimeSelectionOptions = {},
): CapaRuntimeSelection {
  const environment =
    options.environment ??
    process.env.NODE_ENV;

  const configuredMode =
    options.configured_mode ??
    process.env.CAPA_RUNTIME_MODE;

  const mode =
    resolveRuntimeMode(
      environment,
      configuredMode,
    );

  if (mode === "durable") {
    const productionRuntime =
      (
        options
          .get_production_runtime ??
        getCapaProductionRuntime
      )();

    return {
      mode,
      runtime:
        productionRuntime,
      resolve_context:
        productionRuntime
          .resolve_context,
    };
  }

  const developmentRuntime =
    (
      options
        .get_development_runtime ??
      getCapaDevelopmentRuntime
    )();

  return {
    mode,
    runtime:
      developmentRuntime,
    resolve_context:
      options
        .resolve_development_context ??
      resolveDevelopmentCapaRequestContext,
  };
}