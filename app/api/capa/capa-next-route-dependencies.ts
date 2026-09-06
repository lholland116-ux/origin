import {
  randomUUID,
} from "node:crypto";

import type {
  CapaApiHandlerDependencies,
} from "@/lib/capa/api/capa-route-handler";

import type {
  CapaCitationReviewApiDependencies,
} from "@/lib/capa/api/capa-citation-review-route-handler";

import type {
  CapaIntakeAdvisoryApiDependencies,
} from "@/lib/capa/api/capa-intake-advisory-route-handler";

import type {
  CapaContainmentRiskAdvisoryApiDependencies,
} from "@/lib/capa/api/capa-containment-risk-advisory-route-handler";

import type {
  CapaInvestigationPlanningAdvisoryApiDependencies,
} from "@/lib/capa/api/capa-investigation-planning-advisory-route-handler";

import type {
  CapaAiOutputReviewApiDependencies,
} from "@/lib/capa/api/capa-ai-output-review-route-handler";

import type {
  CapaInvestigationPlanningAdoptionApiDependencies,
} from "@/lib/capa/api/capa-investigation-planning-adoption-route-handler";

import type {
  CapaInvestigationActiveAdvisoryApiDependencies,
} from "@/lib/capa/api/capa-investigation-active-advisory-route-handler";

import type {
  CapaInvestigationActiveAdoptionApiDependencies,
} from "@/lib/capa/api/capa-investigation-active-adoption-route-handler";
import type {
  CapaInvestigationActiveWorkspaceDraftApiDependencies,
} from "@/lib/capa/api/capa-investigation-active-workspace-draft-route-handler";
import type { CapaInvestigationActiveWorkspaceReconciliationApiDependencies } from "@/lib/capa/api/capa-investigation-active-workspace-reconciliation-route-handler";

import {
  selectCapaRuntime,
} from "@/lib/capa/application/capa-runtime-selection";

import type {
  SupabaseCapaSessionFacts,
} from "@/lib/security/supabase-capa-context";

import {
  deriveSupabaseCapaStepUpFacts,
} from "@/lib/security/supabase-capa-step-up-facts";

import {
  createServerSupabaseClient,
} from "@/lib/supabase/server";

/**
 * Returns minimized, server-verified authentication facts.
 *
 * Raw credentials, provider tokens, passwords and browser-supplied
 * authorization values never cross the CAPA application boundary.
 */
async function getVerifiedSessionFacts():
  Promise<
    SupabaseCapaSessionFacts | null
  > {
  const supabase =
    await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (
    userError !== null ||
    user === null ||
    user.last_sign_in_at === undefined
  ) {
    return null;
  }

  /**
   * getClaims() verifies the active JWT. With asymmetric signing keys the
   * signature is checked against the project's JWKS; otherwise Supabase
   * falls back to an Auth-server getUser() verification.
   *
   * Browser-provided AAL, AMR or reauthentication values are never read.
   */
  const {
    data: claimsData,
    error: claimsError,
  } = await supabase.auth.getClaims();

  if (
    claimsError !== null ||
    claimsData === null ||
    claimsData.claims.sub !==
      user.id ||
    !Number.isSafeInteger(
      claimsData.claims.exp,
    ) ||
    claimsData.claims.exp <= 0
  ) {
    return null;
  }

  let stepUpFacts;

  try {
    stepUpFacts =
      deriveSupabaseCapaStepUpFacts({
        aal:
          claimsData.claims.aal,
        amr:
          claimsData.claims.amr,
      });
  } catch {
    /*
     * Invalid or unsupported verified assurance claims fail closed as an
     * unauthenticated CAPA request context rather than being normalized.
     */
    return null;
  }

  return {
    verified_user_id:
      user.id,

    authenticated_at:
      user.last_sign_in_at,

    expires_at_epoch_seconds:
      claimsData.claims.exp,

    verified_aal:
      stepUpFacts.verified_aal,

    ...(stepUpFacts
      .verified_reauthenticated_at_epoch_seconds ===
    undefined
      ? {}
      : {
          verified_reauthenticated_at_epoch_seconds:
            stepUpFacts
              .verified_reauthenticated_at_epoch_seconds,
        }),
  };
}

/**
 * Assembles one coherent runtime and trusted context-resolver pair for all
 * CAPA Next.js routes.
 */
