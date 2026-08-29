export const
  CAPA_SCOPE_APPROVAL_CONFIRMATION =
    "G01_SCOPE_ACCEPTANCE_CONFIRMED" as const;

export interface CapaScopeApprovalAttempt {
  readonly capaCaseId:
    string;

  readonly caseNumber:
    string;

  readonly recordVersion:
    number;

  readonly currentVersionId:
    string;

  /**
   * Stable across the initial request and any post-step-up retry.
   */
  readonly idempotencyKey:
    string;

  /**
   * Exact serialized request snapshot.
   *
   * This string is created once when the human confirms the G-01 action.
   * A step-up retry must reuse this exact string rather than rebuilding
   * the request from mutable browser form state.
   */
  readonly requestBody:
    string;
}

export interface CreateCapaScopeApprovalAttemptInput {
  readonly capaCaseId:
    string;

  readonly caseNumber:
    string;

  readonly recordVersion:
    number;

  readonly currentVersionId:
    string;

  readonly idempotencyKey:
    string;

  /**
   * The server-side G-01 application service remains the authoritative
   * validator for the complete controlled CAPA scope contract.
   */
  readonly scope:
    unknown;

  readonly rationale:
    string | null;
}

export type CapaScopeApprovalFailure =
  | {
      readonly kind:
        "step_up_required";

      readonly code:
        "CAPA_STEP_UP_REQUIRED";

      readonly message:
        string;

      readonly correlationId:
        string | null;
    }
  | {
      readonly kind:
        "gate_blocked";

      readonly code:
        "CAPA_SCOPE_GATE_BLOCKED";

      readonly message:
        string;

      readonly blockerCodes:
        readonly string[];

      readonly correlationId:
        string | null;
    }
  | {
      readonly kind:
        "validation_failed";

      readonly code:
        "CAPA_SCOPE_APPROVAL_VALIDATION_FAILED"
        | "INVALID_CAPA_SCOPE_APPROVAL";

      readonly message:
        string;

      readonly issues:
        readonly CapaScopeApprovalIssue[];

      readonly correlationId:
        string | null;
    }
  | {
      readonly kind:
        "conflict";

      readonly code:
        | "CAPA_IDEMPOTENCY_CONFLICT"
        | "CAPA_CONCURRENCY_CONFLICT"
        | "CAPA_WORKFLOW_CONFLICT";

      readonly message:
        string;

      readonly correlationId:
        string | null;
    }
  | {
      readonly kind:
        "access_denied";

      readonly code:
        | "CAPA_ACCESS_DENIED"
        | "CAPA_TENANT_ACCESS_DENIED"
        | "UNAUTHORIZED"
        | "INVALID_SESSION_CONTEXT";

      readonly message:
        string;

      readonly correlationId:
        string | null;
    }
  | {
      readonly kind:
        "not_found";

      readonly code:
        "CAPA_NOT_FOUND";

      readonly message:
        string;

      readonly correlationId:
        string | null;
    }
  | {
      readonly kind:
        "unexpected";

      readonly code:
        string | null;

      readonly message:
        string;

      readonly correlationId:
        string | null;
    };

export interface CapaScopeApprovalIssue {
  readonly path:
    string;

  readonly message:
    string;
}

export interface CapaScopeApprovalSuccess {
  readonly capaCaseId:
    string;

  readonly caseNumber:
    string;

  readonly status:
    "S20";

  readonly recordVersion:
    number;

  readonly currentVersionId:
    string;

  readonly approvedVersionId:
    string;

  readonly scopeSectionVersionId:
    string;

  readonly approvedAt:
    string;

  readonly approvalAuditEventId:
    string;

  readonly transitionAuditEventId:
    string;

  readonly replayed:
    boolean;

  readonly correlationId:
    string | null;
}

function isRecord(
  value: unknown,
): value is Readonly<
  Record<string, unknown>
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0
  );
}

