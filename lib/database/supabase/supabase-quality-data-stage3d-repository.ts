import type postgres from "postgres";
import type { QualityDataAiAnalysisResult } from "../../quality-data/quality-data-ai-contract";
import { qualityDataAiAnalysisResultSchema } from "../../quality-data/quality-data-ai-contract";
import type { QualityDataIntelligenceReport, QualityDataIntelligenceReviewEvent } from "../../quality-data/quality-data-intelligence-contract";
import type { QualityDataIntelligenceReportReservation, QualityDataIntelligenceReservationResult, QualityDataIntelligenceReviewAppendInput, QualityDataIntelligenceReviewAppendResult, QualityDataIntelligenceReviewHistory, QualityDataStage3DRepository } from "../repositories/quality-data-stage3d-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("QUALITY_DATA_INTELLIGENCE_DATABASE_VALUE_INVALID");
  return value;
}
function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("QUALITY_DATA_INTELLIGENCE_DATABASE_COUNT_INVALID");
  return parsed;
}
function optionalText(value: unknown): string | null { return value === null || value === undefined ? null : text(value); }
function json(value: unknown): unknown {
  if (typeof value === "string") {
    try { return JSON.parse(value) as unknown; } catch { throw new Error("QUALITY_DATA_INTELLIGENCE_DATABASE_JSON_INVALID"); }
  }
  return value;
}
function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("QUALITY_DATA_INTELLIGENCE_DATABASE_DATE_INVALID");
  return date.toISOString();
}
function report(row: Row): QualityDataIntelligenceReport {
  const status = text(row.status);
  if (status !== "processing" && status !== "complete" && status !== "failed") throw new Error("QUALITY_DATA_INTELLIGENCE_DATABASE_STATUS_INVALID");
  const resultValue = row.result_payload === null ? null : qualityDataAiAnalysisResultSchema.parse(json(row.result_payload)) as QualityDataAiAnalysisResult;
  if ((status === "complete") !== (resultValue !== null)) throw new Error("QUALITY_DATA_INTELLIGENCE_DATABASE_RESULT_INVALID");
  return {
    report_id: text(row.report_id), organization_id: text(row.organization_id), dataset_id: text(row.dataset_id),
    dataset_version_id: text(row.dataset_version_id), approval_event_id: text(row.approval_event_id),
    requested_by_user_id: text(row.requested_by_user_id), requested_by_membership_id: text(row.requested_by_membership_id),
    request_payload: json(row.request_payload) as QualityDataIntelligenceReport["request_payload"],
    request_fingerprint: text(row.request_fingerprint), status, result: resultValue,
    result_fingerprint: optionalText(row.result_fingerprint), failure_code: optionalText(row.failure_code),
    request_id: text(row.request_id), correlation_id: text(row.correlation_id), created_at: iso(row.created_at),
    finalized_at: row.finalized_at === null ? null : iso(row.finalized_at),
  };
}
function reviewEvent(row: Row): QualityDataIntelligenceReviewEvent {
  const decision = text(row.decision);
  if (decision !== "acknowledged" && decision !== "follow_up_requested" && decision !== "deferred") throw new Error("QUALITY_DATA_INTELLIGENCE_REVIEW_DECISION_INVALID");
  return {
    event_id: text(row.event_id), organization_id: text(row.organization_id), report_id: text(row.report_id),
    dataset_id: text(row.dataset_id), dataset_version_id: text(row.dataset_version_id), approval_event_id: text(row.approval_event_id),
    finding_key: text(row.finding_key), finding_fingerprint: text(row.finding_fingerprint), transition_number: count(row.transition_number),
    decision, reviewer_user_id: text(row.reviewer_user_id), reviewer_membership_id: text(row.reviewer_membership_id),
    occurred_at: iso(row.occurred_at), rationale: text(row.rationale), previous_event_id: optionalText(row.previous_event_id),
    request_id: text(row.request_id), correlation_id: text(row.correlation_id), idempotency_key: text(row.idempotency_key),
    request_fingerprint: text(row.request_fingerprint),
  };
}