export function createCapaApiHandlerDependencies():
  CapaApiHandlerDependencies {
  const selection =
    selectCapaRuntime();

  return {
    get_session_facts:
      getVerifiedSessionFacts,
    resolve_context:
      selection.resolve_context,
    get_runtime() {
      return selection.runtime;
    },
    now() {
      return new Date();
    },
    generate_uuid:
      randomUUID,
    logger: {
      error(message, metadata) {
        console.error(
          message,
          metadata,
        );
      },
    },
  };
}

export function createCapaCitationReviewApiDependencies():
  CapaCitationReviewApiDependencies {
  const dependencies = createCapaApiHandlerDependencies();
  return {
    ...dependencies,
    create_review_service(context) {
      const factory = dependencies.get_runtime()
        .create_knowledge_citation_review_service;
      if (factory === undefined) {
        throw new Error("CAPA citation review is not configured.");
      }
      return factory(context);
    },
  };
}

export function createCapaAiOutputReviewApiDependencies():
  CapaAiOutputReviewApiDependencies {
  const dependencies =
    createCapaApiHandlerDependencies();

  return {
    ...dependencies,

    create_review_service(context) {
      const factory =
        dependencies
          .get_runtime()
          .create_ai_output_review_service;

      if (factory === undefined) {
        throw new Error(
          "CAPA AI-output review is not configured.",
        );
      }

      return factory(
        context,
      );
    },
  };
}

export function createCapaIntakeAdvisoryApiDependencies():
  CapaIntakeAdvisoryApiDependencies {
  const dependencies =
    createCapaApiHandlerDependencies();

  return {
    ...dependencies,

    create_advisory_service(context) {
      return dependencies
        .get_runtime()
        .create_intake_advisory_service(
          context,
        );
    },
  };
}

export function createCapaContainmentRiskAdvisoryApiDependencies():
  CapaContainmentRiskAdvisoryApiDependencies {
  const dependencies =
    createCapaApiHandlerDependencies();

  return {
    ...dependencies,

    create_advisory_service(context) {
      return dependencies
        .get_runtime()
        .create_containment_risk_advisory_service(
          context,
        );
    },
  };
}

export function createCapaInvestigationPlanningAdvisoryApiDependencies():
  CapaInvestigationPlanningAdvisoryApiDependencies {
  const dependencies =
    createCapaApiHandlerDependencies();

  return {
    ...dependencies,

    create_advisory_service(context) {
      return dependencies
        .get_runtime()
        .create_investigation_planning_advisory_service(
          context,
        );
    },
  };
}

export function createCapaInvestigationPlanningAdoptionApiDependencies():
  CapaInvestigationPlanningAdoptionApiDependencies {
  const dependencies = createCapaApiHandlerDependencies();

  return {
    ...dependencies,
    create_adoption_service(context) {
      return dependencies
        .get_runtime()
        .create_investigation_planning_adoption_service(context);
    },
  };
}

export function createCapaInvestigationActiveAdvisoryApiDependencies():
  CapaInvestigationActiveAdvisoryApiDependencies {
  const dependencies = createCapaApiHandlerDependencies();
  return {
    ...dependencies,
    create_advisory_service(context) {
      return dependencies.get_runtime().create_investigation_active_advisory_service(context);
    },
  };
}

export function createCapaInvestigationActiveAdoptionApiDependencies():
  CapaInvestigationActiveAdoptionApiDependencies {
  const dependencies = createCapaApiHandlerDependencies();
  return {
    ...dependencies,
    create_adoption_service(context) {
      return dependencies.get_runtime().create_investigation_active_adoption_service(context);
    },
  };
}

export function createCapaInvestigationActiveWorkspaceDraftApiDependencies():
  CapaInvestigationActiveWorkspaceDraftApiDependencies {
  const dependencies = createCapaApiHandlerDependencies();
  return {
    ...dependencies,
    create_workspace_service(context) {
      return dependencies.get_runtime().create_investigation_active_workspace_draft_service(context);
    },
  };
}

export function createCapaInvestigationActiveWorkspaceReconciliationApiDependencies(): CapaInvestigationActiveWorkspaceReconciliationApiDependencies {
  const dependencies = createCapaApiHandlerDependencies();
  return { ...dependencies, create_reconciliation_service(context) { return dependencies.get_runtime().create_investigation_active_workspace_reconciliation_service(context); } };
}
