import { createHash } from "node:crypto";
import type { AuditEvent, AuditEventId, ControlledCode, RequestTrace } from "../capa/domain/capa-types";
import { createCapa, type CreateCapaDependencies, type CreateCapaResult } from "../capa/application/create-capa";
import { CAPA_STATE } from "../capa/domain/capa-state";
import type { TransactionContext, TransactionWork } from "../database/transactions";
import type { QualityDataCapaHandoffRepository, QualityDataCapaHandoffReserveInput, QualityDataCapaHandoffStoredRecord } from "../database/repositories/quality-data-capa-handoff-repository";
import type { QualityDataStage3DRepository } from "../database/repositories/quality-data-stage3d-repository";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import type { QualityDataReadAuthorizer, QualityDataIntelligenceReviewAuthorizer } from "./quality-data-authorization";
import type { QualityDataCapaHandoffResult } from "./quality-data-capa-handoff-contract";
import { qualityDataCapaHandoffCommandSchema } from "./quality-data-capa-handoff-contract";
import { resolveQualityDataIntelligenceFinding } from "./quality-data-intelligence-finding";
import type { QualityDataStage3AServiceDependencies } from "./quality-data-stage3a-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface QualityDataCapaHandoffDependencies {
  readonly quality_data: QualityDataStage3AServiceDependencies;
  readonly stage3d_repository: QualityDataStage3DRepository;
  readonly handoff_repository: QualityDataCapaHandoffRepository;
  readonly authorizer: QualityDataReadAuthorizer & QualityDataIntelligenceReviewAuthorizer;
  readonly capa_creation_dependencies: CreateCapaDependencies;
  readonly ids: { readonly audit_event_id: () => AuditEventId; readonly uuid: () => string };
  readonly clock: { readonly now: () => Date };
  /** Injection point for deterministic tests; production uses the existing createCapa use case. */
  readonly create_capa?: typeof createCapa;
}

class HandoffTransactionAbort extends Error {
  constructor(readonly result: QualityDataCapaHandoffResult) { super("QUALITY_DATA_CAPA_HANDOFF_ABORT"); }
}
class HandoffReplay extends Error {
  constructor(readonly record: QualityDataCapaHandoffStoredRecord) { super("QUALITY_DATA_CAPA_HANDOFF_REPLAY"); }
}