async function reviewerAuthority(sql: postgres.TransactionSql, input: Pick<QualityDataIntelligenceReviewAppendInput, "organization_id" | "reviewer_user_id" | "reviewer_membership_id" | "now">): Promise<boolean> {
  const rows = await sql<Row[]>`
    select 1
    from public.capa_organization_memberships as membership
    join public.capa_organizations as organization on organization.organization_id = membership.organization_id
    join public.capa_role_assignments as assignment
      on assignment.organization_id = membership.organization_id
      and assignment.membership_id = membership.membership_id and assignment.user_id = membership.user_id
    join public.capa_roles as role on role.role_id = assignment.role_id
    where membership.organization_id = ${input.organization_id}::uuid
      and membership.membership_id = ${input.reviewer_membership_id}::uuid
      and membership.user_id = ${input.reviewer_user_id}::uuid
      and membership.status = 'active' and membership.effective_at <= ${input.now}::timestamptz
      and (membership.expires_at is null or membership.expires_at > ${input.now}::timestamptz)
      and organization.status = 'active' and organization.effective_at <= ${input.now}::timestamptz
      and (organization.superseded_at is null or organization.superseded_at > ${input.now}::timestamptz)
      and assignment.role_id = 'CAPA_ORG_ADMIN' and assignment.scope_code = 'ORGANIZATION'
      and assignment.scope_resource_type is null and assignment.scope_resource_id is null
      and assignment.status = 'active' and assignment.effective_at <= ${input.now}::timestamptz
      and (assignment.expires_at is null or assignment.expires_at > ${input.now}::timestamptz)
      and role.status = 'active' and role.human_authority
      and 'quality_data.intelligence.review' = any(role.permissions)
    for share of membership, organization, assignment, role limit 1
  `;
  return rows.length === 1;
}

export class SupabaseQualityDataStage3DRepository implements QualityDataStage3DRepository {
  constructor(private readonly database: postgres.Sql) {}

