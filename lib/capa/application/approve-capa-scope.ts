import {
  createHash,
} from "node:crypto";

import type {
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  ControlledCode,
  IdempotencyKey,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";

import {
  CAPA_STATE,
} from "../domain/capa-state";

import {
  CAPA_SCOPE_SCHEMA_VERSION,
  CAPA_SCOPE_SECTION_TYPE,
  evaluateCapaScopeGatePrerequisites,
  validateCapaScopeContent,
  type CapaScopeContent,
  type CapaScopeGateBlockerCode,
} from "../domain/capa-scope";

import {
  evaluateCapaAuthorizationPreconditions,
} from "../authorization/capa-permissions";

import type {
  CapaAuthorizationPolicy,
} from "../authorization/capa-policy";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  TenantContext,
} from "../../security/tenant-context";

import type {
  CapaRepository,
} from "../../database/repositories/capa-repository";

import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";

import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

import type {
  CreateCapaClock,
  CreateCapaIdGenerator,
} from "./create-capa";

import {
  AuditEventAppendConflictError,
} from "./create-capa";

/**
 * Human-controlled G-01 CAPA scope acceptance.
 *
 * Controlled sources:
 * - LVT-CAPA-URS-003 — URS-INT-002 through URS-INT-010
 * - LVT-CAPA-WFS-004 — S10, G-01, WFR controls
 * - LVT-CAPA-HRUI-005 — G-01 gate decision interface
 *
 * Regulatory design context:
 * - FDA Quality Management System Regulation (QMSR)
 * - ISO 13485:2016 section 8.5.2
 * - former 21 CFR 820.100 retained as a legacy CAPA cross-reference
 *
 * This service never delegates workflow authority to AI. Only an
 * authenticated, authorized human satisfying configured step-up controls
 * may execute the S10 -> S20 transition.
 */

const SOURCE_STATE =
  CAPA_STATE.TRIAGE_AND_SCOPE;

const TARGET_STATE =
  CAPA_STATE
    .CONTAINMENT_AND_IMPACT_RISK;

const OPERATION_CODE =
  "APPROVE_CAPA_SCOPE";

const AUTHORIZATION_PURPOSE =
  "CAPA_GATE_DECISION";

const GATE_CODE =
  "G-01";

const GATE_MEANING =
  "Problem and boundaries are reviewable; CAPA path confirmed.";

export const CAPA_SCOPE_APPROVAL_CONFIRMATION =
  "G01_SCOPE_ACCEPTANCE_CONFIRMED" as const;

const FINGERPRINT_VERSION =
  "approve-capa-scope-fingerprint-1";

const IDEMPOTENCY_KEY_MAXIMUM_LENGTH =
  128;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ApproveCapaScopeConfiguration {
  readonly workflow_version:
    string;

  readonly audit_schema_version:
    string;

  readonly step_up_maximum_age_ms:
    number;

  readonly required_step_up_assurance:
    ControlledCode;

  /**
   * Pilot configuration may require rationale for every positive G-01
   * decision even though the UI baseline permits configurable rationale.
   */
  readonly approval_rationale_required:
    boolean;
}

export interface ApproveCapaScopeCommand {
  readonly authentication:
    AuthenticationContext;

  readonly tenant:
    TenantContext;

  readonly capa_case_id:
    CapaCaseId;

  readonly expected_record_version:
    number;

  readonly expected_current_version_id:
    CapaCaseVersionId;

  readonly request_trace:
    RequestTrace;

  readonly body:
    unknown;
}

export interface ApproveCapaScopeDependencies {
  readonly transaction_manager:
    TransactionManager;

  readonly capa_repository:
    CapaRepository;

  readonly audit_repository:
    AuditRepository;

  readonly workflow_idempotency_repository:
    CapaWorkflowIdempotencyRepository;

  readonly authorization_policy:
    CapaAuthorizationPolicy;

  readonly id_generator:
    CreateCapaIdGenerator;

  readonly clock:
    CreateCapaClock;

  readonly configuration:
    ApproveCapaScopeConfiguration;
}

interface CapaScopeApprovalDecision {
  readonly decision:
    "approve";

  readonly confirmation:
    typeof CAPA_SCOPE_APPROVAL_CONFIRMATION;

  readonly rationale:
    string | null;
}

interface ValidatedApprovalBody {
  readonly scope:
    CapaScopeContent;

  readonly approval:
    CapaScopeApprovalDecision;
}

interface CompletedScopeApproval {
  readonly capa_case:
    CapaCase;

  readonly case_version:
    CapaCaseVersion;

  readonly scope_section_version:
    CapaSectionVersion;

  readonly approval_audit_event_id:
    AuditEventId;

  readonly transition_audit_event_id:
    AuditEventId;
}

