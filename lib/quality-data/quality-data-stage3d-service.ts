import { createHash } from "node:crypto";
import type { AuditEvent, AuditEventId, ControlledCode, RequestTrace } from "../capa/domain/capa-types";
import type { AuditRepository } from "../database/repositories/audit-repository";
import type { QualityDataStage3DRepository } from "../database/repositories/quality-data-stage3d-repository";
import type { TransactionManager } from "../database/transactions";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import type { QualityDataIntelligenceReviewAuthorizer, QualityDataReadAuthorizer } from "./quality-data-authorization";
import type { QualityDataAiInterpretationDependencies, QualityDataAiInterpretationResult } from "./quality-data-ai-service";
import { interpretQualityDataAnalysis } from "./quality-data-ai-service";
import { qualityDataAiAnalysisResultSchema } from "./quality-data-ai-contract";
import type { QualityDataAiAnalysisResult } from "./quality-data-ai-contract";
import { qualityDataIntelligenceRequestSchema, qualityDataIntelligenceReviewCommandSchema, type QualityDataIntelligenceReport, type QualityDataIntelligenceReviewEvent } from "./quality-data-intelligence-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface QualityDataStage3DBaseDependencies {
  readonly quality_data: QualityDataAiInterpretationDependencies["quality_data"];
  readonly repository: QualityDataStage3DRepository;
  readonly audit_repository: AuditRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorizer: QualityDataReadAuthorizer & QualityDataIntelligenceReviewAuthorizer;
  readonly ids: { readonly audit_event_id: () => AuditEventId; readonly uuid: () => string };
  readonly clock: { readonly now: () => Date };
}

export interface QualityDataStage3DServiceDependencies extends QualityDataStage3DBaseDependencies {
  readonly model_client: QualityDataAiInterpretationDependencies["model_client"];
  readonly generate_handle: QualityDataAiInterpretationDependencies["generate_handle"];
  readonly record_telemetry: QualityDataAiInterpretationDependencies["record_telemetry"];
}

export type QualityDataIntelligenceOperationResult =
  | { readonly status: "complete"; readonly report: QualityDataIntelligenceReport; readonly replayed: boolean }
  | { readonly status: "processing"; readonly report_id: string }
  | { readonly status: "failed"; readonly report_id: string; readonly failure_code: string }
  | { readonly status: "invalid_request" }
  | { readonly status: "denied" }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "not_approved" }
  | { readonly status: "conflict" }
  | { readonly status: "analysis_failed" };

export type QualityDataIntelligenceReportReadResult =
  | { readonly status: "found"; readonly report: QualityDataIntelligenceReport; readonly review_history: Awaited<ReturnType<QualityDataStage3DRepository["listReviewHistory"]>>; readonly classifications: typeof REPORT_CLASSIFICATIONS }
  | { readonly status: "denied" | "not_found_or_not_authorized" | "not_approved" | "invalid_request" | "unavailable" };

export type QualityDataIntelligenceReviewResult =
  | { readonly status: "applied" | "already_recorded"; readonly event: QualityDataIntelligenceReviewEvent }
  | { readonly status: "invalid_request" | "denied" | "not_found_or_not_authorized" | "not_approved" }
  | { readonly status: "conflict"; readonly reason_code: string }
  | { readonly status: "persistence_failed" };

export const REPORT_CLASSIFICATIONS = Object.freeze({
  calculations: "deterministic_reproducible",
  signals: "deterministic_observations",
  ai_interpretation: "unverified_advisory_hypotheses",
  human_review: "triage_only_not_a_truth_or_capa_decision",
  source_evidence_verification: "not_asserted",
  capa_integration: "preparatory_only_no_case_mutation",
} as const);

