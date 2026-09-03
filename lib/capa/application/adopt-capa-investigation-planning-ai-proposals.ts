import {
  createHash,
} from "node:crypto";

import type {
  ActorReference,
  AuditEvent,
  AuditEventId,
  CapaCaseId,
  RequestTrace,
  UserId,
} from "../domain/capa-types";
import type {
  CapaInvestigationPlanningAdoptionIntentRequest,
  CapaInvestigationPlanningAdoptionRecord,
} from "../ai/capa-investigation-planning-adoption-contract";
import {
  constructCapaInvestigationPlanningAdoption,
} from "../ai/capa-investigation-planning-adoption-validator";
import {
  CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION,
} from "../ai/capa-investigation-planning-adoption-contract";
import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";
import type {
  CapaInvestigationPlanningAdoptionPersistenceInput,
  CapaInvestigationPlanningAdoptionRepository,
  PersistedCapaInvestigationPlanningAdoption,
} from "../../database/repositories/capa-investigation-planning-adoption-repository";
import type {
  TransactionManager,
} from "../../database/transactions";
import type {
  CapaInvestigationPlanningAdoptionAuthorizer,
} from "../authorization/capa-investigation-planning-adoption-authorizer";
import type {
  TenantContext,
} from "../../security/tenant-context";
import type {
  CreateCapaClock,
} from "./create-capa";

export const CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION =
  "ADOPT_CAPA_INVESTIGATION_PLANNING_AI_PROPOSALS" as const;

export const CAPA_INVESTIGATION_PLANNING_ADOPTION_REQUEST_FINGERPRINT_VERSION =
  "capa-investigation-planning-adoption-request-fingerprint-1" as const;

const AUDIT_EVENT_TYPE = "EVT-AI-PROPOSAL-ADOPTED";
const AUDIT_OBJECT_TYPE = "CAPA_INVESTIGATION_PLANNING_ADOPTION";
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 128;

export type CapaInvestigationPlanningAdoptionIdGenerator = {
  generateAdoptionId(): CapaInvestigationPlanningAdoptionRecord["adoption_id"];
  generateAuditEventId(): AuditEventId;
};

export interface CapaInvestigationPlanningAdoptionConfiguration {
  readonly audit_schema_version: string;
}

export interface AdoptCapaInvestigationPlanningAiProposalsCommand {
  readonly capa_case_id: CapaCaseId;
  readonly adoption_intent: CapaInvestigationPlanningAdoptionIntentRequest;
  readonly request_trace: RequestTrace;
}

export interface AdoptCapaInvestigationPlanningAiProposalsDependencies {
  readonly tenant: TenantContext;
  readonly adopter: ActorReference & { readonly actor_type: "human" };
  readonly transaction_manager: TransactionManager;
  readonly adoption_repository: CapaInvestigationPlanningAdoptionRepository;
  readonly audit_repository: AuditRepository;
  readonly authorizer: CapaInvestigationPlanningAdoptionAuthorizer;
  readonly id_generator: CapaInvestigationPlanningAdoptionIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: CapaInvestigationPlanningAdoptionConfiguration;
}

type AdoptionSuccess = {
  readonly status: "adopted" | "already_adopted";
  readonly records: readonly PersistedCapaInvestigationPlanningAdoption[];
};

export type AdoptCapaInvestigationPlanningAiProposalsResult =
  | AdoptionSuccess
  | {
      readonly status: "authorization_denied";
      readonly reason_code: "ADOPTION_NOT_AUTHORIZED";
    }
  | {
      readonly status: "output_not_found_or_not_authorized";
    }
  | {
      readonly status: "output_not_adoptable";
    }
  | {
      readonly status: "concurrency_conflict";
    }
  | {
      readonly status: "idempotency_conflict";
    };

export class CapaInvestigationPlanningAdoptionIdempotencyConfigurationError
  extends Error {
  constructor() {
    super("CAPA investigation-planning adoption requires a valid idempotency key.");
    this.name = "CapaInvestigationPlanningAdoptionIdempotencyConfigurationError";
  }
}

export class CapaInvestigationPlanningAdoptionIntegrityError extends Error {
  constructor(message = "The CAPA investigation-planning adoption is inconsistent.") {
    super(message);
    this.name = "CapaInvestigationPlanningAdoptionIntegrityError";
  }
}

class AdoptionBatchAbortError extends Error {
  constructor(
    readonly result: AdoptCapaInvestigationPlanningAiProposalsResult,
  ) {
    super("The CAPA investigation-planning adoption batch must roll back.");
    this.name = "AdoptionBatchAbortError";
  }
}

function requireIdempotencyKey(trace: RequestTrace): string {
  const value = trace.idempotency_key;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    value.trim() !== value
  ) {
    throw new CapaInvestigationPlanningAdoptionIdempotencyConfigurationError();
  }
  return value;
}

