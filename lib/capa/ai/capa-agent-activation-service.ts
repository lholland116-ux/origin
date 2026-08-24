import type {
  CapaAgentEligibilityDecision,
  CapaAgentEligibilityRequest,
} from "./capa-agent-contract";

import {
  evaluateCapaAgentEligibility,
} from "./capa-agent-eligibility";

import {
  createInitialCapaAgentRegistry,
  type CapaAgentRegistry,
} from "./capa-agent-registry";

/**
 * Provider-neutral controlled CAPA agent activation boundary.
 *
 * Primary source:
 * Document #7 — Agent Definition and Configuration Specification
 *
 * Traceability:
 * BL-065, BL-067, BL-068, BL-069
 * AG-AC-001 through AG-AC-007
 * P-01 through P-04
 *
 * An eligible decision means only that one exact approved agent definition
 * may proceed to later prompt, tool and model governance boundaries. This
 * service does not invoke an agent, execute a tool, create content, approve
 * a gate or mutate workflow state.
 */

export interface CapaAgentActivationService {
  readonly registry_version: string;

  evaluate(
    request: CapaAgentEligibilityRequest,
  ): CapaAgentEligibilityDecision;
}

class ControlledCapaAgentActivationService
  implements CapaAgentActivationService {
  readonly registry_version: string;

  constructor(
    private readonly registry:
      CapaAgentRegistry,
  ) {
    this.registry_version =
      registry.registry_version;
  }

  evaluate(
    request: CapaAgentEligibilityRequest,
  ): CapaAgentEligibilityDecision {
    return evaluateCapaAgentEligibility(
      this.registry,
      request,
    );
  }
}

/** Creates the initial fail-closed agent activation boundary. */
export function createCapaAgentActivationService(
  registry: CapaAgentRegistry =
    createInitialCapaAgentRegistry(),
): CapaAgentActivationService {
  return Object.freeze(
    new ControlledCapaAgentActivationService(
      registry,
    ),
  );
}