function validContext(context: CapaRequestContext, now: Date): boolean {
  return Number.isFinite(now.getTime()) && isHumanPrincipal(context.authentication) && isSessionActive(context.authentication, now)
    && context.owner_user_id === context.authentication.principal.user_id
    && UUID.test(context.tenant.organization_id) && UUID.test(context.authentication.principal.user_id);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function failureCode(result: Exclude<QualityDataAiInterpretationResult, { status: "complete" }>): string {
  switch (result.status) {
    case "denied": return "DENIED";
    case "not_found_or_not_authorized": return "NOT_FOUND";
    case "not_approved": return "NOT_APPROVED";
    case "invalid_request": return "INVALID_REQUEST";
    case "evidence_invalid": return "EVIDENCE_INVALID";
    case "provider_error": return "PROVIDER_ERROR";
    case "invalid_model_output": return "INVALID_MODEL_OUTPUT";
    case "cost_unavailable": return "COST_UNAVAILABLE";
    case "rate_limit_required": return "RATE_LIMIT_REQUIRED";
    default: return "UNAVAILABLE";
  }
}

function requireIdempotency(trace: RequestTrace): NonNullable<RequestTrace["idempotency_key"]> | null {
  return trace.idempotency_key && trace.idempotency_key.length >= 1 && trace.idempotency_key.length <= 200
    ? trace.idempotency_key : null;
}

function makeReportAudit(input: {
  event_id: AuditEventId; report: QualityDataIntelligenceReport; trace: RequestTrace; user_id: string;
}): AuditEvent {
  return {
    event_id: input.event_id,
    organization_id: input.report.organization_id as AuditEvent["organization_id"],
    event_type: "QUALITY_DATA_INTELLIGENCE_REPORT_CREATED" as ControlledCode,
    schema_version: "quality-data-intelligence-1.0.0",
    aggregate_type: "QUALITY_DATA_INTELLIGENCE_REPORT" as ControlledCode,
    aggregate_id: input.report.report_id,
    aggregate_version: 1,
    actor: { actor_type: "human", actor_id: input.user_id },
    occurred_at: input.report.finalized_at as AuditEvent["occurred_at"],
    request_id: input.trace.request_id,
    correlation_id: input.trace.correlation_id,
    ...(input.trace.idempotency_key ? { idempotency_key: input.trace.idempotency_key } : {}),
    action: "QUALITY_DATA_INTELLIGENCE_REPORT_CREATED" as ControlledCode,
    target: { object_type: "QUALITY_DATASET_VERSION" as ControlledCode, object_id: input.report.dataset_version_id, object_version_id: input.report.dataset_version_id },
    outcome: "succeeded",
    configuration_versions: { stage3a: "quality-analysis-1.0.0", stage3b: "quality-signal-calculation-1.0.0", stage3c: input.report.result?.schema_version ?? "unknown" },
    metadata: {
      report_id: input.report.report_id,
      dataset_id: input.report.dataset_id,
      dataset_version_id: input.report.dataset_version_id,
      approval_event_id: input.report.approval_event_id,
      request_fingerprint: input.report.request_fingerprint,
      result_fingerprint: input.report.result_fingerprint,
      interpretation_status: "unverified_advisory_hypotheses",
      source_verification: "not_asserted",
      analytical_use_only: true,
      capa_case_mutated: false,
    },
  };
}

function makeReviewAudit(input: {
  event_id: AuditEventId; event: QualityDataIntelligenceReviewEvent; trace: RequestTrace;
}): AuditEvent {
  return {
    event_id: input.event_id,
    organization_id: input.event.organization_id as AuditEvent["organization_id"],
    event_type: "QUALITY_DATA_INTELLIGENCE_HUMAN_REVIEW_RECORDED" as ControlledCode,
    schema_version: "quality-data-intelligence-1.0.0",
    aggregate_type: "QUALITY_DATA_INTELLIGENCE_REPORT" as ControlledCode,
    aggregate_id: input.event.report_id,
    aggregate_version: input.event.transition_number,
    actor: { actor_type: "human", actor_id: input.event.reviewer_user_id },
    occurred_at: input.event.occurred_at as AuditEvent["occurred_at"],
    request_id: input.trace.request_id,
    correlation_id: input.trace.correlation_id,
    ...(input.trace.idempotency_key ? { idempotency_key: input.trace.idempotency_key } : {}),
    action: `QUALITY_DATA_INTELLIGENCE_${input.event.decision.toUpperCase()}` as ControlledCode,
    target: { object_type: "QUALITY_DATA_INTELLIGENCE_FINDING" as ControlledCode, object_id: `${input.event.report_id}:${input.event.finding_key}`, object_version_id: input.event.dataset_version_id },
    outcome: "succeeded",
    configuration_versions: { quality_data_intelligence: "quality-data-intelligence-review-1.0.0" },
    metadata: {
      review_event_id: input.event.event_id,
      report_id: input.event.report_id,
      dataset_id: input.event.dataset_id,
      dataset_version_id: input.event.dataset_version_id,
      approval_event_id: input.event.approval_event_id,
      finding_key: input.event.finding_key,
      finding_fingerprint: input.event.finding_fingerprint,
      decision: input.event.decision,
      transition_number: input.event.transition_number,
      source_evidence_verified: false,
      capa_case_mutated: false,
    },
  };
}

async function approvedReport(dependencies: QualityDataStage3DServiceDependencies, context: CapaRequestContext, report: QualityDataIntelligenceReport, now: Date): Promise<"approved" | "not_approved" | "unavailable"> {
  const read = await dependencies.quality_data.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }));
  if (!read.allowed || read.organization_id !== report.organization_id) return "unavailable";
  const current = await dependencies.quality_data.repository.findApprovedDatasetVersion({
    organization_id: report.organization_id, membership_id: read.membership_id, user_id: read.uploader_user_id, now: now.toISOString(),
  }, report.dataset_version_id).catch(() => null);
  if (!current || current.status !== "approved" || current.approval.approval_event_id !== report.approval_event_id) return "not_approved";
  return "approved";
}