function validContext(context: CapaRequestContext, now: Date): boolean {
  return Number.isFinite(now.getTime()) && isHumanPrincipal(context.authentication) && isSessionActive(context.authentication, now)
    && context.owner_user_id === context.authentication.principal.user_id
    && UUID.test(context.tenant.organization_id) && UUID.test(context.authentication.principal.user_id);
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function handoffAudit(input: {
  readonly event_id: AuditEventId; readonly organization_id: string; readonly handoff_id: string;
  readonly report_id: string; readonly dataset_id: string; readonly dataset_version_id: string;
  readonly approval_event_id: string; readonly finding_key: string; readonly finding_classification: string;
  readonly finding_fingerprint: string; readonly evidence_reference_count: number; readonly capa_case_id: string;
  readonly capa_creation_audit_event_id: string; readonly reviewer_user_id: string; readonly request_trace: RequestTrace;
  readonly now: Date;
}): AuditEvent {
  return {
    event_id: input.event_id, organization_id: input.organization_id as AuditEvent["organization_id"],
    event_type: "QUALITY_DATA_INTELLIGENCE_CAPA_DRAFT_CREATED" as ControlledCode,
    schema_version: "quality-data-capa-handoff-1.0.0", aggregate_type: "CAPA_CASE" as ControlledCode,
    aggregate_id: input.capa_case_id, aggregate_version: 1,
    actor: { actor_type: "human", actor_id: input.reviewer_user_id },
    occurred_at: input.now.toISOString() as AuditEvent["occurred_at"],
    request_id: input.request_trace.request_id, correlation_id: input.request_trace.correlation_id,
    ...(input.request_trace.idempotency_key ? { idempotency_key: input.request_trace.idempotency_key } : {}),
    action: "QUALITY_DATA_INTELLIGENCE_CAPA_DRAFT_HANDOFF" as ControlledCode,
    target: { object_type: "QUALITY_DATA_INTELLIGENCE_FINDING" as ControlledCode,
      object_id: input.report_id + ":" + input.finding_key, object_version_id: input.dataset_version_id },
    outcome: "succeeded",
    configuration_versions: { quality_data_intelligence: "quality-data-intelligence-report-1.0.0", quality_data_handoff: "quality-data-capa-handoff-1.0.0" },
    metadata: {
      handoff_id: input.handoff_id, report_id: input.report_id, dataset_id: input.dataset_id,
      dataset_version_id: input.dataset_version_id, approval_event_id: input.approval_event_id,
      finding_key: input.finding_key, finding_classification: input.finding_classification,
      finding_fingerprint: input.finding_fingerprint, evidence_reference_count: input.evidence_reference_count,
      reviewer_user_id: input.reviewer_user_id, human_decision: "create_capa_draft",
      source_verification: "not_asserted", ai_interpretation: "unverified_advisory_hypotheses",
      capa_case_id: input.capa_case_id, capa_creation_audit_event_id: input.capa_creation_audit_event_id,
      capa_case_approved: false, capa_workflow_advanced: false,
    },
  };
}

export async function createCapaDraftFromQualityIntelligence(
  dependencies: QualityDataCapaHandoffDependencies,
  context: CapaRequestContext,
  trace: RequestTrace,
  reportId: string,
  input: unknown,
): Promise<QualityDataCapaHandoffResult> {
  const now = dependencies.clock.now();
  const principal = context.authentication.principal;
  if (principal.principal_type !== "human") return { status: "invalid_request" };
  if (!validContext(context, now) || !UUID.test(trace.request_id) || !UUID.test(trace.correlation_id)
    || typeof trace.idempotency_key !== "string" || trace.idempotency_key.trim() !== trace.idempotency_key
    || trace.idempotency_key.length < 1 || trace.idempotency_key.length > 200 || !UUID.test(reportId)) return { status: "invalid_request" };
  const parsed = qualityDataCapaHandoffCommandSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid_request" };
  const command = parsed.data;
  const [read, reviewer] = await Promise.all([
    dependencies.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const })),
    dependencies.authorizer.authorizeIntelligenceReview(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const })),
  ]);
  if (!read.allowed || !reviewer.allowed || read.organization_id !== context.tenant.organization_id
    || reviewer.organization_id !== read.organization_id
    || read.uploader_user_id !== principal.user_id
    || reviewer.uploader_user_id !== principal.user_id
    || read.uploader_user_id !== reviewer.uploader_user_id
    || read.membership_id !== reviewer.membership_id) return { status: "denied" };
  const report = await dependencies.stage3d_repository.findReport(read.organization_id, reportId).catch(() => null);
  if (!report || report.status !== "complete" || !report.result || !report.result_fingerprint) return { status: "not_found_or_not_authorized" };
  const approved = await dependencies.quality_data.repository.findApprovedDatasetVersion({
    organization_id: read.organization_id, membership_id: read.membership_id,
    user_id: read.uploader_user_id, now: now.toISOString(),
  }, report.dataset_version_id).catch(() => null);
  if (!approved || approved.status !== "approved" || approved.approval.approval_event_id !== report.approval_event_id
    || approved.snapshot.dataset.dataset_id !== report.dataset_id) return { status: "not_approved" };
  const target = resolveQualityDataIntelligenceFinding(report.result, command.finding_key);
  if (!target) return { status: "invalid_request" };
  if (!SHA256.test(report.result_fingerprint) || command.expected_result_fingerprint !== report.result_fingerprint) return { status: "stale_evidence" };

  const handoffId = dependencies.ids.uuid();
  const handoffKey = "QIH1-" + createHash("sha256").update(trace.idempotency_key).digest("hex");
  const requestFingerprint = hash({
    organization_id: read.organization_id, reviewer_user_id: reviewer.uploader_user_id,
    reviewer_membership_id: reviewer.membership_id, report_id: report.report_id,
    dataset_id: report.dataset_id, dataset_version_id: report.dataset_version_id,
    approval_event_id: report.approval_event_id, finding_key: command.finding_key,
    finding_classification: target.classification, result_fingerprint: report.result_fingerprint,
    finding_fingerprint: target.fingerprint, decision: command.decision, rationale: command.rationale,
  });
  const capaTrace: RequestTrace = { ...trace, idempotency_key: handoffKey as NonNullable<RequestTrace["idempotency_key"]> };
  const wrappedDependencies: CreateCapaDependencies = {
    ...dependencies.capa_creation_dependencies,
    transaction_manager: {
      runInTransaction<Result>(requestTrace: RequestTrace, work: TransactionWork<Result>): Promise<Result> {
        return dependencies.capa_creation_dependencies.transaction_manager.runInTransaction(requestTrace, async (transaction: TransactionContext) => {
          const reserved = await dependencies.handoff_repository.reserveDecision(transaction, {
            handoff_id: handoffId, organization_id: read.organization_id, report_id: report.report_id,
            finding_key: command.finding_key, expected_result_fingerprint: command.expected_result_fingerprint,
            expected_finding_fingerprint: target.fingerprint, reviewer_user_id: reviewer.uploader_user_id,
            reviewer_membership_id: reviewer.membership_id, decision: command.decision, rationale: command.rationale,
            idempotency_key: handoffKey, request_fingerprint: requestFingerprint, request_id: trace.request_id,
            correlation_id: trace.correlation_id, now: dependencies.clock.now().toISOString(),
          } satisfies QualityDataCapaHandoffReserveInput);
          if (reserved.status === "already_created") throw new HandoffReplay(reserved.record);
          if (reserved.status !== "reserved") {
            const status = reserved.status === "unauthorized" ? "denied"
              : reserved.status === "not_found" ? "not_found_or_not_authorized"
                : reserved.status === "stale_evidence" ? "stale_evidence" : "conflict";
            throw new HandoffTransactionAbort({ status });
          }
          const created = await work(transaction);
          if (typeof created !== "object" || created === null || !("status" in created) || created.status !== "created") {
            throw new HandoffTransactionAbort({ status: "conflict" });
          }
          const draft = created as unknown as Extract<CreateCapaResult, { status: "created" }>;
          if (draft.capa_case.status !== CAPA_STATE.DRAFT_INTAKE) throw new Error("QUALITY_DATA_CAPA_HANDOFF_DRAFT_STATE_INVALID");
          const auditId = dependencies.ids.audit_event_id();
          const audit = await dependencies.capa_creation_dependencies.audit_repository.appendEvent(transaction, handoffAudit({
            event_id: auditId, organization_id: read.organization_id, handoff_id: handoffId,
            report_id: report.report_id, dataset_id: report.dataset_id, dataset_version_id: report.dataset_version_id,
            approval_event_id: report.approval_event_id, finding_key: command.finding_key,
            finding_classification: target.classification, finding_fingerprint: target.fingerprint,
            evidence_reference_count: target.citations.length, capa_case_id: draft.capa_case.capa_case_id,
            capa_creation_audit_event_id: draft.audit_event_id, reviewer_user_id: reviewer.uploader_user_id,
            request_trace: capaTrace, now: dependencies.clock.now(),
          }));
          if (audit.status !== "appended") throw new Error("QUALITY_DATA_CAPA_HANDOFF_AUDIT_FAILED");
          await dependencies.handoff_repository.linkCreatedDraft(transaction, {
            organization_id: read.organization_id, handoff_id: handoffId,
            capa_case_id: draft.capa_case.capa_case_id, capa_case_status: draft.capa_case.status,
            capa_case_version_id: draft.case_version.case_version_id, capa_section_version_id: draft.section_version.section_version_id,
            capa_creation_audit_event_id: draft.audit_event_id, handoff_audit_event_id: auditId,
          });
          return created;
        });
      },
    },
  };
  const body = {
    initiating_event: "Human-requested CAPA draft from quality intelligence finding " + report.report_id + ":" + command.finding_key
      + ". Finding classification: " + target.classification + ". Source evidence verification is not asserted; AI interpretation, if present, is advisory only. Human rationale: " + command.rationale,
    source: { source_type: "QUALITY_DATA_INTELLIGENCE_FINDING", source_reference: handoffId },
  };
  try {
    const created = await (dependencies.create_capa ?? createCapa)(wrappedDependencies, {
      authentication: context.authentication, tenant: context.tenant, owner_user_id: context.owner_user_id,
      request_trace: capaTrace, body,
    });
    if (created.status === "authorization_denied") return { status: "denied" };
    if (created.status === "step_up_required") return { status: "step_up_required" };
    if (created.status === "already_created") return { status: "conflict" };
    if (created.status !== "created") return { status: "conflict" };
    return { status: "created", handoff_id: handoffId, capa_case_id: created.capa_case.capa_case_id,
      capa_case_status: created.capa_case.status, finding_classification: target.classification };
  } catch (error) {
    if (error instanceof HandoffTransactionAbort) return error.result;
    if (error instanceof HandoffReplay) {
      if (!error.record.capa_case_id || error.record.capa_case_status !== CAPA_STATE.DRAFT_INTAKE) return { status: "persistence_failed" };
      const current = await dependencies.capa_creation_dependencies.capa_repository.findCaseById(
        read.organization_id as never, error.record.capa_case_id as never,
      ).catch(() => null);
      if (!current) return { status: "persistence_failed" };
      return { status: "already_created", handoff_id: error.record.handoff_id, capa_case_id: error.record.capa_case_id,
        capa_case_status: current.status, finding_classification: error.record.finding_classification };
    }
    return { status: "persistence_failed" };
  }
}