function isPositiveSafeInteger(
  value: unknown,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value > 0
  );
}

function normalizedNullableRationale(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized.length > 0
    ? normalized
    : null;
}

/**
 * Creates one immutable browser attempt for the human-controlled G-01 action.
 *
 * The complete HTTP body is serialized once. A fresh-authentication retry
 * must reuse both requestBody and idempotencyKey from this same object.
 */
export function createCapaScopeApprovalAttempt(
  input:
    CreateCapaScopeApprovalAttemptInput,
): CapaScopeApprovalAttempt | null {
  if (
    !isNonEmptyString(
      input.capaCaseId,
    ) ||
    !isNonEmptyString(
      input.caseNumber,
    ) ||
    !isPositiveSafeInteger(
      input.recordVersion,
    ) ||
    !isNonEmptyString(
      input.currentVersionId,
    ) ||
    !isNonEmptyString(
      input.idempotencyKey,
    )
  ) {
    return null;
  }

  const requestBody =
    JSON.stringify({
      expected_record_version:
        input.recordVersion,

      expected_current_version_id:
        input.currentVersionId,

      scope:
        input.scope,

      approval: {
        decision:
          "approve",

        confirmation:
          CAPA_SCOPE_APPROVAL_CONFIRMATION,

        rationale:
          normalizedNullableRationale(
            input.rationale,
          ),
      },
    });

  return Object.freeze({
    capaCaseId:
      input.capaCaseId,

    caseNumber:
      input.caseNumber,

    recordVersion:
      input.recordVersion,

    currentVersionId:
      input.currentVersionId,

    idempotencyKey:
      input.idempotencyKey,

    requestBody,
  });
}

function parsedIssueArray(
  value: unknown,
): readonly CapaScopeApprovalIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const issues:
    CapaScopeApprovalIssue[] = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(
        item.path,
      ) ||
      !isNonEmptyString(
        item.message,
      )
    ) {
      continue;
    }

    issues.push(
      Object.freeze({
        path:
          item.path,

        message:
          item.message,
      }),
    );
  }

  return Object.freeze(issues);
}

function failureEnvelope(
  value: unknown,
): Readonly<{
  readonly code:
    string | null;

  readonly message:
    string;

  readonly issues:
    readonly CapaScopeApprovalIssue[];

  readonly correlationId:
    string | null;
}> {
  const fallback =
    "The CAPA scope approval could not be completed.";

  if (!isRecord(value)) {
    return Object.freeze({
      code:
        null,

      message:
        fallback,

      issues: [],

      correlationId:
        null,
    });
  }

  const error =
    value.error;

  if (!isRecord(error)) {
    return Object.freeze({
      code:
        null,

      message:
        fallback,

      issues: [],

      correlationId:
        null,
    });
  }

  return Object.freeze({
    code:
      isNonEmptyString(
        error.code,
      )
        ? error.code
        : null,

    message:
      isNonEmptyString(
        error.message,
      )
        ? error.message
        : fallback,

    issues:
      parsedIssueArray(
        error.issues,
      ),

    correlationId:
      isNonEmptyString(
        error.correlation_id,
      )
        ? error.correlation_id
        : null,
  });
}

