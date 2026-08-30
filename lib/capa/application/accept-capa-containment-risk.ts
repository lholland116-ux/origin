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
  CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
  CAPA_CONTAINMENT_RISK_SECTION_TYPE,
  evaluateCapaContainmentRiskGatePrerequisites,
  validateCapaContainmentRiskContent,
  type CapaContainmentRiskContent,
  type CapaContainmentRiskGateBlockerCode,
} from "../domain/capa-containment-risk";

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
 * Human-controlled G-02 CAPA containment/risk acceptance.
 *
 * Controlled sources:
 * - LVT-CAPA-URS-003 — URS-RISK-001 through URS-RISK-010
 * - LVT-CAPA-WFS-004 — S20, G-02, WFR controls
 * - LVT-CAPA-HRUI-005 — G-02 gate decision interface
 *
 * Regulatory design context:
 * - FDA Quality Management System Regulation (QMSR)
 * - ISO 13485:2016 section 8.5.2
 * - former 21 CFR 820.100 retained as a legacy CAPA cross-reference
 *
 * This service never delegates workflow authority to AI. Only an
 * authenticated, authorized human satisfying configured step-up controls
 * may execute the S20 -> S30 transition.
 */

const SOURCE_STATE =
  CAPA_STATE.CONTAINMENT_AND_IMPACT_RISK;

const TARGET_STATE =
  CAPA_STATE
    .INVESTIGATION_PLANNING;

const OPERATION_CODE =
  "ACCEPT_CAPA_CONTAINMENT_RISK";

const AUTHORIZATION_PURPOSE =
  "CAPA_GATE_DECISION";

const GATE_CODE =
  "G-02";

const GATE_MEANING =
  "Immediate controls, impact/risk, and required escalations are reviewable and accepted.";

export const CAPA_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMATION =
  "G02_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMED" as const;

const FINGERPRINT_VERSION =
  "accept-capa-containment-risk-fingerprint-1";

const IDEMPOTENCY_KEY_MAXIMUM_LENGTH =
  128;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AcceptCapaContainmentRiskConfiguration {
  readonly workflow_version:
    string;

  readonly audit_schema_version:
    string;

  readonly step_up_maximum_age_ms:
    number;

  readonly required_step_up_assurance:
    ControlledCode;

  /**
   * Pilot configuration may require rationale for every positive G-02
   * decision even though the UI baseline permits configurable rationale.
   */
  readonly approval_rationale_required:
    boolean;
}

export interface AcceptCapaContainmentRiskCommand {
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

export interface AcceptCapaContainmentRiskDependencies {
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
    AcceptCapaContainmentRiskConfiguration;
}

interface CapaContainmentRiskAcceptanceDecision {
  readonly decision:
    "approve";

  readonly confirmation:
    typeof CAPA_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMATION;

  readonly rationale:
    string | null;
}

interface ValidatedAcceptanceBody {
  readonly containment_risk:
    CapaContainmentRiskContent;

  readonly approval:
    CapaContainmentRiskAcceptanceDecision;
}

interface CompletedContainmentRiskAcceptance {
  readonly capa_case:
    CapaCase;

  readonly case_version:
    CapaCaseVersion;

  readonly containment_risk_section_version:
    CapaSectionVersion;

  readonly approval_audit_event_id:
    AuditEventId;

