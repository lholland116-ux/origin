import { createHash } from "node:crypto";

import { evaluateCapaAuthorizationPreconditions } from "../authorization/capa-permissions";
import type { CapaAuthorizationPolicy } from "../authorization/capa-policy";
import {
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
  CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE,
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
  type CapaEvidenceAssumptionLedgerValidationReasonCode,
} from "../domain/capa-evidence-assumption-ledger";
import {
  CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_SECTION_TYPE,
  validateCapaInvestigationPlan,
  type CapaInvestigationPlanContent,
} from "../domain/capa-investigation-plan";
import {
  CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE,
  evaluateCapaRootCauseReadiness,
  validateCapaRootCausePackage,
  type CapaRootCauseCanonicalBlockerCode,
  type CapaRootCausePackageContent,
  type CapaRootCausePackageValidationReasonCode,
  type CapaRootCauseReadinessReasonCode,
} from "../domain/capa-root-cause-package";
import { CAPA_STATE } from "../domain/capa-state";
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
import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantContext } from "../../security/tenant-context";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { CapaRepository } from "../../database/repositories/capa-repository";
import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
} from "../../database/repositories/capa-workflow-idempotency-repository";
import type { TransactionManager } from "../../database/transactions";
import type { CapaInvestigationActiveAdoptionRepository } from "../../database/repositories/capa-investigation-active-adoption-repository";
import { verifyCapaInvestigationActiveAdoptionProvenance } from "./capa-investigation-active-adoption-verifier";
import type { CreateCapaClock, CreateCapaIdGenerator } from "./create-capa";
import { AuditEventAppendConflictError } from "./create-capa";

const SOURCE_STATE = CAPA_STATE.INVESTIGATION_ACTIVE;
const TARGET_STATE = CAPA_STATE.ROOT_CAUSE_REVIEW;
const OPERATION_CODE = "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE";
const TRANSITION_MEANING = "Submit root cause for review";
const FINGERPRINT_VERSION = "submit-capa-root-cause-package-fingerprint-1";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;

export interface SubmitCapaRootCausePackageConfiguration {
  readonly workflow_version: string;
  readonly audit_schema_version: string;
  readonly authorization_purpose: ControlledCode;
}

export interface SubmitCapaRootCausePackageDependencies {
  readonly transaction_manager: TransactionManager;
  readonly capa_repository: CapaRepository;
  readonly audit_repository: AuditRepository;
  readonly adoption_repository: CapaInvestigationActiveAdoptionRepository;
  readonly workflow_idempotency_repository: CapaWorkflowIdempotencyRepository;
  readonly authorization_policy: CapaAuthorizationPolicy;
  readonly id_generator: CreateCapaIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: SubmitCapaRootCausePackageConfiguration;
}

export interface SubmitCapaRootCausePackageCommand {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly capa_case_id: CapaCaseId;
  readonly expected_record_version: number;
  readonly expected_current_version_id: CapaCaseVersionId;
  readonly request_trace: RequestTrace;
  readonly body: unknown;
}

interface ValidatedBody {
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
}

interface CompletedSubmission {
  readonly capa_case: CapaCase;
  readonly case_version: CapaCaseVersion;
  readonly evidence_assumption_ledger_section_version: CapaSectionVersion;
  readonly root_cause_package_section_version: CapaSectionVersion;
  readonly transition_audit_event_id: AuditEventId;
}

export type SubmitCapaRootCausePackageResult =
  | ({ readonly status: "submitted" } & CompletedSubmission)
  | ({ readonly status: "already_submitted" } & CompletedSubmission)
  | {
      readonly status: "validation_failed";
      readonly reason_code:
        | "INVALID_ROOT_CAUSE_SUBMISSION_BODY"
        | "INVALID_EVIDENCE_ASSUMPTION_LEDGER"
        | "INVALID_ROOT_CAUSE_PACKAGE";
      readonly evidence_assumption_ledger_reason_code?: CapaEvidenceAssumptionLedgerValidationReasonCode;
      readonly root_cause_package_reason_code?: CapaRootCausePackageValidationReasonCode;
    }
  | {
      readonly status: "submission_blocked";
      readonly reason_codes: readonly CapaRootCauseReadinessReasonCode[];
      readonly canonical_blocker_codes: readonly CapaRootCauseCanonicalBlockerCode[];
    }
  | { readonly status: "not_found_or_not_authorized" }
  | {
      readonly status: "authorization_denied";
      readonly reason_code: string;
      readonly policy_version: string;
    }
  | {
      readonly status: "idempotency_conflict";
      readonly reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    }
  | {
      readonly status: "concurrency_conflict";
      readonly reason_code:
        | "RECORD_VERSION_CONFLICT"
        | "CURRENT_VERSION_CONFLICT"
        | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED";
    }
  | {
      readonly status: "workflow_conflict";
      readonly reason_code: "WORKFLOW_STATE_NOT_ALLOWED";
    };