export function parseCapaScopeApprovalFailure(
  value: unknown,
): CapaScopeApprovalFailure {
  const envelope =
    failureEnvelope(value);

  if (
    envelope.code ===
    "CAPA_STEP_UP_REQUIRED"
  ) {
    return Object.freeze({
      kind:
        "step_up_required",

      code:
        envelope.code,

      message:
        envelope.message,

      correlationId:
        envelope.correlationId,
    });
  }

  if (
    envelope.code ===
    "CAPA_SCOPE_GATE_BLOCKED"
  ) {
    return Object.freeze({
      kind:
        "gate_blocked",

      code:
        envelope.code,

      message:
        envelope.message,

      blockerCodes:
        Object.freeze(
          envelope.issues
            .filter(
              (issue) =>
                issue.path ===
                "scope",
            )
            .map(
              (issue) =>
                issue.message,
            ),
        ),

      correlationId:
        envelope.correlationId,
    });
  }

  if (
    envelope.code ===
      "CAPA_SCOPE_APPROVAL_VALIDATION_FAILED" ||
    envelope.code ===
      "INVALID_CAPA_SCOPE_APPROVAL"
  ) {
    return Object.freeze({
      kind:
        "validation_failed",

      code:
        envelope.code,

      message:
        envelope.message,

      issues:
        envelope.issues,

      correlationId:
        envelope.correlationId,
    });
  }

  if (
    envelope.code ===
      "CAPA_IDEMPOTENCY_CONFLICT" ||
    envelope.code ===
      "CAPA_CONCURRENCY_CONFLICT" ||
    envelope.code ===
      "CAPA_WORKFLOW_CONFLICT"
  ) {
    return Object.freeze({
      kind:
        "conflict",

      code:
        envelope.code,

      message:
        envelope.message,

      correlationId:
        envelope.correlationId,
    });
  }

  if (
    envelope.code ===
      "CAPA_ACCESS_DENIED" ||
    envelope.code ===
      "CAPA_TENANT_ACCESS_DENIED" ||
    envelope.code ===
      "UNAUTHORIZED" ||
    envelope.code ===
      "INVALID_SESSION_CONTEXT"
  ) {
    return Object.freeze({
      kind:
        "access_denied",

      code:
        envelope.code,

      message:
        envelope.message,

      correlationId:
        envelope.correlationId,
    });
  }

  if (
    envelope.code ===
    "CAPA_NOT_FOUND"
  ) {
    return Object.freeze({
      kind:
        "not_found",

      code:
        envelope.code,

      message:
        envelope.message,

      correlationId:
        envelope.correlationId,
    });
  }

  return Object.freeze({
    kind:
      "unexpected",

    code:
      envelope.code,

    message:
      envelope.message,

    correlationId:
      envelope.correlationId,
  });
}

export function parseCapaScopeApprovalSuccess(
  value: unknown,
  expectedCaseId: string,
): CapaScopeApprovalSuccess | null {
  if (
    !isRecord(value) ||
    !isRecord(value.capa) ||
    value.capa.capa_case_id !==
      expectedCaseId ||
    !isNonEmptyString(
      value.capa.case_number,
    ) ||
    value.capa.status !==
      "S20" ||
    !isPositiveSafeInteger(
      value.capa.record_version,
    ) ||
    !isNonEmptyString(
      value.capa.current_version_id,
    ) ||
    !isNonEmptyString(
      value.capa.approved_version_id,
    ) ||
    !isNonEmptyString(
      value.capa.scope_section_version_id,
    ) ||
    !isNonEmptyString(
      value.capa.approved_at,
    ) ||
    !isNonEmptyString(
      value.capa.approval_audit_event_id,
    ) ||
    !isNonEmptyString(
      value.capa.transition_audit_event_id,
    ) ||
    typeof value.replayed !==
      "boolean"
  ) {
    return null;
  }

  return Object.freeze({
    capaCaseId:
      value.capa.capa_case_id,

    caseNumber:
      value.capa.case_number,

    status:
      value.capa.status,

    recordVersion:
      value.capa.record_version,

    currentVersionId:
      value.capa.current_version_id,

    approvedVersionId:
      value.capa.approved_version_id,

    scopeSectionVersionId:
      value.capa.scope_section_version_id,

    approvedAt:
      value.capa.approved_at,

    approvalAuditEventId:
      value.capa.approval_audit_event_id,

    transitionAuditEventId:
      value.capa.transition_audit_event_id,

    replayed:
      value.replayed,

    correlationId:
      isNonEmptyString(
        value.correlation_id,
      )
        ? value.correlation_id
        : null,
  });
}