/** Reserves a report before provider dispatch. A duplicate key or interrupted reservation never dispatches the provider twice. */
export async function createQualityDataIntelligenceReport(
  dependencies: QualityDataStage3DServiceDependencies,
  context: CapaRequestContext,
  trace: RequestTrace,
  input: unknown,
): Promise<QualityDataIntelligenceOperationResult> {
  const now = dependencies.clock.now();
  if (!validContext(context, now) || !UUID.test(trace.request_id) || !UUID.test(trace.correlation_id)) return { status: "invalid_request" };
  const key = requireIdempotency(trace);
  const parsed = qualityDataIntelligenceRequestSchema.safeParse(input);
  if (!parsed.success || !key) return { status: "invalid_request" };
  const read = await dependencies.quality_data.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }));
  if (!read.allowed || read.organization_id !== context.tenant.organization_id) return { status: "denied" };
  const current = await dependencies.quality_data.repository.findApprovedDatasetVersion({
    organization_id: read.organization_id, membership_id: read.membership_id, user_id: read.uploader_user_id, now: now.toISOString(),
  }, parsed.data.dataset_version_id).catch(() => null);
  if (!current) return { status: "not_found_or_not_authorized" };
  if (current.status !== "approved") return { status: "not_approved" };

  const requestFingerprint = fingerprint({ organization_id: read.organization_id, user_id: read.uploader_user_id, request: parsed.data });
  let reservation;
  try {
    reservation = await dependencies.transaction_manager.runInTransaction(trace, (transaction) => dependencies.repository.reserveReport(transaction, {
      report_id: dependencies.ids.uuid(), organization_id: read.organization_id, dataset_id: current.snapshot.dataset.dataset_id,
      dataset_version_id: parsed.data.dataset_version_id, approval_event_id: current.approval.approval_event_id,
      requested_by_user_id: read.uploader_user_id, requested_by_membership_id: read.membership_id,
      request_payload: parsed.data, request_fingerprint: requestFingerprint, idempotency_key: key,
      request_trace: { ...trace, idempotency_key: key }, now: now.toISOString(),
    }));
  } catch { return { status: "analysis_failed" }; }
  if (reservation.status === "unauthorized") return { status: "denied" };
  if (reservation.status === "conflict") return { status: "conflict" };
  if (reservation.status === "in_progress") return { status: "processing", report_id: reservation.report_id };
  if (reservation.status === "existing") {
    const access = await approvedReport(dependencies, context, reservation.report, dependencies.clock.now());
    if (access === "unavailable") return { status: "not_found_or_not_authorized" };
    if (access === "not_approved") return { status: "not_approved" };
    return reservation.report.status === "complete"
      ? { status: "complete", report: reservation.report, replayed: true }
      : { status: "failed", report_id: reservation.report.report_id, failure_code: reservation.report.failure_code ?? "UNAVAILABLE" };
  }

  let aiResult: QualityDataAiInterpretationResult;
  try {
    aiResult = await interpretQualityDataAnalysis({
      quality_data: dependencies.quality_data, model_client: dependencies.model_client,
      generate_handle: dependencies.generate_handle, record_telemetry: dependencies.record_telemetry,
    }, context, trace, parsed.data);
  } catch {
    try { await dependencies.transaction_manager.runInTransaction(trace, (transaction) => dependencies.repository.failReport(
      transaction, read.organization_id, reservation.report.report_id, "UNAVAILABLE", dependencies.clock.now().toISOString(),
    )); } catch { return { status: "analysis_failed" }; }
    return { status: "failed", report_id: reservation.report.report_id, failure_code: "UNAVAILABLE" };
  }
  if (aiResult.status !== "complete") {
    const safeFailure = failureCode(aiResult);
    try {
      await dependencies.transaction_manager.runInTransaction(trace, (transaction) => dependencies.repository.failReport(
        transaction, read.organization_id, reservation.report.report_id, safeFailure, dependencies.clock.now().toISOString(),
      ));
    } catch { return { status: "analysis_failed" }; }
    return { status: "failed", report_id: reservation.report.report_id, failure_code: safeFailure };
  }
  const result = qualityDataAiAnalysisResultSchema.safeParse(aiResult.result);
  if (!result.success) {
    try { await dependencies.transaction_manager.runInTransaction(trace, (transaction) => dependencies.repository.failReport(transaction, read.organization_id, reservation.report.report_id, "INVALID_MODEL_OUTPUT", dependencies.clock.now().toISOString())); }
    catch { return { status: "analysis_failed" }; }
    return { status: "failed", report_id: reservation.report.report_id, failure_code: "INVALID_MODEL_OUTPUT" };
  }
  const resultFingerprint = fingerprint(result.data);
  try {
    const report = await dependencies.transaction_manager.runInTransaction(trace, async (transaction) => {
      const completed = await dependencies.repository.completeReport(transaction, read.organization_id, reservation.report.report_id, result.data, resultFingerprint, dependencies.clock.now().toISOString());
      const audit = await dependencies.audit_repository.appendEvent(transaction, makeReportAudit({
        event_id: dependencies.ids.audit_event_id(), report: completed, trace, user_id: read.uploader_user_id,
      }));
      if (audit.status === "conflict") throw new Error("QUALITY_DATA_INTELLIGENCE_AUDIT_CONFLICT");
      return completed;
    });
    return { status: "complete", report, replayed: false };
  } catch { return { status: "analysis_failed" }; }
}