export class SubmitCapaRootCausePackageIntegrityError extends Error {
  constructor(
    message = "The authoritative S40 root-cause submission source is inconsistent."
  ) {
    super(message);
    this.name = "SubmitCapaRootCausePackageIntegrityError";
  }
}
export class SubmitCapaRootCausePackageIdempotencyConfigurationError extends Error {
  constructor() {
    super("Root-cause submission requires a valid idempotency key.");
    this.name = "SubmitCapaRootCausePackageIdempotencyConfigurationError";
  }
}
class SubmissionConcurrencyError extends Error {
  constructor(
    readonly reason_code:
      | "RECORD_VERSION_CONFLICT"
      | "CURRENT_VERSION_CONFLICT"
      | "CASE_NOT_FOUND_OR_NOT_AUTHORIZED"
  ) {
    super("The CAPA changed before root-cause submission could be committed.");
  }
}
class SubmissionWorkflowError extends Error {}

const controlled = (value: string) => value as ControlledCode;
const iso = (value: Date) => value.toISOString() as IsoDateTime;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validateBody(
  value: unknown
):
  | { readonly status: "valid"; readonly value: ValidatedBody }
  | Extract<
      SubmitCapaRootCausePackageResult,
      { readonly status: "validation_failed" }
    > {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(
      value,
      "evidence_assumption_ledger"
    ) ||
    !Object.prototype.hasOwnProperty.call(value, "root_cause_package")
  ) {
    return {
      status: "validation_failed",
      reason_code: "INVALID_ROOT_CAUSE_SUBMISSION_BODY",
    };
  }
  const ledger = validateCapaEvidenceAssumptionLedger(
    value.evidence_assumption_ledger
  );
  if (ledger.status === "invalid") {
    return {
      status: "validation_failed",
      reason_code: "INVALID_EVIDENCE_ASSUMPTION_LEDGER",
      evidence_assumption_ledger_reason_code: ledger.reason_code,
    };
  }
  const rootCause = validateCapaRootCausePackage(
    value.root_cause_package,
    ledger.value
  );
  if (rootCause.status === "invalid") {
    return {
      status: "validation_failed",
      reason_code: "INVALID_ROOT_CAUSE_PACKAGE",
      root_cause_package_reason_code: rootCause.reason_code,
    };
  }
  return {
    status: "valid",
    value: Object.freeze({
      evidence_assumption_ledger: ledger.value,
      root_cause_package: rootCause.value,
    }),
  };
}

function requireIdempotencyKey(trace: RequestTrace): IdempotencyKey {
  const key = trace.idempotency_key;
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    key.trim() !== key
  ) {
    throw new SubmitCapaRootCausePackageIdempotencyConfigurationError();
  }
  return key;
}

function fingerprint(
  dependencies: SubmitCapaRootCausePackageDependencies,
  command: SubmitCapaRootCausePackageCommand,
  body: ValidatedBody
): CapaWorkflowRequestFingerprint {
  return createHash("sha256")
    .update(
      JSON.stringify({
        fingerprint_version: FINGERPRINT_VERSION,
        organization_id: command.tenant.organization_id,
        capa_case_id: command.capa_case_id,
        operation_code: OPERATION_CODE,
        expected_record_version: command.expected_record_version,
        expected_current_version_id: command.expected_current_version_id,
        evidence_assumption_ledger: body.evidence_assumption_ledger,
        root_cause_package: body.root_cause_package,
        configuration: {
          workflow_version: dependencies.configuration.workflow_version,
          evidence_assumption_ledger_schema_version:
            CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
          root_cause_package_schema_version:
            CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
          investigation_plan_schema_version:
            CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
          audit_schema_version: dependencies.configuration.audit_schema_version,
        },
      }),
      "utf8"
    )
    .digest("hex") as CapaWorkflowRequestFingerprint;
}