  async reserveReport(transaction: TransactionContext, input: QualityDataIntelligenceReportReservation): Promise<QualityDataIntelligenceReservationResult> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(${input.organization_id}), pg_catalog.hashtext(${"quality-data:intelligence:" + input.idempotency_key}))`;
    const authority = await sql<Row[]>`
      select 1 from public.capa_organization_memberships as membership
      join public.capa_organizations as organization on organization.organization_id = membership.organization_id
      join public.capa_role_assignments as assignment on assignment.organization_id = membership.organization_id
        and assignment.membership_id = membership.membership_id and assignment.user_id = membership.user_id
      join public.capa_roles as role on role.role_id = assignment.role_id
      where membership.organization_id = ${input.organization_id}::uuid
        and membership.membership_id = ${input.requested_by_membership_id}::uuid
        and membership.user_id = ${input.requested_by_user_id}::uuid
        and membership.status = 'active' and membership.effective_at <= ${input.now}::timestamptz
        and (membership.expires_at is null or membership.expires_at > ${input.now}::timestamptz)
        and organization.status = 'active' and organization.effective_at <= ${input.now}::timestamptz
        and (organization.superseded_at is null or organization.superseded_at > ${input.now}::timestamptz)
        and assignment.role_id = 'CAPA_ORG_ADMIN' and assignment.scope_code = 'ORGANIZATION'
        and assignment.scope_resource_type is null and assignment.scope_resource_id is null
        and assignment.status = 'active' and assignment.effective_at <= ${input.now}::timestamptz
        and (assignment.expires_at is null or assignment.expires_at > ${input.now}::timestamptz)
        and role.status = 'active' and role.human_authority
        and 'quality_data.source.read' = any(role.permissions)
    for share of membership, organization, assignment, role limit 1`;
    if (authority.length !== 1) return { status: "unauthorized" };

    const existingRows = await sql<Row[]>`
      select * from public.quality_data_intelligence_reports
      where organization_id = ${input.organization_id}::uuid and idempotency_key = ${input.idempotency_key}
      for update
    `;
    if (existingRows[0]) {
      const existing = report(existingRows[0]);
      if (existing.request_fingerprint !== input.request_fingerprint) return { status: "conflict" };
      return existing.status === "processing" ? { status: "in_progress", report_id: existing.report_id } : { status: "existing", report: existing };
    }

    const versions = await sql<Row[]>`
      select version.dataset_id, version.dataset_version_id
      from public.quality_data_dataset_versions as version
      join public.quality_data_datasets as dataset on dataset.organization_id = version.organization_id and dataset.dataset_id = version.dataset_id
      where version.organization_id = ${input.organization_id}::uuid
        and version.dataset_id = ${input.dataset_id}::uuid
        and version.dataset_version_id = ${input.dataset_version_id}::uuid
      for share of version, dataset
    `;
    if (versions.length !== 1) return { status: "unauthorized" };
    const approval = await sql<Row[]>`
      select approval_event_id, decision from public.quality_data_dataset_version_approval_events
      where organization_id = ${input.organization_id}::uuid and dataset_id = ${input.dataset_id}::uuid
        and dataset_version_id = ${input.dataset_version_id}::uuid
      order by transition_number desc limit 1`;
    if (approval[0]?.approval_event_id !== input.approval_event_id || approval[0]?.decision !== "approved") return { status: "unauthorized" };
    const rows = await sql<Row[]>`
      insert into public.quality_data_intelligence_reports (
        report_id, organization_id, dataset_id, dataset_version_id, approval_event_id,
        requested_by_user_id, requested_by_membership_id, request_payload, request_fingerprint,
        idempotency_key, request_id, correlation_id, created_at
      ) values (
        ${input.report_id}::uuid, ${input.organization_id}::uuid, ${input.dataset_id}::uuid,
        ${input.dataset_version_id}::uuid, ${input.approval_event_id}::uuid,
        ${input.requested_by_user_id}::uuid, ${input.requested_by_membership_id}::uuid,
        ${sql.json(input.request_payload as never)}, ${input.request_fingerprint}, ${input.idempotency_key},
        ${input.request_trace.request_id}::uuid, ${input.request_trace.correlation_id}::uuid, ${input.now}::timestamptz
      ) returning *`;
    return { status: "reserved", report: report(rows[0]!) };
  }

  async completeReport(transaction: TransactionContext, organizationId: string, reportId: string, resultValue: unknown, resultFingerprint: string, finalizedAt: string): Promise<QualityDataIntelligenceReport> {
    const sql = requireSupabaseTransaction(transaction);
    const parsed = qualityDataAiAnalysisResultSchema.parse(resultValue);
    const rows = await sql<Row[]>`
      update public.quality_data_intelligence_reports
      set status = 'complete', result_payload = ${sql.json(parsed)}, result_fingerprint = ${resultFingerprint}, finalized_at = ${finalizedAt}::timestamptz
      where organization_id = ${organizationId}::uuid and report_id = ${reportId}::uuid and status = 'processing'
      returning *`;
    if (!rows[0]) throw new Error("QUALITY_DATA_INTELLIGENCE_REPORT_FINALIZATION_FAILED");
    return report(rows[0]);
  }

  async failReport(transaction: TransactionContext, organizationId: string, reportId: string, failureCode: string, finalizedAt: string): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    const rows = await sql<Row[]>`
      update public.quality_data_intelligence_reports set status = 'failed', failure_code = ${failureCode}, finalized_at = ${finalizedAt}::timestamptz
      where organization_id = ${organizationId}::uuid and report_id = ${reportId}::uuid and status = 'processing'
      returning report_id`;
    if (!rows[0]) throw new Error("QUALITY_DATA_INTELLIGENCE_REPORT_FINALIZATION_FAILED");
  }

  async findReport(organizationId: string, reportId: string): Promise<QualityDataIntelligenceReport | null> {
    const rows = await this.database<Row[]>`
      select * from public.quality_data_intelligence_reports
      where organization_id = ${organizationId}::uuid and report_id = ${reportId}::uuid limit 1`;
    return rows[0] ? report(rows[0]) : null;
  }

  async listReviewHistory(organizationId: string, reportId: string, findingKey?: string): Promise<QualityDataIntelligenceReviewHistory> {
    const rows = await this.database<Row[]>`
      select * from public.quality_data_intelligence_review_events
      where organization_id = ${organizationId}::uuid and report_id = ${reportId}::uuid
        and (${findingKey ?? null}::text is null or finding_key = ${findingKey ?? null})
      order by finding_key, transition_number asc`;
    const events = rows.map(reviewEvent);
    const current = new Map<string, number>();
    for (const event of events) current.set(event.finding_key, Math.max(current.get(event.finding_key) ?? 0, event.transition_number));
    return { current_transition_number: findingKey ? current.get(findingKey) ?? 0 : Math.max(0, ...current.values()), events };
  }

  async appendReview(transaction: TransactionContext, input: QualityDataIntelligenceReviewAppendInput): Promise<QualityDataIntelligenceReviewAppendResult> {
    const sql = requireSupabaseTransaction(transaction);
    if (!await reviewerAuthority(sql, input)) return { status: "unauthorized" };
    const reportRows = await sql<Row[]>`
      select * from public.quality_data_intelligence_reports
      where organization_id = ${input.organization_id}::uuid and report_id = ${input.command.report_id}::uuid
        and status = 'complete'
      for update`;
    const reportRow = reportRows[0];
    if (!reportRow) return { status: "not_found" };
    const versions = await sql<Row[]>`
      select dataset_id, dataset_version_id from public.quality_data_dataset_versions
      where organization_id = ${input.organization_id}::uuid
        and dataset_id = ${String(reportRow.dataset_id)}::uuid
        and dataset_version_id = ${String(reportRow.dataset_version_id)}::uuid
      for share`;
    if (versions.length !== 1) return { status: "not_found" };
    const currentApproval = await sql<Row[]>`
      select event.approval_event_id from public.quality_data_dataset_version_approval_events as event
      where event.organization_id = ${input.organization_id}::uuid
        and event.dataset_id = ${String(reportRow.dataset_id)}::uuid
        and event.dataset_version_id = ${String(reportRow.dataset_version_id)}::uuid
      order by event.transition_number desc limit 1`;
    if (currentApproval[0]?.approval_event_id !== reportRow.approval_event_id) return { status: "not_found" };

    const priorByKey = await sql<Row[]>`
      select * from public.quality_data_intelligence_review_events
      where organization_id = ${input.organization_id}::uuid and idempotency_key = ${input.request_trace.idempotency_key}
      limit 1`;
    if (priorByKey[0]) {
      const event = reviewEvent(priorByKey[0]);
      return event.request_fingerprint === input.request_fingerprint
        ? { status: "already_recorded", event }
        : { status: "conflict", reason_code: "IDEMPOTENCY_KEY_REUSED" };
    }
    const latestRows = await sql<Row[]>`
      select event_id, transition_number from public.quality_data_intelligence_review_events
      where organization_id = ${input.organization_id}::uuid and report_id = ${input.command.report_id}::uuid
        and finding_key = ${input.command.finding_key}
      order by transition_number desc limit 1`;
    const previous = latestRows[0];
    const currentNumber = previous ? count(previous.transition_number) : 0;
    if (currentNumber !== input.command.expected_transition_number) return { status: "conflict", reason_code: "STALE_TRANSITION" };
    const rows = await sql<Row[]>`
      insert into public.quality_data_intelligence_review_events (
        event_id, organization_id, report_id, dataset_id, dataset_version_id, approval_event_id,
        finding_key, finding_fingerprint, transition_number, decision, reviewer_user_id,
        reviewer_membership_id, occurred_at, rationale, previous_event_id, request_id,
        correlation_id, idempotency_key, request_fingerprint
      ) values (
        ${input.event_id}::uuid, ${input.organization_id}::uuid, ${input.command.report_id}::uuid,
        ${String(reportRow.dataset_id)}::uuid, ${String(reportRow.dataset_version_id)}::uuid,
        ${String(reportRow.approval_event_id)}::uuid, ${input.command.finding_key}, ${input.finding_fingerprint},
        ${currentNumber + 1}, ${input.command.decision}, ${input.reviewer_user_id}::uuid,
        ${input.reviewer_membership_id}::uuid, ${input.now}::timestamptz, ${input.command.rationale},
        ${previous ? String(previous.event_id) : null}::uuid, ${input.request_trace.request_id}::uuid,
        ${input.request_trace.correlation_id}::uuid, ${input.request_trace.idempotency_key}, ${input.request_fingerprint}
      ) returning *`;
    return { status: "applied", event: reviewEvent(rows[0]!) };
  }
}