function stableIntent(
  intent: CapaInvestigationPlanningAdoptionIntentRequest,
): CapaInvestigationPlanningAdoptionIntentRequest {
  return {
    expected_case_version_id: intent.expected_case_version_id,
    expected_record_version: intent.expected_record_version,
    output_id: intent.output_id,
    selected_items: [...intent.selected_items]
      .sort((left, right) =>
        Number(left.proposal_key.slice(1)) - Number(right.proposal_key.slice(1)),
      )
      .map((item) => ({
        proposal_key: item.proposal_key,
        investigation_question: item.investigation_question,
        evidence_target: item.evidence_target,
        investigation_method: item.investigation_method,
        scope_relationship: item.scope_relationship,
        owner_user_id: item.owner_user_id,
        due_date: item.due_date,
        dependency_proposal_keys: [...item.dependency_proposal_keys].sort(
          (left, right) =>
            Number(left.slice(1)) - Number(right.slice(1)),
        ),
      })),
  };
}

function requestFingerprint(
  tenant: TenantContext,
  adopter: ActorReference & { readonly actor_type: "human" },
  capaCaseId: CapaCaseId,
  intent: CapaInvestigationPlanningAdoptionIntentRequest,
): CapaInvestigationPlanningAdoptionPersistenceInput["request_fingerprint"] {
  return createHash("sha256")
    .update(JSON.stringify({
      fingerprint_version:
        CAPA_INVESTIGATION_PLANNING_ADOPTION_REQUEST_FINGERPRINT_VERSION,
      operation: CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION,
      organization_id: tenant.organization_id,
      capa_case_id: capaCaseId,
      expected_case_version_id: intent.expected_case_version_id,
      expected_record_version: intent.expected_record_version,
      output_id: intent.output_id,
      adopted_by: {
        actor_type: adopter.actor_type,
        actor_id: adopter.actor_id,
      },
      selected_items: stableIntent(intent).selected_items,
      adoption_policy_version: CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION,
    }), "utf8")
    .digest("hex") as CapaInvestigationPlanningAdoptionPersistenceInput["request_fingerprint"];
}

function recordFingerprint(
  record: CapaInvestigationPlanningAdoptionRecord,
): CapaInvestigationPlanningAdoptionPersistenceInput["record_fingerprint"] {
  return createHash("sha256")
    .update(JSON.stringify(record), "utf8")
    .digest("hex") as CapaInvestigationPlanningAdoptionPersistenceInput["record_fingerprint"];
}

function auditEvent(
  dependencies: AdoptCapaInvestigationPlanningAiProposalsDependencies,
  command: AdoptCapaInvestigationPlanningAiProposalsCommand,
  record: PersistedCapaInvestigationPlanningAdoption,
): AuditEvent {
  const adoption = record.adoption;
  return {
    organization_id: adoption.organization_id,
    event_id: record.audit_event_id,
    event_type: AUDIT_EVENT_TYPE as never,
    schema_version: dependencies.configuration.audit_schema_version,
    aggregate_type: "CAPA_CASE" as never,
    aggregate_id: adoption.capa_case_id,
    aggregate_version: adoption.record_version,
    actor: adoption.adopted_by,
    occurred_at: adoption.adopted_at,
    request_id: adoption.request_id,
    correlation_id: adoption.correlation_id,
    idempotency_key: adoption.idempotency_key,
    action: CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION as never,
    target: {
      object_type: AUDIT_OBJECT_TYPE as never,
      object_id: adoption.adoption_id,
    },
    outcome: "succeeded",
    configuration_versions: {
      adoption_policy: adoption.adoption_policy_version,
      audit_schema: dependencies.configuration.audit_schema_version,
    },
    metadata: {
      capa_case_id: adoption.capa_case_id,
      case_version_id: adoption.case_version_id,
      record_version: adoption.record_version,
      output_id: adoption.output_id,
      proposal_key: adoption.proposal_key,
      adoption_id: adoption.adoption_id,
      adopted_by_user_id: adoption.adopted_by.actor_id,
      adopted_at: adoption.adopted_at,
      batch_idempotency_key: adoption.idempotency_key,
      adoption_policy_version: adoption.adoption_policy_version,
      advisory_only_human_adoption: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      gate_approved: false,
      request_id: command.request_trace.request_id,
      correlation_id: command.request_trace.correlation_id,
    },
  };
}

function assertPersistedRecord(
  record: PersistedCapaInvestigationPlanningAdoption,
  input: CapaInvestigationPlanningAdoptionPersistenceInput,
): void {
  if (
    record.adoption.organization_id !== input.adoption.organization_id ||
    record.adoption.capa_case_id !== input.adoption.capa_case_id ||
    record.adoption.proposal_key !== input.adoption.proposal_key ||
    record.adoption.output_id !== input.adoption.output_id ||
    record.adoption.idempotency_key !== input.adoption.idempotency_key ||
    record.request_fingerprint !== input.request_fingerprint
  ) {
    throw new CapaInvestigationPlanningAdoptionIntegrityError();
  }
}