export type ApproveCapaScopeResult =
  | ({
      readonly status:
        "approved";
    } & CompletedScopeApproval)
  | ({
      readonly status:
        "already_approved";
    } & CompletedScopeApproval)
  | {
      readonly status:
        "validation_failed";

      readonly reason_code:
        | "INVALID_REQUEST_BODY"
        | "INVALID_SCOPE"
        | "INVALID_APPROVAL"
        | "INVALID_APPROVAL_CONFIRMATION"
        | "APPROVAL_RATIONALE_REQUIRED";

      readonly scope_reason_code?:
        string;
    }
  | {
      readonly status:
        "gate_blocked";

      readonly blocker_codes:
        readonly CapaScopeGateBlockerCode[];
    }
  | {
      readonly status:
        "idempotency_conflict";

      readonly reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    }
  | {
      readonly status:
        "not_found_or_not_authorized";
    }
  | {
      readonly status:
        "concurrency_conflict";

      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    }
  | {
      readonly status:
        "workflow_conflict";

      readonly reason_code:
        "WORKFLOW_STATE_NOT_ALLOWED";
    }
  | {
      readonly status:
        "authorization_denied";

      readonly reason_code:
        string;

      readonly policy_version:
        string;
    }
  | {
      readonly status:
        "step_up_required";

      readonly reason_code:
        string;

      readonly policy_version:
        string;

      readonly required_assurance:
        ControlledCode;
    };

export class ApproveCapaScopeConfigurationError
  extends Error {
  constructor(
    message:
      string,
  ) {
    super(message);
    this.name =
      "ApproveCapaScopeConfigurationError";
  }
}

export class ApproveCapaScopeIdempotencyConfigurationError
  extends Error {
  constructor() {
    super(
      "CAPA scope approval requires a valid idempotency key.",
    );

    this.name =
      "ApproveCapaScopeIdempotencyConfigurationError";
  }
}

export class ApproveCapaScopeIntegrityError
  extends Error {
  constructor(
    message =
      "CAPA scope approval encountered an inconsistent controlled record.",
  ) {
    super(message);

    this.name =
      "ApproveCapaScopeIntegrityError";
  }
}

export class ApproveCapaScopeReplayIntegrityError
  extends Error {
  constructor() {
    super(
      "Committed CAPA scope approval could not be reconstructed safely.",
    );

    this.name =
      "ApproveCapaScopeReplayIntegrityError";
  }
}

class ApproveCapaScopeConcurrencyError
  extends Error {
  constructor(
    readonly reason_code:
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  ) {
    super(
      "The CAPA changed before G-01 scope approval could be committed.",
    );

    this.name =
      "ApproveCapaScopeConcurrencyError";
  }
}

class ApproveCapaScopeWorkflowConflictError
  extends Error {
  constructor() {
    super(
      "G-01 scope approval is permitted only from S10.",
    );

    this.name =
      "ApproveCapaScopeWorkflowConflictError";
  }
}

function controlled(
  value:
    string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(
  value:
    Date,
): IsoDateTime {
  return value.toISOString() as
    IsoDateTime;
}

function isPlainObject(
  value:
    unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasExactKeys(
  value:
    Record<string, unknown>,

  expected:
    readonly string[],
): boolean {
  const actual =
    Object.keys(value);

  return (
    actual.length ===
      expected.length &&
    expected.every(
      (key) =>
        Object.prototype
          .hasOwnProperty.call(
            value,
            key,
          ),
    )
  );
}

function isTrimmedText(
  value:
    unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value
  );
}

function validateConfiguration(
  configuration:
    ApproveCapaScopeConfiguration,
): void {
  if (
    !isTrimmedText(
      configuration.workflow_version,
    )
  ) {
    throw new ApproveCapaScopeConfigurationError(
      "workflow_version must be a non-empty controlled value.",
    );
  }

  if (
    !isTrimmedText(
      configuration.audit_schema_version,
    )
  ) {
    throw new ApproveCapaScopeConfigurationError(
      "audit_schema_version must be a non-empty controlled value.",
    );
  }

  if (
    !Number.isFinite(
      configuration
        .step_up_maximum_age_ms,
    ) ||
    configuration
      .step_up_maximum_age_ms < 0
  ) {
    throw new ApproveCapaScopeConfigurationError(
      "step_up_maximum_age_ms must be a non-negative finite number.",
    );
  }

  if (
    !isTrimmedText(
      configuration
        .required_step_up_assurance,
    )
  ) {
    throw new ApproveCapaScopeConfigurationError(
      "required_step_up_assurance must be a non-empty controlled value.",
    );
  }

  if (
    typeof configuration
      .approval_rationale_required !==
    "boolean"
  ) {
    throw new ApproveCapaScopeConfigurationError(
      "approval_rationale_required must be boolean.",
    );
  }
}

function validateBody(
  body:
    unknown,

  rationaleRequired:
    boolean,
):
  | {
      readonly status:
        "valid";

      readonly value:
        ValidatedApprovalBody;
    }
  | {
      readonly status:
        "invalid";

      readonly reason_code:
        | "INVALID_REQUEST_BODY"
        | "INVALID_SCOPE"
        | "INVALID_APPROVAL"
        | "INVALID_APPROVAL_CONFIRMATION"
        | "APPROVAL_RATIONALE_REQUIRED";

      readonly scope_reason_code?:
        string;
    } {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(
      body,
      [
        "scope",
        "approval",
      ],
    )
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_REQUEST_BODY",
    };
  }

  const scopeResult =
    validateCapaScopeContent(
      body.scope,
    );

  if (
    scopeResult.status ===
    "invalid"
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_SCOPE",
      scope_reason_code:
        scopeResult.reason_code,
    };
  }

  if (
    !isPlainObject(
      body.approval,
    ) ||
    !hasExactKeys(
      body.approval,
      [
        "decision",
        "confirmation",
        "rationale",
      ],
    ) ||
    body.approval.decision !==
      "approve"
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_APPROVAL",
    };
  }

  if (
    body.approval.confirmation !==
    CAPA_SCOPE_APPROVAL_CONFIRMATION
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_APPROVAL_CONFIRMATION",
    };
  }

  const rationale =
    body.approval.rationale;

  if (
    rationale !== null &&
    !isTrimmedText(rationale)
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_APPROVAL",
    };
  }

  if (
    rationaleRequired &&
    rationale === null
  ) {
    return {
      status: "invalid",
      reason_code:
        "APPROVAL_RATIONALE_REQUIRED",
    };
  }

  return {
    status: "valid",
    value: Object.freeze({
      scope:
        scopeResult.value,
      approval:
        Object.freeze({
          decision:
            "approve" as const,
          confirmation:
            CAPA_SCOPE_APPROVAL_CONFIRMATION,
          rationale,
        }),
    }),
  };
}