interface SourceSections {
  readonly all: readonly CapaSectionVersion[];
  readonly investigation_plan_section: CapaSectionVersion;
  readonly investigation_plan: CapaInvestigationPlanContent;
  readonly prior_ledger: CapaSectionVersion | null;
  readonly prior_root_cause: CapaSectionVersion | null;
}

async function loadSourceSections(
  dependencies: SubmitCapaRootCausePackageDependencies,
  capaCase: CapaCase,
  sourceVersion: CapaCaseVersion
): Promise<SourceSections> {
  if (
    new Set(sourceVersion.section_version_ids).size !==
    sourceVersion.section_version_ids.length
  )
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The S40 snapshot contains duplicate section references."
    );
  const loaded = await Promise.all(
    sourceVersion.section_version_ids.map((id) =>
      dependencies.capa_repository.findSectionVersionById(
        capaCase.organization_id,
        capaCase.capa_case_id,
        id
      )
    )
  );
  if (loaded.some((section) => section === null))
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The S40 snapshot references a missing section."
    );
  const all = loaded as CapaSectionVersion[];
  if (
    all.some(
      (section) =>
        section.organization_id !== capaCase.organization_id ||
        section.capa_case_id !== capaCase.capa_case_id ||
        !Number.isSafeInteger(section.version_number) ||
        section.version_number < 1
    )
  ) {
    throw new SubmitCapaRootCausePackageIntegrityError();
  }
  const plans = all.filter(
    (section) => section.section_type === CAPA_INVESTIGATION_PLAN_SECTION_TYPE
  );
  const ledgers = all.filter(
    (section) =>
      section.section_type === CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE
  );
  const packages = all.filter(
    (section) => section.section_type === CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE
  );
  if (plans.length !== 1 || ledgers.length > 1 || packages.length > 1)
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The S40 snapshot has ambiguous controlled sections."
    );
  if (
    (ledgers[0] !== undefined &&
      ledgers[0].schema_version !==
        CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION) ||
    (packages[0] !== undefined &&
      packages[0].schema_version !== CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION)
  )
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The prior controlled section schema metadata is invalid."
    );
  const planSection = plans[0]!;
  if (planSection.schema_version !== CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION)
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The authoritative investigation-plan schema is invalid."
    );
  const plan = validateCapaInvestigationPlan(planSection.content);
  if (plan.status === "invalid")
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The authoritative investigation plan is malformed."
    );
  return Object.freeze({
    all: Object.freeze(all),
    investigation_plan_section: planSection,
    investigation_plan: plan.value,
    prior_ledger: ledgers[0] ?? null,
    prior_root_cause: packages[0] ?? null,
  });
}

function replacedSectionIds(
  sourceVersion: CapaCaseVersion,
  replacements: readonly {
    readonly prior: CapaSectionVersion | null;
    readonly next: CapaSectionVersionId;
  }[]
): readonly CapaSectionVersionId[] {
  const replacementMap = new Map(
    replacements
      .filter((entry) => entry.prior !== null)
      .map((entry) => [entry.prior!.section_version_id, entry.next])
  );
  const seen = new Set<CapaSectionVersionId>();
  const ids = sourceVersion.section_version_ids.map((id) => {
    const next = replacementMap.get(id);
    if (next !== undefined) seen.add(id);
    return next ?? id;
  });
  if (seen.size !== replacementMap.size)
    throw new SubmitCapaRootCausePackageIntegrityError(
      "A controlled section replacement is ambiguous."
    );
  for (const entry of replacements)
    if (entry.prior === null) ids.push(entry.next);
  if (new Set(ids).size !== ids.length)
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The resulting section identity set is invalid."
    );
  return Object.freeze(ids);
}