export async function adoptCapaInvestigationPlanningAiProposals(
  dependencies: AdoptCapaInvestigationPlanningAiProposalsDependencies,
  command: AdoptCapaInvestigationPlanningAiProposalsCommand,
): Promise<AdoptCapaInvestigationPlanningAiProposalsResult> {
  const intent = command.adoption_intent;
  const idempotencyKey = requireIdempotencyKey(command.request_trace);
  let trustedNow: Date;
  try {
    trustedNow = dependencies.clock.now();
  } catch {
    return { status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" };
  }
  if (!(trustedNow instanceof Date) || !Number.isFinite(trustedNow.getTime())) {
    return { status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" };
  }
  const adopter = dependencies.adopter;
  let authorized = false;
  try {
    authorized = await dependencies.authorizer.authorize({
      organization_id: dependencies.tenant.organization_id,
      capa_case_id: command.capa_case_id,
      case_version_id: intent.expected_case_version_id,
      record_version: intent.expected_record_version,
      output_id: intent.output_id,
      adopter: {
        ...adopter,
        actor_id: adopter.actor_id as UserId,
      },
      trusted_now: trustedNow,
    });
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return { status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" };
  }

  const batchRequestFingerprint = requestFingerprint(
    dependencies.tenant,
    adopter,
    command.capa_case_id,
    intent,
  );
  const adoptedAt = trustedNow.toISOString() as CapaInvestigationPlanningAdoptionRecord["adopted_at"];
  const inputs = intent.selected_items.map((item) => {
    const adoption = constructCapaInvestigationPlanningAdoption({
      adoption_id: dependencies.id_generator.generateAdoptionId(),
      organization_id: dependencies.tenant.organization_id,
      capa_case_id: command.capa_case_id,
      case_version_id: intent.expected_case_version_id,
      record_version: intent.expected_record_version,
      output_id: intent.output_id,
      adopted_item: item,
      adopted_at: adoptedAt,
      adopted_by: adopter,
      request_id: command.request_trace.request_id,
      correlation_id: command.request_trace.correlation_id,
      idempotency_key: idempotencyKey as never,
      adoption_policy_version: CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION,
    });
    return {
      adoption,
      request_fingerprint: batchRequestFingerprint,
      record_fingerprint: recordFingerprint(adoption),
      audit_event_id: dependencies.id_generator.generateAuditEventId(),
    } satisfies CapaInvestigationPlanningAdoptionPersistenceInput;
  });

  try {
    const result = await dependencies.transaction_manager.runInTransaction(
      command.request_trace,
      async (transaction) => {
        let mode: "saved" | "already_recorded" | undefined;
        const records: PersistedCapaInvestigationPlanningAdoption[] = [];
        for (const input of inputs) {
          const append = await dependencies.adoption_repository.appendAdoption(
            transaction,
            input,
          );
          if (append.status === "case_changed") {
            throw new AdoptionBatchAbortError({ status: "concurrency_conflict" });
          }
          if (append.status === "output_not_found_or_not_authorized") {
            throw new AdoptionBatchAbortError({ status: append.status });
          }
          if (append.status === "output_not_adoptable") {
            throw new AdoptionBatchAbortError({ status: append.status });
          }
          if (append.status === "conflict") {
            if (append.reason_code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST") {
              throw new AdoptionBatchAbortError({ status: "idempotency_conflict" });
            }
            throw new CapaInvestigationPlanningAdoptionIntegrityError();
          }
          assertPersistedRecord(append.record, input);
          if (
            append.status === "saved" &&
            (append.record.adoption.adoption_id !== input.adoption.adoption_id ||
              append.record.record_fingerprint !== input.record_fingerprint ||
              append.record.audit_event_id !== input.audit_event_id)
          ) {
            throw new CapaInvestigationPlanningAdoptionIntegrityError();
          }
          const nextMode = append.status === "saved" ? "saved" : "already_recorded";
          if (mode !== undefined && mode !== nextMode) {
            throw new CapaInvestigationPlanningAdoptionIntegrityError(
              "A logical adoption batch mixed newly saved and replayed records.",
            );
          }
          mode = nextMode;
          if (append.status === "saved") {
            const audit = await dependencies.audit_repository.appendEvent(
              transaction,
              auditEvent(dependencies, command, append.record),
            );
            if (audit.status !== "appended" || audit.event_id !== append.record.audit_event_id) {
              throw new CapaInvestigationPlanningAdoptionIntegrityError(
                "The adoption audit event was not appended atomically.",
              );
            }
          }
          records.push(append.record);
        }
        if (mode === undefined) {
          throw new CapaInvestigationPlanningAdoptionIntegrityError(
            "An adoption batch contained no selected proposals.",
          );
        }
        return {
          status: mode === "saved" ? "adopted" : "already_adopted",
          records: Object.freeze(records),
        } satisfies AdoptionSuccess;
      },
    );
    return result;
  } catch (error) {
    if (error instanceof AdoptionBatchAbortError) return error.result;
    throw error;
  }
}