function requireIdempotencyKey(
  trace:
    RequestTrace,
): IdempotencyKey {
  const key =
    trace.idempotency_key;

  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length >
      IDEMPOTENCY_KEY_MAXIMUM_LENGTH ||
    key.trim() !== key
  ) {
    throw new ApproveCapaScopeIdempotencyConfigurationError();
  }

  return key;
}

function scopeRecord(
  scope:
    CapaScopeContent,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    problem_statement:
      scope.problem_statement,

    scope_dimensions:
      scope.scope_dimensions,

    affected_scope_elements:
      scope.affected_scope_elements,

    included_scope:
      scope.included_scope,

    exclusions:
      scope.exclusions,

    extent_summary:
      scope.extent_summary,

    priority:
      scope.priority,

    target_dates:
      scope.target_dates,

    applicability:
      scope.applicability,

    source_reference:
      scope.source_reference,

    evidence_references:
      scope.evidence_references,

    unresolved_scope_gaps:
      scope.unresolved_scope_gaps,

    required_escalations:
      scope.required_escalations,
  });
}

function requestFingerprint(
  dependencies:
    ApproveCapaScopeDependencies,

  command:
    ApproveCapaScopeCommand,

  validated:
    ValidatedApprovalBody,
): CapaWorkflowRequestFingerprint {
  const canonicalRequest = {
    fingerprint_version:
      FINGERPRINT_VERSION,

    organization_id:
      command.tenant
        .organization_id,

    capa_case_id:
      command.capa_case_id,

    operation_code:
      OPERATION_CODE,

    gate:
      GATE_CODE,

    expected_record_version:
      command.expected_record_version,

    expected_current_version_id:
      command
        .expected_current_version_id,

    scope:
      scopeRecord(
        validated.scope,
      ),

    approval:
      validated.approval,

    configuration: {
      workflow_version:
        dependencies.configuration
          .workflow_version,

      scope_schema_version:
        CAPA_SCOPE_SCHEMA_VERSION,

      audit_schema_version:
        dependencies.configuration
          .audit_schema_version,

      approval_rationale_required:
        dependencies.configuration
          .approval_rationale_required,
    },
  };

  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalRequest,
      ),
      "utf8",
    )
    .digest("hex") as
      CapaWorkflowRequestFingerprint;
}

function requireSourceVersion(
  capaCase:
    CapaCase,

  sourceVersion:
    CapaCaseVersion | null,

  command:
    ApproveCapaScopeCommand,
): CapaCaseVersion {
  if (
    sourceVersion === null ||
    sourceVersion.organization_id !==
      command.tenant
        .organization_id ||
    sourceVersion.capa_case_id !==
      capaCase.capa_case_id ||
    sourceVersion.case_version_id !==
      command
        .expected_current_version_id ||
    sourceVersion.status !==
      SOURCE_STATE ||
    sourceVersion.version_number !==
      command.expected_record_version
  ) {
    throw new ApproveCapaScopeIntegrityError(
      "The reviewed S10 source version could not be verified.",
    );
  }

  return sourceVersion;
}