function metadataId(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function replay(
  dependencies: SubmitCapaRootCausePackageDependencies,
  record: CapaWorkflowIdempotencyRecord
): Promise<SubmitCapaRootCausePackageResult> {
  const [capaCase, sourceVersion, version, audit] = await Promise.all([
    dependencies.capa_repository.findCaseById(
      record.organization_id,
      record.capa_case_id
    ),
    dependencies.capa_repository.findCaseVersionById(
      record.organization_id,
      record.capa_case_id,
      record.source_case_version_id
    ),
    dependencies.capa_repository.findCaseVersionById(
      record.organization_id,
      record.capa_case_id,
      record.resulting_case_version_id
    ),
    dependencies.audit_repository.findEventById(
      record.organization_id,
      record.audit_event_id
    ),
  ]);
  if (
    record.operation_code !== OPERATION_CODE ||
    capaCase === null ||
    sourceVersion === null ||
    version === null ||
    audit === null ||
    sourceVersion.organization_id !== record.organization_id ||
    sourceVersion.capa_case_id !== record.capa_case_id ||
    sourceVersion.case_version_id !== record.source_case_version_id ||
    sourceVersion.status !== SOURCE_STATE ||
    version.organization_id !== record.organization_id ||
    version.capa_case_id !== record.capa_case_id ||
    audit.event_id !== record.audit_event_id ||
    audit.organization_id !== record.organization_id ||
    audit.aggregate_type !== "CAPA_CASE" ||
    audit.aggregate_id !== record.capa_case_id ||
    version.status !== TARGET_STATE ||
    version.parent_version_id !== record.source_case_version_id ||
    audit.event_type !== "EVT-STATE-TRANSITION" ||
    audit.action !== OPERATION_CODE ||
    audit.metadata.from_state !== SOURCE_STATE ||
    audit.metadata.to_state !== TARGET_STATE ||
    audit.metadata.transition_event !== TRANSITION_MEANING ||
    audit.metadata.source_case_version_id !== record.source_case_version_id ||
    audit.metadata.resulting_case_version_id !==
      record.resulting_case_version_id ||
    audit.target.object_version_id !== version.case_version_id ||
    capaCase.current_version_id !== version.case_version_id ||
    capaCase.status !== TARGET_STATE ||
    capaCase.record_version !== version.version_number ||
    audit.aggregate_version !== capaCase.record_version
  ) {
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The root-cause submission replay record is incomplete."
    );
  }
  const source = await loadSourceSections(
    dependencies,
    capaCase,
    sourceVersion
  );
  const sections = await Promise.all(
    version.section_version_ids.map((id) =>
      dependencies.capa_repository.findSectionVersionById(
        record.organization_id,
        record.capa_case_id,
        id
      )
    )
  );
  if (sections.some((section) => section === null))
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The replay references a missing section."
    );
  if (
    new Set(version.section_version_ids).size !==
      version.section_version_ids.length ||
    sections.some(
      (section) =>
        section!.organization_id !== record.organization_id ||
        section!.capa_case_id !== record.capa_case_id
    )
  )
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The replay section identity set is inconsistent."
    );
  const ledger = sections.filter(
    (section): section is CapaSectionVersion =>
      section?.section_type === CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE
  );
  const rootCause = sections.filter(
    (section): section is CapaSectionVersion =>
      section?.section_type === CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE
  );
  const plan = sections.filter(
    (section): section is CapaSectionVersion =>
      section?.section_type === CAPA_INVESTIGATION_PLAN_SECTION_TYPE
  );
  if (
    ledger.length !== 1 ||
    rootCause.length !== 1 ||
    plan.length !== 1 ||
    ledger[0]!.schema_version !==
      CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION ||
    rootCause[0]!.schema_version !== CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION ||
    plan[0]!.schema_version !== CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION ||
    plan[0]!.section_version_id !==
      source.investigation_plan_section.section_version_id ||
    metadataId(audit.metadata.evidence_assumption_ledger_section_version_id) !==
      ledger[0]!.section_version_id ||
    metadataId(audit.metadata.root_cause_package_section_version_id) !==
      rootCause[0]!.section_version_id ||
    metadataId(audit.metadata.investigation_plan_section_version_id) !==
      plan[0]!.section_version_id
  ) {
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The replay section metadata is inconsistent."
    );
  }
  const validatedPlan = validateCapaInvestigationPlan(plan[0]!.content);
  const validatedLedger = validateCapaEvidenceAssumptionLedger(
    ledger[0]!.content
  );
  if (validatedPlan.status === "invalid" || validatedLedger.status === "invalid")
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The replay controlled section content is invalid."
    );
  const validatedRootCause = validateCapaRootCausePackage(
    rootCause[0]!.content,
    validatedLedger.value
  );
  if (validatedRootCause.status === "invalid")
    throw new SubmitCapaRootCausePackageIntegrityError(
      "The replay root-cause package is invalid."
    );
  return {
    status: "already_submitted",
    capa_case: capaCase,
    case_version: version,
    evidence_assumption_ledger_section_version: ledger[0]!,
    root_cause_package_section_version: rootCause[0]!,
    transition_audit_event_id: record.audit_event_id,
  };
}