  readonly transition_audit_event_id:
    AuditEventId;
}

export type AcceptCapaContainmentRiskResult =
  | ({
      readonly status:
        "approved";
    } & CompletedContainmentRiskAcceptance)
  | ({
      readonly status:
        "already_approved";
    } & CompletedContainmentRiskAcceptance)
  | {
      readonly status:
        "validation_failed";

      readonly reason_code:
        | "INVALID_REQUEST_BODY"
        | "INVALID_CONTAINMENT_RISK"
        | "INVALID_APPROVAL"
        | "INVALID_APPROVAL_CONFIRMATION"
        | "APPROVAL_RATIONALE_REQUIRED";

      readonly containment_risk_reason_code?:
        string;
    }
  | {
      readonly status:
        "gate_blocked";

      readonly blocker_codes:
        readonly CapaContainmentRiskGateBlockerCode[];
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

export class AcceptCapaContainmentRiskConfigurationError
  extends Error {
  constructor(
    message:
      string,
  ) {
    super(message);
    this.name =
      "AcceptCapaContainmentRiskConfigurationError";
  }
}

export class AcceptCapaContainmentRiskIdempotencyConfigurationError
  extends Error {
  constructor() {
    super(
      "CAPA containment/risk acceptance requires a valid idempotency key.",
    );

    this.name =
      "AcceptCapaContainmentRiskIdempotencyConfigurationError";
  }
}

export class AcceptCapaContainmentRiskIntegrityError
  extends Error {
  constructor(
    message =
      "CAPA containment/risk acceptance encountered an inconsistent controlled record.",
  ) {
    super(message);

    this.name =
      "AcceptCapaContainmentRiskIntegrityError";
  }
}

export class AcceptCapaContainmentRiskReplayIntegrityError
  extends Error {
  constructor() {
    super(
      "Committed CAPA containment/risk acceptance could not be reconstructed safely.",
    );

    this.name =
      "AcceptCapaContainmentRiskReplayIntegrityError";
  }
}

class AcceptCapaContainmentRiskConcurrencyError
  extends Error {
  constructor(
    readonly reason_code:
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  ) {
    super(
      "The CAPA changed before G-02 containment/risk acceptance could be committed.",
    );

    this.name =
      "AcceptCapaContainmentRiskConcurrencyError";
  }
}

class AcceptCapaContainmentRiskWorkflowConflictError
  extends Error {
  constructor() {
    super(
      "G-02 containment/risk acceptance is permitted only from S20.",
    );

    this.name =
      "AcceptCapaContainmentRiskWorkflowConflictError";
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
    AcceptCapaContainmentRiskConfiguration,
): void {
  if (
    !isTrimmedText(
      configuration.workflow_version,
    )
  ) {
    throw new AcceptCapaContainmentRiskConfigurationError(
      "workflow_version must be a non-empty controlled value.",
    );
  }

  if (
    !isTrimmedText(
      configuration.audit_schema_version,
    )
  ) {
    throw new AcceptCapaContainmentRiskConfigurationError(
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
    throw new AcceptCapaContainmentRiskConfigurationError(
      "step_up_maximum_age_ms must be a non-negative finite number.",
    );
  }

  if (
    !isTrimmedText(
      configuration
        .required_step_up_assurance,
    )
  ) {
    throw new AcceptCapaContainmentRiskConfigurationError(
      "required_step_up_assurance must be a non-empty controlled value.",
    );
  }

  if (
    typeof configuration
      .approval_rationale_required !==
    "boolean"
  ) {
    throw new AcceptCapaContainmentRiskConfigurationError(
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
        ValidatedAcceptanceBody;
    }
  | {
      readonly status:
        "invalid";

      readonly reason_code:
        | "INVALID_REQUEST_BODY"
        | "INVALID_CONTAINMENT_RISK"
        | "INVALID_APPROVAL"
        | "INVALID_APPROVAL_CONFIRMATION"
        | "APPROVAL_RATIONALE_REQUIRED";

      readonly containment_risk_reason_code?:
        string;
    } {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(
      body,
      [
        "containment_risk",
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

  const containmentRiskResult =
    validateCapaContainmentRiskContent(
      body.containment_risk,
    );

  if (
    containmentRiskResult.status ===
    "invalid"
  ) {
    return {
      status: "invalid",
      reason_code:
        "INVALID_CONTAINMENT_RISK",
      containment_risk_reason_code:
        containmentRiskResult.reason_code,
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
    CAPA_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMATION
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
      containment_risk:
        containmentRiskResult.value,
      approval:
        Object.freeze({
          decision:
            "approve" as const,
          confirmation:
            CAPA_CONTAINMENT_RISK_ACCEPTANCE_CONFIRMATION,
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
    throw new AcceptCapaContainmentRiskIdempotencyConfigurationError();
  }

  return key;
}

function containmentRiskRecord(
  containmentRisk:
    CapaContainmentRiskContent,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    actions: containmentRisk.actions,
    impact_scope: containmentRisk.impact_scope,
    risk_evaluation: containmentRisk.risk_evaluation,
    missing_risk_information:
      containmentRisk.missing_risk_information,
    escalations: containmentRisk.escalations,
  });
}

function requestFingerprint(
  dependencies:
    AcceptCapaContainmentRiskDependencies,

  command:
    AcceptCapaContainmentRiskCommand,

  validated:
    ValidatedAcceptanceBody,
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

    containment_risk:
      containmentRiskRecord(
        validated.containment_risk,
      ),

    approval:
      validated.approval,

    configuration: {
      workflow_version:
        dependencies.configuration
          .workflow_version,

      containment_risk_schema_version:
        CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,

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
    AcceptCapaContainmentRiskCommand,
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
      SOURCE_STATE
  ) {
    throw new AcceptCapaContainmentRiskIntegrityError(
      "The reviewed S20 source version could not be verified.",
    );
  }

  return sourceVersion;
}

interface ContainmentRiskSectionResolution {
  readonly source_sections:
    readonly CapaSectionVersion[];

  readonly prior_containment_risk_section:
    CapaSectionVersion | null;
}

async function resolveSourceSections(
  dependencies:
    AcceptCapaContainmentRiskDependencies,

  organizationId:
    CapaCase["organization_id"],

  capaCaseId:
    CapaCaseId,

  sourceVersion:
    CapaCaseVersion,
): Promise<ContainmentRiskSectionResolution> {
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
    throw new AcceptCapaContainmentRiskIntegrityError(
      "A referenced S20 section version is missing.",
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
      throw new AcceptCapaContainmentRiskIntegrityError(
        "The S20 section snapshot failed integrity validation.",
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
        CAPA_CONTAINMENT_RISK_SECTION_TYPE,
    );

  if (
    scopeSections.length > 1
  ) {
    throw new AcceptCapaContainmentRiskIntegrityError(
      "The S20 snapshot references multiple CAPA containment/risk sections.",
    );
  }

  return Object.freeze({
    source_sections:
      Object.freeze(
        verifiedSections,
      ),

    prior_containment_risk_section:
      scopeSections[0] ??
      null,
  });
}

function nextSectionSnapshot(
  sourceVersion:
    CapaCaseVersion,

  priorContainmentRiskSection:
    CapaSectionVersion | null,

  nextContainmentRiskSectionId:
    CapaSectionVersionId,
): readonly CapaSectionVersionId[] {
  if (
    priorContainmentRiskSection === null
  ) {
    return Object.freeze([
      ...sourceVersion
        .section_version_ids,
      nextContainmentRiskSectionId,
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
            priorContainmentRiskSection
              .section_version_id
          ) {
            replacementCount += 1;
            return nextContainmentRiskSectionId;
          }

          return sectionVersionId;
        },
      );

  if (replacementCount !== 1) {
    throw new AcceptCapaContainmentRiskIntegrityError(
      "Prior CAPA containment/risk section could not be replaced safely.",
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
    throw new AcceptCapaContainmentRiskReplayIntegrityError();
  }

  return value as
    AuditEventId;
}

async function replayApproval(
  dependencies:
    AcceptCapaContainmentRiskDependencies,

  record:
    CapaWorkflowIdempotencyRecord,
): Promise<AcceptCapaContainmentRiskResult> {
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
    throw new AcceptCapaContainmentRiskReplayIntegrityError();
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
          CAPA_CONTAINMENT_RISK_SECTION_TYPE &&
        section.schema_version ===
          CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,
    );

  if (
    resultingSections.some(
      (section) =>
        section === null,
    ) ||
    scopeSections.length !== 1
  ) {
    throw new AcceptCapaContainmentRiskReplayIntegrityError();
  }

  const scopeSection =
    scopeSections[0];

  if (
    scopeSection === undefined ||
    approvalEvent.metadata
      .containment_risk_section_version_id !==
      scopeSection
        .section_version_id
  ) {
    throw new AcceptCapaContainmentRiskReplayIntegrityError();
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
    throw new AcceptCapaContainmentRiskReplayIntegrityError();
  }

  return {
    status:
      "already_approved",

    capa_case:
      capaCase,

    case_version:
      resultingVersion,

    containment_risk_section_version:
      scopeSection,

    approval_audit_event_id:
      record.audit_event_id,

    transition_audit_event_id:
      transitionEventId,
  };
}

export async function acceptCapaContainmentRisk(
  dependencies:
    AcceptCapaContainmentRiskDependencies,

  command:
    AcceptCapaContainmentRiskCommand,
): Promise<AcceptCapaContainmentRiskResult> {
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
        .containment_risk_reason_code ===
      undefined
        ? {}
        : {
            containment_risk_reason_code:
              validatedBody
                .containment_risk_reason_code,
          }),
    };
  }

  const trustedNow =
    dependencies.clock.now();

  if (
    !Number.isFinite(
      trustedNow.getTime(),
    )
  ) {
    throw new AcceptCapaContainmentRiskConfigurationError(
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
        "accept_containment_risk",

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
    throw new AcceptCapaContainmentRiskIntegrityError();
  }

  const candidateSourceVersion =
    await dependencies
      .capa_repository
      .findCaseVersionById(
        organizationId,
        capaCase.capa_case_id,
        command
          .expected_current_version_id,
      );

  if (
    candidateSourceVersion === null
  ) {
    return {
      status:
        "not_found_or_not_authorized",
    };
  }

  /*
   * The repository lookup is tenant- and case-scoped. Structural ownership
   * mismatches indicate repository corruption, not a caller-visible
   * concurrency condition.
   */
  if (
    candidateSourceVersion
      .organization_id !==
      organizationId ||
    candidateSourceVersion
      .capa_case_id !==
      capaCase.capa_case_id
  ) {
    throw new AcceptCapaContainmentRiskIntegrityError();
  }

  const policyDecision =
    await dependencies
      .authorization_policy
      .evaluate({
        authentication:
          command.authentication,

        tenant:
          command.tenant,

        operation:
          "accept_containment_risk",

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
            candidateSourceVersion
              .case_version_id,

          capa_case_id:
            capaCase.capa_case_id,

          case_version_id:
            candidateSourceVersion
              .case_version_id,

          workflow_state:
            candidateSourceVersion.status,
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

  /*
   * Only an authorized human reviewer may receive controlled source-version
   * or G-02 prerequisite outcomes. Exact idempotent replay remains possible
   * because the original immutable S20 source version is retained.
   */
  const sourceVersion =
    requireSourceVersion(
      capaCase,
      candidateSourceVersion,
      command,
    );

  if (
    sourceVersion.version_number !==
      command.expected_record_version
  ) {
    return {
      status: "concurrency_conflict",
      reason_code: "RECORD_VERSION_CONFLICT",
    };
  }

  const gatePrerequisites =
    evaluateCapaContainmentRiskGatePrerequisites(
      validatedBody.value.containment_risk,
      trustedNow.toISOString().slice(0, 10),
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

  const containmentRiskSectionVersionId =
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

  const priorContainmentRiskSection =
    sectionResolution
      .prior_containment_risk_section;

  const nextContainmentRiskSection:
    CapaSectionVersion = {
    organization_id:
      organizationId,

    section_version_id:
      containmentRiskSectionVersionId,

    capa_case_id:
      capaCase.capa_case_id,

    section_type:
      controlled(
        CAPA_CONTAINMENT_RISK_SECTION_TYPE,
      ),

    version_number:
      priorContainmentRiskSection === null
        ? 1
        : priorContainmentRiskSection
            .version_number + 1,

    ...(priorContainmentRiskSection === null
      ? {}
      : {
          parent_version_id:
            priorContainmentRiskSection
              .section_version_id,
        }),

    schema_version:
      CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,

    content:
      containmentRiskRecord(
        validatedBody.value.containment_risk,
      ),

    change_reason:
      "Record reviewed CAPA containment/risk for G-02 approval",

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
      "Accept CAPA containment/risk at G-02",

    status:
      TARGET_STATE,

    section_version_ids:
      nextSectionSnapshot(
        sourceVersion,
        priorContainmentRiskSection,
        containmentRiskSectionVersionId,
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
              throw new AcceptCapaContainmentRiskWorkflowConflictError();
            }

            if (
              capaCase.record_version !==
              command
                .expected_record_version
            ) {
              throw new AcceptCapaContainmentRiskConcurrencyError(
                "RECORD_VERSION_CONFLICT",
              );
            }

            if (
              capaCase
                .current_version_id !==
              command
                .expected_current_version_id
            ) {
              throw new AcceptCapaContainmentRiskConcurrencyError(
                "CURRENT_VERSION_CONFLICT",
              );
            }

            await dependencies
              .capa_repository
              .insertSectionVersion(
                transaction,
                nextContainmentRiskSection,
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
              throw new AcceptCapaContainmentRiskConcurrencyError(
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

              containment_risk_schema:
                CAPA_CONTAINMENT_RISK_SCHEMA_VERSION,

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

                containment_risk_section_version_id:
                  containmentRiskSectionVersionId,

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
                  "Accept containment and risk",

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

                containment_risk_section_version_id:
                  containmentRiskSectionVersionId,

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

                containment_risk_section_version:
                  nextContainmentRiskSection,

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
      AcceptCapaContainmentRiskConcurrencyError
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
      AcceptCapaContainmentRiskWorkflowConflictError
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