interface ScopeSectionResolution {
  readonly source_sections:
    readonly CapaSectionVersion[];

  readonly prior_scope_section:
    CapaSectionVersion | null;
}

async function resolveSourceSections(
  dependencies:
    ApproveCapaScopeDependencies,

  organizationId:
    CapaCase["organization_id"],

  capaCaseId:
    CapaCaseId,

  sourceVersion:
    CapaCaseVersion,
): Promise<ScopeSectionResolution> {
  const sourceSections =
    await Promise.all(
      sourceVersion
        .section_version_ids
        .map(
          (sectionVersionId) =>
            dependencies
              .capa_repository
              .findSectionVersionById(
                organizationId,
                capaCaseId,
                sectionVersionId,
              ),
        ),
    );

  if (
    sourceSections.some(
      (section) =>
        section === null,
    )
  ) {
    throw new ApproveCapaScopeIntegrityError(
      "A referenced S10 section version is missing.",
    );
  }

  const verifiedSections:
    CapaSectionVersion[] = [];

  for (
    let index = 0;
    index <
      sourceSections.length;
    index += 1
  ) {
    const section =
      sourceSections[index];

    const expectedId =
      sourceVersion
        .section_version_ids[
          index
        ];

    if (
      section === null ||
      expectedId === undefined ||
      section.organization_id !==
        organizationId ||
      section.capa_case_id !==
        capaCaseId ||
      section.section_version_id !==
        expectedId
    ) {
      throw new ApproveCapaScopeIntegrityError(
        "The S10 section snapshot failed integrity validation.",
      );
    }

    verifiedSections.push(
      section,
    );
  }

  const scopeSections =
    verifiedSections.filter(
      (section) =>
        section.section_type ===
        CAPA_SCOPE_SECTION_TYPE,
    );

  if (
    scopeSections.length > 1
  ) {
    throw new ApproveCapaScopeIntegrityError(
      "The S10 snapshot references multiple CAPA scope sections.",
    );
  }

  return Object.freeze({
    source_sections:
      Object.freeze(
        verifiedSections,
      ),

    prior_scope_section:
      scopeSections[0] ??
      null,
  });
}

function nextSectionSnapshot(
  sourceVersion:
    CapaCaseVersion,

  priorScopeSection:
    CapaSectionVersion | null,

  nextScopeSectionId:
    CapaSectionVersionId,
): readonly CapaSectionVersionId[] {
  if (
    priorScopeSection === null
  ) {
    return Object.freeze([
      ...sourceVersion
        .section_version_ids,
      nextScopeSectionId,
    ]);
  }

  let replacementCount = 0;

  const next =
    sourceVersion
      .section_version_ids
      .map(
        (sectionVersionId) => {
          if (
            sectionVersionId ===
            priorScopeSection
              .section_version_id
          ) {
            replacementCount += 1;
            return nextScopeSectionId;
          }

          return sectionVersionId;
        },
      );

  if (replacementCount !== 1) {
    throw new ApproveCapaScopeIntegrityError(
      "Prior CAPA scope section could not be replaced safely.",
    );
  }

  return Object.freeze(next);
}

function auditEventIdFromMetadata(
  value:
    unknown,
): AuditEventId {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value)
  ) {
    throw new ApproveCapaScopeReplayIntegrityError();
  }

  return value as
    AuditEventId;
}