/** Controlled human S40 -> S50 submission. This is not G-04 approval. */
export async function submitCapaRootCausePackage(
  dependencies: SubmitCapaRootCausePackageDependencies,
  command: SubmitCapaRootCausePackageCommand
): Promise<SubmitCapaRootCausePackageResult> {
  const validated = validateBody(command.body);
  if (validated.status === "validation_failed") return validated;
  const trustedNow = dependencies.clock.now();
  if (!Number.isFinite(trustedNow.getTime()))
    throw new SubmitCapaRootCausePackageIntegrityError(
      "Trusted time is invalid."
    );
  const organizationId = command.tenant.organization_id;
  const precondition = evaluateCapaAuthorizationPreconditions({
    authentication: command.authentication,
    tenant: command.tenant,
    resource: { organization_id: organizationId },
    operation: "submit_for_review",
    trusted_now: trustedNow,
  });
  if (precondition.status === "denied")
    return {
      status: "authorization_denied",
      reason_code: precondition.reason_code,
      policy_version: precondition.authorization_policy_version,
    };
  if (command.authentication.principal.principal_type !== "human")
    return {
      status: "authorization_denied",
      reason_code: "AUTHORIZED_HUMAN_REQUIRED",
      policy_version: command.tenant.authorization_policy_version,
    };

  const capaCase = await dependencies.capa_repository.findCaseById(
    organizationId,
    command.capa_case_id
  );
  if (capaCase === null) return { status: "not_found_or_not_authorized" };
  const sourceVersion = await dependencies.capa_repository.findCaseVersionById(
    organizationId,
    capaCase.capa_case_id,
    command.expected_current_version_id
  );
  if (sourceVersion === null) return { status: "not_found_or_not_authorized" };
  if (
    sourceVersion.organization_id !== organizationId ||
    sourceVersion.capa_case_id !== capaCase.capa_case_id
  )
    throw new SubmitCapaRootCausePackageIntegrityError();
  const policy = await dependencies.authorization_policy.evaluate({
    authentication: command.authentication,
    tenant: command.tenant,
    operation: "submit_for_review",
    resource: {
      organization_id: organizationId,
      resource_type: controlled("CAPA_CASE"),
      resource_id: capaCase.capa_case_id,
      resource_version_id: sourceVersion.case_version_id,
      capa_case_id: capaCase.capa_case_id,
      case_version_id: sourceVersion.case_version_id,
      workflow_state: sourceVersion.status,
    },
    purpose: dependencies.configuration.authorization_purpose,
    trusted_now: trustedNow,
  });
  if (policy.decision !== "allow")
    return {
      status: "authorization_denied",
      reason_code: policy.reason_code,
      policy_version: policy.policy_version,
    };
  if (sourceVersion.status !== SOURCE_STATE)
    return {
      status: "workflow_conflict",
      reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
    };

  const source = await loadSourceSections(
    dependencies,
    capaCase,
    sourceVersion
  );
  const readiness = evaluateCapaRootCauseReadiness(
    source.investigation_plan,
    validated.value.evidence_assumption_ledger,
    validated.value.root_cause_package
  );
  if (readiness.status === "blocked")
    return {
      status: "submission_blocked",
      reason_codes: readiness.reason_codes,
      canonical_blocker_codes: readiness.canonical_blocker_codes,
    };

  const provenance = await verifyCapaInvestigationActiveAdoptionProvenance({
    adoption_repository: dependencies.adoption_repository,
    organization_id: organizationId,
    capa_case_id: capaCase.capa_case_id,
    expected_case_version_id: sourceVersion.case_version_id,
    expected_record_version: command.expected_record_version,
    evidence_assumption_ledger: validated.value.evidence_assumption_ledger,
    root_cause_package: validated.value.root_cause_package,
  });
  if (provenance.status === "blocked")
    return {
      status: "submission_blocked",
      reason_codes: ["AI_PROPOSAL_NOT_HUMAN_ADOPTED"],
      canonical_blocker_codes: [],
    };

  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  const requestFingerprint = fingerprint(
    dependencies,
    command,
    validated.value
  );
  const nextVersionId = dependencies.id_generator.generateCaseVersionId();
  const ledgerSectionId = dependencies.id_generator.generateSectionVersionId();
  const rootCauseSectionId =
    dependencies.id_generator.generateSectionVersionId();
  const auditEventId = dependencies.id_generator.generateAuditEventId();
  const timestamp = iso(trustedNow);
  const actor = {
    actor_type: "human" as const,
    actor_id: command.authentication.principal.user_id,
  };
  const ledgerSection: CapaSectionVersion = {
    organization_id: organizationId,
    section_version_id: ledgerSectionId,
    capa_case_id: capaCase.capa_case_id,
    section_type: controlled(CAPA_EVIDENCE_ASSUMPTION_LEDGER_SECTION_TYPE),
    version_number: (source.prior_ledger?.version_number ?? 0) + 1,
    ...(source.prior_ledger === null
      ? {}
      : { parent_version_id: source.prior_ledger.section_version_id }),
    schema_version: CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
    content: validated.value.evidence_assumption_ledger as unknown as Readonly<
      Record<string, unknown>
    >,
    change_reason: TRANSITION_MEANING,
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };
  const rootCauseSection: CapaSectionVersion = {
    organization_id: organizationId,
    section_version_id: rootCauseSectionId,
    capa_case_id: capaCase.capa_case_id,
    section_type: controlled(CAPA_ROOT_CAUSE_PACKAGE_SECTION_TYPE),
    version_number: (source.prior_root_cause?.version_number ?? 0) + 1,
    ...(source.prior_root_cause === null
      ? {}
      : { parent_version_id: source.prior_root_cause.section_version_id }),
    schema_version: CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
    content: validated.value.root_cause_package as unknown as Readonly<
      Record<string, unknown>
    >,
    change_reason: TRANSITION_MEANING,
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };
  const nextVersion: CapaCaseVersion = {
    organization_id: organizationId,
    case_version_id: nextVersionId,
    capa_case_id: capaCase.capa_case_id,
    version_number: sourceVersion.version_number + 1,
    parent_version_id: sourceVersion.case_version_id,
    change_reason: TRANSITION_MEANING,
    status: TARGET_STATE,
    section_version_ids: replacedSectionIds(sourceVersion, [
      { prior: source.prior_ledger, next: ledgerSectionId },
      { prior: source.prior_root_cause, next: rootCauseSectionId },
    ]),
    effective_at: timestamp,
    created_at: timestamp,
    created_by: actor,
  };

  try {
    const result = await dependencies.transaction_manager.runInTransaction(
      command.request_trace,
      async (transaction) => {
        const claim =
          await dependencies.workflow_idempotency_repository.claimWorkflowOperation(
            transaction,
            {
              organization_id: organizationId,
              idempotency_key: idempotencyKey,
              operation_code: controlled(OPERATION_CODE),
              request_fingerprint: requestFingerprint,
              capa_case_id: capaCase.capa_case_id,
              source_case_version_id: sourceVersion.case_version_id,
              resulting_case_version_id: nextVersionId,
              audit_event_id: auditEventId,
            }
          );
        if (claim.status === "conflict") return { kind: "conflict" as const };
        if (claim.status === "already_claimed")
          return { kind: "replay" as const, record: claim.record };
        if (capaCase.status !== SOURCE_STATE)
          throw new SubmissionWorkflowError();
        if (capaCase.record_version !== command.expected_record_version)
          throw new SubmissionConcurrencyError("RECORD_VERSION_CONFLICT");
        if (capaCase.current_version_id !== command.expected_current_version_id)
          throw new SubmissionConcurrencyError("CURRENT_VERSION_CONFLICT");
        await dependencies.capa_repository.insertSectionVersion(
          transaction,
          ledgerSection
        );
        await dependencies.capa_repository.insertSectionVersion(
          transaction,
          rootCauseSection
        );
        await dependencies.capa_repository.insertCaseVersion(
          transaction,
          nextVersion
        );
        const advanced =
          await dependencies.capa_repository.advanceCurrentVersion(
            transaction,
            {
              organization_id: organizationId,
              capa_case_id: capaCase.capa_case_id,
              expected_record_version: command.expected_record_version,
              expected_current_version_id: command.expected_current_version_id,
              next_current_version_id: nextVersionId,
              next_status: TARGET_STATE,
              updated_at: timestamp,
              updated_by: actor,
            }
          );
        if (advanced.status === "conflict")
          throw new SubmissionConcurrencyError(advanced.reason_code);
        if (advanced.capa_case.record_version !== capaCase.record_version + 1)
          throw new SubmitCapaRootCausePackageIntegrityError(
            "The aggregate record version did not advance exactly once."
          );
        const audit: AuditEvent = {
          organization_id: organizationId,
          event_id: auditEventId,
          event_type: controlled("EVT-STATE-TRANSITION"),
          schema_version: dependencies.configuration.audit_schema_version,
          aggregate_type: controlled("CAPA_CASE"),
          aggregate_id: capaCase.capa_case_id,
          aggregate_version: advanced.capa_case.record_version,
          actor,
          occurred_at: timestamp,
          request_id: command.request_trace.request_id,
          correlation_id: command.request_trace.correlation_id,
          idempotency_key: idempotencyKey,
          action: controlled(OPERATION_CODE),
          target: {
            object_type: controlled("CAPA_CASE"),
            object_id: capaCase.capa_case_id,
            object_version_id: nextVersionId,
          },
          outcome: "succeeded",
          change: {
            before_ref: {
              object_type: controlled("CAPA_CASE"),
              object_id: capaCase.capa_case_id,
              object_version_id: sourceVersion.case_version_id,
            },
            after_ref: {
              object_type: controlled("CAPA_CASE"),
              object_id: capaCase.capa_case_id,
              object_version_id: nextVersionId,
            },
          },
          configuration_versions: {
            workflow: dependencies.configuration.workflow_version,
            investigation_plan_schema: CAPA_INVESTIGATION_PLAN_SCHEMA_VERSION,
            evidence_assumption_ledger_schema:
              CAPA_EVIDENCE_ASSUMPTION_LEDGER_SCHEMA_VERSION,
            root_cause_package_schema: CAPA_ROOT_CAUSE_PACKAGE_SCHEMA_VERSION,
            authorization_policy: policy.policy_version,
            audit_schema: dependencies.configuration.audit_schema_version,
          },
          metadata: {
            transition_event: TRANSITION_MEANING,
            from_state: SOURCE_STATE,
            to_state: TARGET_STATE,
            source_case_version_id: sourceVersion.case_version_id,
            resulting_case_version_id: nextVersionId,
            investigation_plan_section_version_id:
              source.investigation_plan_section.section_version_id,
            evidence_assumption_ledger_section_version_id: ledgerSectionId,
            root_cause_package_section_version_id: rootCauseSectionId,
            required_permission: "capa.case.submit",
            relied_on_role_assignment_ids: policy.relied_on_role_assignment_ids,
          },
        };
        const appended = await dependencies.audit_repository.appendEvent(
          transaction,
          audit
        );
        if (
          appended.status !== "appended" ||
          appended.event_id !== auditEventId
        )
          throw new AuditEventAppendConflictError();
        return {
          kind: "submitted" as const,
          completion: {
            capa_case: advanced.capa_case,
            case_version: nextVersion,
            evidence_assumption_ledger_section_version: ledgerSection,
            root_cause_package_section_version: rootCauseSection,
            transition_audit_event_id: auditEventId,
          },
        };
      }
    );
    if (result.kind === "conflict")
      return {
        status: "idempotency_conflict",
        reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      };
    if (result.kind === "replay") return replay(dependencies, result.record);
    return { status: "submitted", ...result.completion };
  } catch (error) {
    if (error instanceof SubmissionConcurrencyError)
      return { status: "concurrency_conflict", reason_code: error.reason_code };
    if (error instanceof SubmissionWorkflowError)
      return {
        status: "workflow_conflict",
        reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
      };
    throw error;
  }
}