export async function getQualityDataIntelligenceReport(
  dependencies: QualityDataStage3DServiceDependencies,
  context: CapaRequestContext,
  reportId: string,
): Promise<QualityDataIntelligenceReportReadResult> {
  const now = dependencies.clock.now();
  if (!validContext(context, now) || !UUID.test(reportId)) return { status: "invalid_request" };
  const read = await dependencies.quality_data.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }));
  if (!read.allowed || read.organization_id !== context.tenant.organization_id) return { status: "denied" };
  const report = await dependencies.repository.findReport(read.organization_id, reportId).catch(() => null);
  if (!report) return { status: "not_found_or_not_authorized" };
  const access = await approvedReport(dependencies, context, report, dependencies.clock.now());
  if (access === "unavailable") return { status: "not_found_or_not_authorized" };
  if (access === "not_approved") return { status: "not_approved" };
  try {
    return {
      status: "found", report,
      review_history: await dependencies.repository.listReviewHistory(read.organization_id, reportId),
      classifications: REPORT_CLASSIFICATIONS,
    };
  } catch { return { status: "unavailable" }; }
}

function finding(result: QualityDataAiAnalysisResult, key: string): unknown | null {
  const [kind, reference] = key.split(":");
  if (kind === "signal") return result.observed_signals.find((entry) => entry.reference === reference) ?? null;
  if (kind === "metric") return result.verified_calculations.find((entry) => entry.reference === reference) ?? null;
  const index = Number(reference);
  if (!Number.isInteger(index) || index < 0) return null;
  if (kind === "possible_cause") return result.interpretation.possible_causes[index] ?? null;
  if (kind === "uncertainty") return result.interpretation.uncertainty[index] ?? null;
  if (kind === "investigation_step") return result.interpretation.human_investigation_steps[index] ?? null;
  return null;
}