async function replayApproval(
  dependencies:
    ApproveCapaScopeDependencies,

  record:
    CapaWorkflowIdempotencyRecord,
): Promise<ApproveCapaScopeResult> {
  const capaCase =
    await dependencies
      .capa_repository
      .findCaseById(
        record.organization_id,
        record.capa_case_id,
      );

  const resultingVersion =
    await dependencies
      .capa_repository
      .findCaseVersionById(
        record.organization_id,
        record.capa_case_id,
        record.resulting_case_version_id,
      );

  const approvalEvent =
    await dependencies
      .audit_repository
      .findEventById(
        record.organization_id,
        record.audit_event_id,
      );

  if (
    capaCase === null ||
    resultingVersion === null ||
    approvalEvent === null ||
    resultingVersion
      .capa_case_id !==
      record.capa_case_id ||
    resultingVersion
      .case_version_id !==
      record
        .resulting_case_version_id ||
    resultingVersion
      .parent_version_id !==
      record.source_case_version_id ||
    resultingVersion.status !==
      TARGET_STATE ||
    approvalEvent.event_id !==
      record.audit_event_id ||
    approvalEvent.event_type !==
      "EVT-APPROVAL" ||
    approvalEvent.aggregate_type !==
      "CAPA_CASE" ||
    approvalEvent.aggregate_id !==
      record.capa_case_id ||
    approvalEvent.target
      .object_version_id !==
      resultingVersion
        .case_version_id ||
    approvalEvent.action !==
      OPERATION_CODE ||
    approvalEvent.metadata.gate !==
      GATE_CODE ||
    approvalEvent.metadata.decision !==
      "approved"
  ) {
    throw new ApproveCapaScopeReplayIntegrityError();
  }

  const resultingSections =
    await Promise.all(
      resultingVersion
        .section_version_ids
        .map(
          (sectionVersionId) =>
            dependencies
              .capa_repository
              .findSectionVersionById(
                record.organization_id,
                record.capa_case_id,
                sectionVersionId,
              ),
        ),
    );

  const scopeSections =
    resultingSections.filter(
      (
        section,
      ): section is
        CapaSectionVersion =>
        section !== null &&
        section.organization_id ===
          record.organization_id &&
        section.capa_case_id ===
          record.capa_case_id &&
        section.section_type ===
          CAPA_SCOPE_SECTION_TYPE &&
        section.schema_version ===
          CAPA_SCOPE_SCHEMA_VERSION,
    );

  if (
    resultingSections.some(
      (section) =>
        section === null,
    ) ||
    scopeSections.length !== 1
  ) {
    throw new ApproveCapaScopeReplayIntegrityError();
  }

  const scopeSection =
    scopeSections[0];

  if (
    scopeSection === undefined ||
    approvalEvent.metadata
      .scope_section_version_id !==
      scopeSection
        .section_version_id
  ) {
    throw new ApproveCapaScopeReplayIntegrityError();
  }

  const transitionEventId =
    auditEventIdFromMetadata(
      approvalEvent.metadata
        .state_transition_event_id,
    );

  const transitionEvent =
    await dependencies
      .audit_repository
      .findEventById(
        record.organization_id,
        transitionEventId,
      );

  if (
    transitionEvent === null ||
    transitionEvent.event_id !==
      transitionEventId ||
    transitionEvent.event_type !==
      "EVT-STATE-TRANSITION" ||
    transitionEvent.aggregate_type !==
      "CAPA_CASE" ||
    transitionEvent.aggregate_id !==
      record.capa_case_id ||
    transitionEvent.target
      .object_version_id !==
      resultingVersion
        .case_version_id ||
    transitionEvent.action !==
      OPERATION_CODE ||
    transitionEvent.metadata.gate !==
      GATE_CODE ||
    transitionEvent.metadata
      .approval_event_id !==
      record.audit_event_id
  ) {
    throw new ApproveCapaScopeReplayIntegrityError();
  }

  return {
    status:
      "already_approved",

    capa_case:
      capaCase,

    case_version:
      resultingVersion,

    scope_section_version:
      scopeSection,

    approval_audit_event_id:
      record.audit_event_id,

    transition_audit_event_id:
      transitionEventId,
  };
}

