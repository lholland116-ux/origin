import {
  isHumanPrincipal,
  isSessionActive,
} from "../security/auth-context";
import type { CapaAuthorizationPolicy } from "../capa/authorization/capa-policy";
import { getActiveRoleAssignments } from "../security/tenant-context";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import type { ControlledCode } from "../capa/domain/capa-types";

export const QUALITY_DATA_INGEST_PERMISSION = "quality_data.source.ingest";
export const QUALITY_DATA_INGEST_OPERATION = "ingest_quality_data_source" as const;
export const QUALITY_DATA_INGEST_PURPOSE = "QUALITY_DATA_SOURCE_INGESTION" as ControlledCode;
export const QUALITY_DATA_READ_PERMISSION = "quality_data.source.read";
export const QUALITY_DATA_READ_OPERATION = "read_quality_data_source" as const;
export const QUALITY_DATA_READ_PURPOSE = "QUALITY_DATA_SOURCE_READ" as ControlledCode;
export const QUALITY_DATA_VERSION_APPROVE_PERMISSION = "quality_data.version.approve";
export const QUALITY_DATA_VERSION_APPROVE_OPERATION = "approve_quality_data_version" as const;
export const QUALITY_DATA_VERSION_APPROVE_PURPOSE = "QUALITY_DATA_VERSION_ANALYTICAL_APPROVAL" as ControlledCode;
export const QUALITY_DATA_EXTERNAL_AI_MANAGE_PERMISSION = "quality_data.external_ai.manage";
export const QUALITY_DATA_EXTERNAL_AI_MANAGE_OPERATION = "manage_quality_data_external_ai_transfer" as const;
export const QUALITY_DATA_EXTERNAL_AI_MANAGE_PURPOSE = "QUALITY_DATA_EXTERNAL_AI_TRANSFER_AUTHORIZATION" as ControlledCode;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QualityDataAuthorizationFailure =
  | "HUMAN_PRINCIPAL_REQUIRED"
  | "SESSION_INACTIVE"
  | "CALLER_IDENTITY_MISMATCH"
  | "ACTIVE_ORG_ADMIN_REQUIRED"
  | "QUALITY_DATA_PERMISSION_DENIED";

export type QualityDataAuthorizationResult =
  | {
      readonly allowed: true;
      readonly organization_id: string;
      readonly membership_id: string;
      readonly uploader_user_id: string;
    }
  | {
      readonly allowed: false;
      readonly reason_code: QualityDataAuthorizationFailure;
    };

export interface QualityDataIngestionAuthorizer {
  authorize(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult>;
}

export interface QualityDataReadAuthorizer {
  authorizeRead(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult>;
}

export interface QualityDataVersionApprovalAuthorizer {
  authorizeApproval(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult>;
}

export interface QualityDataExternalAiTransferAuthorizer {
  authorizeExternalAiTransfer(context: CapaRequestContext, trustedNow: Date): Promise<QualityDataAuthorizationResult>;
}

/**
 * Uses the normal CAPA membership and database-backed role policy, while
 * requiring the exact CAPA_ORG_ADMIN role for the quality ingestion action.
 */
export class PolicyBackedQualityDataIngestionAuthorizer
  implements QualityDataIngestionAuthorizer, QualityDataReadAuthorizer, QualityDataVersionApprovalAuthorizer, QualityDataExternalAiTransferAuthorizer {
  constructor(
    private readonly policy: CapaAuthorizationPolicy,
  ) {}

  async authorize(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult> {
    return this.authorizeOperation(
      context,
      trustedNow,
      QUALITY_DATA_INGEST_OPERATION,
      QUALITY_DATA_INGEST_PURPOSE,
    );
  }

  async authorizeRead(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult> {
    return this.authorizeOperation(
      context,
      trustedNow,
      QUALITY_DATA_READ_OPERATION,
      QUALITY_DATA_READ_PURPOSE,
    );
  }

  async authorizeApproval(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult> {
    return this.authorizeOperation(
      context,
      trustedNow,
      QUALITY_DATA_VERSION_APPROVE_OPERATION,
      QUALITY_DATA_VERSION_APPROVE_PURPOSE,
    );
  }

  async authorizeExternalAiTransfer(
    context: CapaRequestContext,
    trustedNow: Date,
  ): Promise<QualityDataAuthorizationResult> {
    return this.authorizeOperation(
      context,
      trustedNow,
      QUALITY_DATA_EXTERNAL_AI_MANAGE_OPERATION,
      QUALITY_DATA_EXTERNAL_AI_MANAGE_PURPOSE,
    );
  }

  private async authorizeOperation(
    context: CapaRequestContext,
    trustedNow: Date,
    operation: typeof QUALITY_DATA_INGEST_OPERATION | typeof QUALITY_DATA_READ_OPERATION | typeof QUALITY_DATA_VERSION_APPROVE_OPERATION | typeof QUALITY_DATA_EXTERNAL_AI_MANAGE_OPERATION,
    purpose: ControlledCode,
  ): Promise<QualityDataAuthorizationResult> {
    if (!isHumanPrincipal(context.authentication)) {
      return { allowed: false, reason_code: "HUMAN_PRINCIPAL_REQUIRED" };
    }
    if (!isSessionActive(context.authentication, trustedNow)) {
      return { allowed: false, reason_code: "SESSION_INACTIVE" };
    }
    const principal = context.authentication.principal;
    if (
      context.owner_user_id !== principal.user_id ||
      !UUID_PATTERN.test(context.tenant.organization_id) ||
      !UUID_PATTERN.test(principal.user_id)
    ) {
      return { allowed: false, reason_code: "CALLER_IDENTITY_MISMATCH" };
    }

    const activeAssignments = getActiveRoleAssignments(context.tenant, trustedNow);
    if (!activeAssignments.some((assignment) =>
      assignment.role_id === "CAPA_ORG_ADMIN" && assignment.scope === "ORGANIZATION")) {
      return { allowed: false, reason_code: "ACTIVE_ORG_ADMIN_REQUIRED" };
    }

    let decision;
    try {
      decision = await this.policy.evaluate({
        authentication: context.authentication,
        tenant: context.tenant,
        operation,
        resource: {
          organization_id: context.tenant.organization_id,
          resource_type: "QUALITY_DATA_SOURCE" as ControlledCode,
        },
        purpose,
        trusted_now: trustedNow,
      });
    } catch {
      return { allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" };
    }
    if (decision.decision !== "allow") {
      return { allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" };
    }

    return {
      allowed: true,
      organization_id: context.tenant.organization_id,
      membership_id: context.tenant.access_grant_id,
      uploader_user_id: principal.user_id,
    };
  }
}