export async function reviewQualityDataIntelligenceFinding(
  dependencies: QualityDataStage3DServiceDependencies,
  context: CapaRequestContext,
  trace: RequestTrace,
  input: unknown,
): Promise<QualityDataIntelligenceReviewResult> {
  const now = dependencies.clock.now();
  if (!validContext(context, now) || !UUID.test(trace.request_id) || !UUID.test(trace.correlation_id)) return { status: "invalid_request" };
  const key = requireIdempotency(trace);
  const parsed = qualityDataIntelligenceReviewCommandSchema.safeParse(input);
  if (!parsed.success || !key) return { status: "invalid_request" };
  const [read, reviewer] = await Promise.all([
    dependencies.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const })),
    dependencies.authorizer.authorizeIntelligenceReview(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const })),
  ]);
  if (!read.allowed || !reviewer.allowed || read.organization_id !== context.tenant.organization_id || reviewer.organization_id !== read.organization_id) return { status: "denied" };
  const report = await dependencies.repository.findReport(read.organization_id, parsed.data.report_id).catch(() => null);
  if (!report || report.status !== "complete" || !report.result) return { status: "not_found_or_not_authorized" };
  const access = await approvedReport(dependencies, context, report, dependencies.clock.now());
  if (access === "unavailable") return { status: "not_found_or_not_authorized" };
  if (access === "not_approved") return { status: "not_approved" };
  const target = finding(report.result, parsed.data.finding_key);
  if (target === null) return { status: "invalid_request" };
  const findingFingerprint = fingerprint(target);
  const requestFingerprint = fingerprint({ organization_id: read.organization_id, report_id: parsed.data.report_id, idempotency_key: key, command: parsed.data });
  try {
    return await dependencies.transaction_manager.runInTransaction({ ...trace, idempotency_key: key }, async (transaction) => {
      const appended = await dependencies.repository.appendReview(transaction, {
        organization_id: read.organization_id, reviewer_user_id: reviewer.uploader_user_id,
        reviewer_membership_id: reviewer.membership_id,
        request_trace: { ...trace, idempotency_key: key }, command: parsed.data,
        event_id: dependencies.ids.uuid(), finding_fingerprint: findingFingerprint, request_fingerprint: requestFingerprint,
        now: now.toISOString(),
      });
      if (appended.status === "unauthorized") return { status: "denied" } as const;
      if (appended.status === "not_found") return { status: "not_found_or_not_authorized" } as const;
      if (appended.status === "conflict") return { status: "conflict", reason_code: appended.reason_code } as const;
      if (appended.status === "already_recorded") return { status: "already_recorded", event: appended.event } as const;
      const audit = await dependencies.audit_repository.appendEvent(transaction, makeReviewAudit({
        event_id: dependencies.ids.audit_event_id(), event: appended.event, trace: { ...trace, idempotency_key: key },
      }));
      if (audit.status === "conflict") throw new Error("QUALITY_DATA_INTELLIGENCE_REVIEW_AUDIT_CONFLICT");
      return { status: "applied", event: appended.event } as const;
    });
  } catch { return { status: "persistence_failed" }; }
}