export async function approveCapaScope(
  dependencies:
    ApproveCapaScopeDependencies,

  command:
    ApproveCapaScopeCommand,
): Promise<ApproveCapaScopeResult> {
  validateConfiguration(
    dependencies.configuration,
  );

  const validatedBody =
    validateBody(
      command.body,
      dependencies.configuration
        .approval_rationale_required,
    );

  if (
    validatedBody.status ===
    "invalid"
  ) {
    return {
      status:
        "validation_failed",

      reason_code:
        validatedBody.reason_code,

      ...(validatedBody
        .scope_reason_code ===
      undefined
        ? {}
        : {
            scope_reason_code:
              validatedBody
                .scope_reason_code,
          }),
    };
  }

  const gatePrerequisites =
    evaluateCapaScopeGatePrerequisites(
      validatedBody.value.scope,
    );

  if (
    gatePrerequisites.status ===
    "blocked"
  ) {
    return {
      status:
        "gate_blocked",

      blocker_codes:
        gatePrerequisites
          .blocker_codes,
    };
  }

  const trustedNow =
    dependencies.clock.now();

  if (
    !Number.isFinite(
      trustedNow.getTime(),
    )
  ) {
    throw new ApproveCapaScopeConfigurationError(
      "Trusted server time is invalid.",
    );
  }

  const organizationId =
    command.tenant
      .organization_id;

  const precondition =
    evaluateCapaAuthorizationPreconditions({
      authentication:
        command.authentication,

      tenant:
        command.tenant,

      resource: {
        organization_id:
          organizationId,
      },

      operation:
        "approve_scope",

      trusted_now:
        trustedNow,

      step_up_maximum_age_ms:
        dependencies.configuration
          .step_up_maximum_age_ms,
    });

  if (
    precondition.status ===
    "denied"
  ) {
    if (
      precondition.reason_code ===
      "STEP_UP_REAUTHENTICATION_REQUIRED"
    ) {
      return {
        status:
          "step_up_required",

        reason_code:
          precondition.reason_code,

        policy_version:
          precondition
            .authorization_policy_version,

        required_assurance:
          dependencies.configuration
            .required_step_up_assurance,
      };
    }

    return {
      status:
        "authorization_denied",

      reason_code:
        precondition.reason_code,

      policy_version:
        precondition
          .authorization_policy_version,
    };
  }

  const principal =
    command.authentication
      .principal;

  if (
    principal.principal_type !==
    "human"
  ) {
    return {
      status:
        "authorization_denied",

      reason_code:
        "AUTHORIZED_HUMAN_REQUIRED",

      policy_version:
        command.tenant
          .authorization_policy_version,
    };
  }

  const capaCase =
    await dependencies
      .capa_repository
      .findCaseById(
        organizationId,
        command.capa_case_id,
      );

  if (
    capaCase === null
  ) {
    return {
      status:
        "not_found_or_not_authorized",
    };
  }

  if (
    capaCase.organization_id !==
    organizationId
  ) {
    throw new ApproveCapaScopeIntegrityError();
  }

  const sourceVersion =
    requireSourceVersion(
      capaCase,
      await dependencies
        .capa_repository
        .findCaseVersionById(
          organizationId,
          capaCase.capa_case_id,
          command
            .expected_current_version_id,
        ),
      command,
    );

  const policyDecision =
    await dependencies
      .authorization_policy
      .evaluate({
        authentication:
          command.authentication,

        tenant:
          command.tenant,

        operation:
          "approve_scope",

        resource: {
          organization_id:
            organizationId,

          resource_type:
            controlled(
              "CAPA_CASE",
            ),

          resource_id:
            capaCase.capa_case_id,

          resource_version_id:
            sourceVersion
              .case_version_id,

          capa_case_id:
            capaCase.capa_case_id,

          case_version_id:
            sourceVersion
              .case_version_id,

          workflow_state:
            sourceVersion.status,
        },

        purpose:
          controlled(
            AUTHORIZATION_PURPOSE,
          ),

        trusted_now:
          trustedNow,
      });

  if (
    policyDecision.decision ===
    "deny"
  ) {
    return {
      status:
        "authorization_denied",

      reason_code:
        policyDecision
          .reason_code,

      policy_version:
        policyDecision
          .policy_version,
    };
  }

  if (
    policyDecision.decision ===
    "step_up"
  ) {
    return {
      status:
        "step_up_required",

      reason_code:
        policyDecision
          .reason_code,

      policy_version:
        policyDecision
          .policy_version,

      required_assurance:
        policyDecision
          .required_assurance,
    };
  }

  const sectionResolution =
    await resolveSourceSections(
      dependencies,
      organizationId,
      capaCase.capa_case_id,
      sourceVersion,
    );

  const idempotencyKey =
    requireIdempotencyKey(
      command.request_trace,
    );

  const fingerprint =
    requestFingerprint(
      dependencies,
      command,
      validatedBody.value,
    );

  const nextVersionId =
    dependencies
      .id_generator
      .generateCaseVersionId();

  const scopeSectionVersionId =
    dependencies
      .id_generator
      .generateSectionVersionId();

  const approvalAuditEventId =
    dependencies
      .id_generator
      .generateAuditEventId();

  const transitionAuditEventId =
    dependencies
      .id_generator
      .generateAuditEventId();

  const timestamp =
    iso(trustedNow);

  const actor = {
    actor_type:
      "human" as const,

    actor_id:
      principal.user_id,
  };

  const priorScopeSection =
    sectionResolution
      .prior_scope_section;

  const nextScopeSection:
    CapaSectionVersion = {
    organization_id:
      organizationId,

    section_version_id:
      scopeSectionVersionId,

    capa_case_id:
      capaCase.capa_case_id,

    section_type:
      controlled(
        CAPA_SCOPE_SECTION_TYPE,
      ),

    version_number:
      priorScopeSection === null
        ? 1
        : priorScopeSection
            .version_number + 1,

    ...(priorScopeSection === null
      ? {}
      : {
          parent_version_id:
            priorScopeSection
              .section_version_id,
        }),

    schema_version:
      CAPA_SCOPE_SCHEMA_VERSION,

    content:
      scopeRecord(
        validatedBody.value.scope,
      ),

    change_reason:
      "Record reviewed CAPA scope for G-01 approval",

    effective_at:
      timestamp,

    created_at:
      timestamp,

    created_by:
      actor,
  };

  const nextVersion:
    CapaCaseVersion = {
    organization_id:
      organizationId,

    case_version_id:
      nextVersionId,

    capa_case_id:
      capaCase.capa_case_id,

    version_number:
      sourceVersion
        .version_number + 1,

    parent_version_id:
      sourceVersion
        .case_version_id,

    change_reason:
      "Accept CAPA scope at G-01",

    status:
      TARGET_STATE,

    section_version_ids:
      nextSectionSnapshot(
        sourceVersion,
        priorScopeSection,
        scopeSectionVersionId,
      ),

    effective_at:
      timestamp,

    created_at:
      timestamp,

    created_by:
      actor,
  };

  try {
    const transactionResult =
      await dependencies
        .transaction_manager
        .runInTransaction(
          command.request_trace,

          async (
            transaction,
          ) => {
            const claimRecord:
              CapaWorkflowIdempotencyRecord = {
              organization_id:
                organizationId,

              idempotency_key:
                idempotencyKey,

              operation_code:
                controlled(
                  OPERATION_CODE,
                ),

              request_fingerprint:
                fingerprint,

              capa_case_id:
                capaCase
                  .capa_case_id,

              source_case_version_id:
                sourceVersion
                  .case_version_id,

              resulting_case_version_id:
                nextVersionId,

              /**
               * The approval event is the primary audit identity bound to
               * the workflow claim. It cross-links the second, atomic
               * state-transition event in metadata.
               */
              audit_event_id:
                approvalAuditEventId,
            };

            const claim =
              await dependencies
                .workflow_idempotency_repository
                .claimWorkflowOperation(
                  transaction,
                  claimRecord,
                );

            if (
              claim.status ===
              "conflict"
            ) {
              return {
                kind:
                  "idempotency_conflict" as const,
              };
            }

            if (
              claim.status ===
              "already_claimed"
            ) {
              return {
                kind:
                  "replay" as const,

                record:
                  claim.record,
              };
            }

            if (
              capaCase.status !==
              SOURCE_STATE
            ) {
              throw new ApproveCapaScopeWorkflowConflictError();
            }

            if (
              capaCase.record_version !==
              command
                .expected_record_version
            ) {
              throw new ApproveCapaScopeConcurrencyError(
                "RECORD_VERSION_CONFLICT",
              );
            }

            if (
              capaCase
                .current_version_id !==
              command
                .expected_current_version_id
            ) {
              throw new ApproveCapaScopeConcurrencyError(
                "CURRENT_VERSION_CONFLICT",
              );
            }

            await dependencies
              .capa_repository
              .insertSectionVersion(
                transaction,
                nextScopeSection,
              );

            await dependencies
              .capa_repository
              .insertCaseVersion(
                transaction,
                nextVersion,
              );

            const advanceResult =
              await dependencies
                .capa_repository
                .advanceCurrentVersion(
                  transaction,
                  {
                    organization_id:
                      organizationId,

                    capa_case_id:
                      capaCase
                        .capa_case_id,

                    expected_record_version:
                      command
                        .expected_record_version,

                    expected_current_version_id:
                      command
                        .expected_current_version_id,

                    next_current_version_id:
                      nextVersionId,

                    next_status:
                      TARGET_STATE,

                    updated_at:
                      timestamp,

                    updated_by:
                      actor,
                  },
                );

            if (
              advanceResult.status ===
              "conflict"
            ) {
              throw new ApproveCapaScopeConcurrencyError(
                advanceResult
                  .reason_code,
              );
            }

            const commonConfiguration = {
              workflow:
                dependencies.configuration
                  .workflow_version,

              authorization_policy:
                policyDecision
                  .policy_version,

              scope_schema:
                CAPA_SCOPE_SCHEMA_VERSION,

              audit_schema:
                dependencies.configuration
                  .audit_schema_version,
            };

            const approvalEvent:
              AuditEvent = {
              organization_id:
                organizationId,

              event_id:
                approvalAuditEventId,

              event_type:
                controlled(
                  "EVT-APPROVAL",
                ),

              schema_version:
                dependencies.configuration
                  .audit_schema_version,

              aggregate_type:
                controlled(
                  "CAPA_CASE",
                ),

              aggregate_id:
                capaCase
                  .capa_case_id,

              aggregate_version:
                advanceResult
                  .capa_case
                  .record_version,

              actor,

              occurred_at:
                timestamp,

              request_id:
                command.request_trace
                  .request_id,

              correlation_id:
                command.request_trace
                  .correlation_id,

              idempotency_key:
                idempotencyKey,

              action:
                controlled(
                  OPERATION_CODE,
                ),

              target: {
                object_type:
                  controlled(
                    "CAPA_CASE",
                  ),

                object_id:
                  capaCase
                    .capa_case_id,

                object_version_id:
                  nextVersionId,
              },

              outcome:
                "succeeded",

              ...(validatedBody.value
                .approval
                .rationale === null
                ? {}
                : {
                    reason:
                      validatedBody
                        .value
                        .approval
                        .rationale,
                  }),

              change: {
                before_ref: {
                  object_type:
                    controlled(
                      "CAPA_CASE",
                    ),

                  object_id:
                    capaCase
                      .capa_case_id,

                  object_version_id:
                    sourceVersion
                      .case_version_id,
                },

                after_ref: {
                  object_type:
                    controlled(
                      "CAPA_CASE",
                    ),

                  object_id:
                    capaCase
                      .capa_case_id,

                  object_version_id:
                    nextVersionId,
                },
              },

              configuration_versions:
                commonConfiguration,

              metadata: {
                gate:
                  GATE_CODE,

                decision:
                  "approved",

                decision_meaning:
                  GATE_MEANING,

                confirmation:
                  validatedBody
                    .value
                    .approval
                    .confirmation,

                rationale:
                  validatedBody
                    .value
                    .approval
                    .rationale,

                from_state:
                  SOURCE_STATE,

                to_state:
                  TARGET_STATE,

                scope_section_version_id:
                  scopeSectionVersionId,

                state_transition_event_id:
                  transitionAuditEventId,

                relied_on_role_assignment_ids:
                  policyDecision
                    .relied_on_role_assignment_ids,
              },
            };

            const transitionEvent:
              AuditEvent = {
              organization_id:
                organizationId,

              event_id:
                transitionAuditEventId,

              event_type:
                controlled(
                  "EVT-STATE-TRANSITION",
                ),

              schema_version:
                dependencies.configuration
                  .audit_schema_version,

              aggregate_type:
                controlled(
                  "CAPA_CASE",
                ),

              aggregate_id:
                capaCase
                  .capa_case_id,

              aggregate_version:
                advanceResult
                  .capa_case
                  .record_version,

              actor,

              occurred_at:
                timestamp,

              request_id:
                command.request_trace
                  .request_id,

              correlation_id:
                command.request_trace
                  .correlation_id,

              idempotency_key:
                idempotencyKey,

              action:
                controlled(
                  OPERATION_CODE,
                ),

              target: {
                object_type:
                  controlled(
                    "CAPA_CASE",
                  ),

                object_id:
                  capaCase
                    .capa_case_id,

                object_version_id:
                  nextVersionId,
              },

              outcome:
                "succeeded",

              ...(validatedBody.value
                .approval
                .rationale === null
                ? {}
                : {
                    reason:
                      validatedBody
                        .value
                        .approval
                        .rationale,
                  }),

              change: {
                before_ref: {
                  object_type:
                    controlled(
                      "CAPA_CASE",
                    ),

                  object_id:
                    capaCase
                      .capa_case_id,

                  object_version_id:
                    sourceVersion
                      .case_version_id,
                },

                after_ref: {
                  object_type:
                    controlled(
                      "CAPA_CASE",
                    ),

                  object_id:
                    capaCase
                      .capa_case_id,

                  object_version_id:
                    nextVersionId,
                },
              },

              configuration_versions:
                commonConfiguration,

              metadata: {
                gate:
                  GATE_CODE,

                transition_event:
                  "Accept CAPA scope",

                from_state:
                  SOURCE_STATE,

                to_state:
                  TARGET_STATE,

                confirmation:
                  validatedBody
                    .value
                    .approval
                    .confirmation,

                approval_event_id:
                  approvalAuditEventId,

                scope_section_version_id:
                  scopeSectionVersionId,

                relied_on_role_assignment_ids:
                  policyDecision
                    .relied_on_role_assignment_ids,
              },
            };

            const approvalAuditResult =
              await dependencies
                .audit_repository
                .appendEvent(
                  transaction,
                  approvalEvent,
                );

            if (
              approvalAuditResult
                .status !==
                "appended" ||
              approvalAuditResult
                .event_id !==
                approvalAuditEventId
            ) {
              throw new AuditEventAppendConflictError();
            }

            const transitionAuditResult =
              await dependencies
                .audit_repository
                .appendEvent(
                  transaction,
                  transitionEvent,
                );

            if (
              transitionAuditResult
                .status !==
                "appended" ||
              transitionAuditResult
                .event_id !==
                transitionAuditEventId
            ) {
              throw new AuditEventAppendConflictError();
            }

            return {
              kind:
                "approved" as const,

              completion: {
                capa_case:
                  advanceResult
                    .capa_case,

                case_version:
                  nextVersion,

                scope_section_version:
                  nextScopeSection,

                approval_audit_event_id:
                  approvalAuditEventId,

                transition_audit_event_id:
                  transitionAuditEventId,
              },
            };
          },
        );

    if (
      transactionResult.kind ===
      "idempotency_conflict"
    ) {
      return {
        status:
          "idempotency_conflict",

        reason_code:
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      };
    }

    if (
      transactionResult.kind ===
      "replay"
    ) {
      return replayApproval(
        dependencies,
        transactionResult.record,
      );
    }

    return {
      status:
        "approved",

      ...transactionResult
        .completion,
    };
  } catch (error) {
    if (
      error instanceof
      ApproveCapaScopeConcurrencyError
    ) {
      return {
        status:
          "concurrency_conflict",

        reason_code:
          error.reason_code,
      };
    }

    if (
      error instanceof
      ApproveCapaScopeWorkflowConflictError
    ) {
      return {
        status:
          "workflow_conflict",

        reason_code:
          "WORKFLOW_STATE_NOT_ALLOWED",
      };
    }

    throw error;
  }
}
