import type {
  ControlledCode,
} from "../domain/capa-types";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  TenantContext,
} from "../../security/tenant-context";

import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";

import type {
  CapaCaseListCursor,
  CapaCaseListPage,
  CapaRepository,
} from "../../database/repositories/capa-repository";

/**
 * Authorized organization-scoped CAPA case-list query.
 *
 * Primary sources:
 * Document #5 — LVT CAPA Human Review UI Specification
 * Document #8 — LVT CAPA Data Model and Audit-Trail Specification
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * URS-CASE-002
 * DM-COM-001 through DM-COM-003
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 */

export const DEFAULT_CAPA_CASE_LIST_LIMIT =
  25;

export const MAXIMUM_CAPA_CASE_LIST_LIMIT =
  100;

export interface ListCapaCasesClock {
  now(): Date;
}

export interface ListCapaCasesDependencies {
  readonly repository:
    CapaRepository;

  readonly authorization_policy:
    CapaAuthorizationPolicy;

  readonly clock:
    ListCapaCasesClock;
}

export interface ListCapaCasesCommand {
  readonly authentication:
    AuthenticationContext;

  readonly tenant:
    TenantContext;

  readonly limit?: number;

  readonly cursor?:
    CapaCaseListCursor;
}

export type ListCapaCasesResult =
  | {
      readonly status: "listed";
      readonly page:
        CapaCaseListPage;
    }
  | {
      readonly status:
        "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | {
      readonly status:
        "step_up_required";
      readonly reason_code: string;
      readonly policy_version: string;
      readonly required_assurance:
        ControlledCode;
    };

export class ListCapaCasesConfigurationError
  extends Error {
  constructor(message: string) {
    super(message);

    this.name =
      "ListCapaCasesConfigurationError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function resolvedLimit(
  value: number | undefined,
): number {
  const limit =
    value ??
    DEFAULT_CAPA_CASE_LIST_LIMIT;

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit >
      MAXIMUM_CAPA_CASE_LIST_LIMIT
  ) {
    throw new ListCapaCasesConfigurationError(
      `limit must be a safe integer between 1 and ${MAXIMUM_CAPA_CASE_LIST_LIMIT}.`,
    );
  }

  return limit;
}

function trustedNow(
  clock: ListCapaCasesClock,
): Date {
  const value = clock.now();

  if (
    !Number.isFinite(
      value.getTime(),
    )
  ) {
    throw new ListCapaCasesConfigurationError(
      "The trusted server clock returned an invalid time.",
    );
  }

  return value;
}

export async function listCapaCases(
  dependencies:
    ListCapaCasesDependencies,

  command:
    ListCapaCasesCommand,
): Promise<ListCapaCasesResult> {
  const now =
    trustedNow(
      dependencies.clock,
    );

  const limit =
    resolvedLimit(
      command.limit,
    );

  const decision =
    await dependencies
      .authorization_policy
      .evaluate({
        authentication:
          command.authentication,

        tenant:
          command.tenant,

        operation:
          "view_case",

        resource: {
          organization_id:
            command.tenant
              .organization_id,

          resource_type:
            controlled(
              "CAPA_CASE_COLLECTION",
            ),
        },

        purpose:
          controlled(
            "CAPA_CASE_ACCESS",
          ),

        trusted_now:
          now,
      });

  if (
    decision.decision === "deny"
  ) {
    return {
      status:
        "authorization_denied",
      reason_code:
        decision.reason_code,
      policy_version:
        decision.policy_version,
    };
  }

  if (
    decision.decision === "step_up"
  ) {
    return {
      status:
        "step_up_required",
      reason_code:
        decision.reason_code,
      policy_version:
        decision.policy_version,
      required_assurance:
        decision.required_assurance,
    };
  }

  const page =
    await dependencies.repository
      .listCases({
        organization_id:
          command.tenant
            .organization_id,

        limit,

        ...(command.cursor ===
        undefined
          ? {}
          : {
              cursor:
                command.cursor,
            }),
      });

  return {
    status: "listed",
    page,
  };
}