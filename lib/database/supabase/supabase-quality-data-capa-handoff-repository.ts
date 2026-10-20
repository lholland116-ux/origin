import type postgres from "postgres";
import { QUALITY_DATA_INTELLIGENCE_REPORT_VERSION, qualityDataIntelligenceResultSchema } from "../../quality-data/quality-data-intelligence-contract";
import { resolveQualityDataIntelligenceFinding } from "../../quality-data/quality-data-intelligence-finding";
import type { QualityDataCapaHandoffReserveInput, QualityDataCapaHandoffReserveResult, QualityDataCapaHandoffLinkInput, QualityDataCapaHandoffRepository, QualityDataCapaHandoffStoredRecord, QualityDataCapaEvidenceLink } from "../repositories/quality-data-capa-handoff-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

type Row = postgres.Row & Readonly<Record<string, unknown>>;
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("QUALITY_DATA_CAPA_HANDOFF_DATABASE_VALUE_INVALID");
  return value;
}
function json(value: unknown): unknown {
  if (typeof value === "string") {
    try { return JSON.parse(value) as unknown; } catch { throw new Error("QUALITY_DATA_CAPA_HANDOFF_DATABASE_JSON_INVALID"); }
  }
  return value;
}
function stored(row: Row): QualityDataCapaHandoffStoredRecord {
  const classification = text(row.finding_classification);
  if (!["deterministic_signal", "deterministic_calculation", "advisory_hypothesis", "advisory_uncertainty", "advisory_investigation_step"].includes(classification)) throw new Error("QUALITY_DATA_CAPA_HANDOFF_CLASSIFICATION_INVALID");
  if (row.decision !== "create_capa_draft") throw new Error("QUALITY_DATA_CAPA_HANDOFF_DECISION_INVALID");
  return {
    handoff_id: text(row.handoff_id), organization_id: text(row.organization_id), report_id: text(row.report_id),
    finding_key: text(row.finding_key), finding_classification: classification as QualityDataCapaHandoffStoredRecord["finding_classification"],
    finding_fingerprint: text(row.finding_fingerprint), result_fingerprint: text(row.result_fingerprint),
    reviewer_user_id: text(row.reviewer_user_id), decision: "create_capa_draft",
    capa_case_id: row.capa_case_id === null ? null : text(row.capa_case_id),
    capa_case_status: row.capa_case_status === null ? null : text(row.capa_case_status),
  };
}
async function handoffAuthority(sql: postgres.TransactionSql, input: QualityDataCapaHandoffReserveInput): Promise<boolean> {
  const member = await sql<Row[]>
    `select membership.membership_id
      from public.capa_organization_memberships as membership
      join public.capa_organizations as organization on organization.organization_id = membership.organization_id
      where membership.organization_id = ${input.organization_id}::uuid
        and membership.membership_id = ${input.reviewer_membership_id}::uuid
        and membership.user_id = ${input.reviewer_user_id}::uuid
        and membership.status = 'active' and membership.effective_at <= ${input.now}::timestamptz
        and (membership.expires_at is null or membership.expires_at > ${input.now}::timestamptz)
        and organization.status = 'active' and organization.effective_at <= ${input.now}::timestamptz
        and (organization.superseded_at is null or organization.superseded_at > ${input.now}::timestamptz)
      for share of membership, organization`;
  if (member.length !== 1) return false;
  const assignments = await sql<Row[]>
    `select assignment.role_id, role.permissions
      from public.capa_role_assignments as assignment
      join public.capa_roles as role on role.role_id = assignment.role_id
      where assignment.organization_id = ${input.organization_id}::uuid
        and assignment.membership_id = ${input.reviewer_membership_id}::uuid
        and assignment.user_id = ${input.reviewer_user_id}::uuid
        and assignment.scope_code = 'ORGANIZATION'
        and assignment.scope_resource_type is null and assignment.scope_resource_id is null
        and assignment.status = 'active' and assignment.effective_at <= ${input.now}::timestamptz
        and (assignment.expires_at is null or assignment.expires_at > ${input.now}::timestamptz)
        and role.status = 'active' and role.human_authority
      for share of assignment, role`;
  let readAndReview = false;
  let canCreate = false;
  for (const assignment of assignments) {
    if (!Array.isArray(assignment.permissions) || assignment.permissions.some((permission) => typeof permission !== "string")) continue;
    const permissions = assignment.permissions as string[];
    if (assignment.role_id === "CAPA_ORG_ADMIN" && permissions.includes("quality_data.source.read") && permissions.includes("quality_data.intelligence.review")) readAndReview = true;
    if (permissions.includes("capa.case.create")) canCreate = true;
  }
  return readAndReview && canCreate;
}

export class SupabaseQualityDataCapaHandoffRepository implements QualityDataCapaHandoffRepository {
  constructor(private readonly database: postgres.Sql) {}

  async reserveDecision(transaction: TransactionContext, input: QualityDataCapaHandoffReserveInput): Promise<QualityDataCapaHandoffReserveResult> {
    const sql = requireSupabaseTransaction(transaction);
    if (input.decision !== "create_capa_draft" || !await handoffAuthority(sql, input)) return { status: "unauthorized" };
    const idempotencyLock = "quality-capa-handoff-idem:" + input.idempotency_key;
    const findingLock = "quality-capa-handoff-finding:" + input.report_id + ":" + input.finding_key;
    await sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(${input.organization_id}), pg_catalog.hashtext(${idempotencyLock}))`;
    await sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(${input.organization_id}), pg_catalog.hashtext(${findingLock}))`;

    const byKey = await sql<Row[]>`
      select * from public.quality_data_intelligence_capa_handoffs
      where organization_id = ${input.organization_id}::uuid and idempotency_key = ${input.idempotency_key}
      for update
    `;
    if (byKey[0]) {
      const existing = stored(byKey[0]);
      return String(byKey[0].request_fingerprint) === input.request_fingerprint && String(byKey[0].handoff_status) === "linked"
        ? { status: "already_created", record: existing } : { status: "conflict" };
    }
    const byFinding = await sql<Row[]>`
      select handoff_id from public.quality_data_intelligence_capa_handoffs
      where organization_id = ${input.organization_id}::uuid and report_id = ${input.report_id}::uuid and finding_key = ${input.finding_key}
      for update
    `;
    if (byFinding.length > 0) return { status: "conflict" };

    const reports = await sql<Row[]>`
      select report_id, dataset_id, dataset_version_id, approval_event_id, status,
        request_payload, result_payload, result_fingerprint
      from public.quality_data_intelligence_reports
      where organization_id = ${input.organization_id}::uuid and report_id = ${input.report_id}::uuid
      for update
    `;
    const report = reports[0];
    if (!report || report.status !== "complete" || report.result_payload === null) return { status: "not_found" };
    if (report.result_fingerprint !== input.expected_result_fingerprint) return { status: "stale_evidence" };
    const result = qualityDataIntelligenceResultSchema.parse(json(report.result_payload));
    const resolved = resolveQualityDataIntelligenceFinding(result, input.finding_key);
    if (!resolved || resolved.fingerprint !== input.expected_finding_fingerprint) return { status: "stale_evidence" };

    const versions = await sql<Row[]>`
      select version.dataset_id, version.schema_version
      from public.quality_data_dataset_versions as version
      join public.quality_data_datasets as dataset on dataset.organization_id = version.organization_id and dataset.dataset_id = version.dataset_id
      where version.organization_id = ${input.organization_id}::uuid
        and version.dataset_id = ${String(report.dataset_id)}::uuid
        and version.dataset_version_id = ${String(report.dataset_version_id)}::uuid
      for update of version, dataset
    `;
    if (versions.length !== 1) return { status: "not_found" };
    const approval = await sql<Row[]>`
      select event.approval_event_id, event.decision
      from public.quality_data_dataset_version_approval_events as event
      where event.organization_id = ${input.organization_id}::uuid
        and event.dataset_id = ${String(report.dataset_id)}::uuid
        and event.dataset_version_id = ${String(report.dataset_version_id)}::uuid
      order by event.transition_number desc limit 1
    `;
    if (approval[0]?.approval_event_id !== report.approval_event_id || approval[0]?.decision !== "approved") return { status: "stale_evidence" };

    const rows = await sql<Row[]>`
      insert into public.quality_data_intelligence_capa_handoffs (
        handoff_id, organization_id, report_id, dataset_id, dataset_version_id, approval_event_id,
        intelligence_schema_version, analysis_request_schema_version, analysis_result_schema_version,
        evidence_packet_version, dataset_schema_version, result_fingerprint, finding_key,
        finding_classification, finding_fingerprint, finding_snapshot, evidence_references,
        source_verification, interpretation_status, decision, decision_rationale,
        reviewer_user_id, reviewer_membership_id, decided_at, request_id, correlation_id,
        idempotency_key, request_fingerprint, handoff_status
      ) values (
        ${input.handoff_id}::uuid, ${input.organization_id}::uuid, ${input.report_id}::uuid,
        ${String(report.dataset_id)}::uuid, ${String(report.dataset_version_id)}::uuid, ${String(report.approval_event_id)}::uuid,
        ${QUALITY_DATA_INTELLIGENCE_REPORT_VERSION}, ${report.request_payload.schema_version}, ${result.schema_version},
        ${result.packet_version}, ${String(versions[0]!.schema_version)}, ${String(report.result_fingerprint)}, ${input.finding_key},
        ${resolved.classification}, ${resolved.fingerprint}, ${sql.json(resolved.value as never)},
        ${sql.json(resolved.citations as never)}, 'not_asserted', ${result.interpretation_status},
        ${input.decision}, ${input.rationale}, ${input.reviewer_user_id}::uuid, ${input.reviewer_membership_id}::uuid,
        ${input.now}::timestamptz, ${input.request_id}::uuid, ${input.correlation_id}::uuid,
        ${input.idempotency_key}, ${input.request_fingerprint}, 'pending'
      ) returning *
    `;
    return { status: "reserved", record: stored(rows[0]!) };
  }

  async linkCreatedDraft(transaction: TransactionContext, input: QualityDataCapaHandoffLinkInput): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    if (input.capa_case_status !== "S00") throw new Error("QUALITY_DATA_CAPA_HANDOFF_DRAFT_STATE_INVALID");
    const rows = await sql<Row[]>`
      update public.quality_data_intelligence_capa_handoffs
      set handoff_status = 'linked', capa_case_id = ${input.capa_case_id}::uuid,
        capa_case_status = ${input.capa_case_status}, capa_case_version_id = ${input.capa_case_version_id}::uuid,
        capa_section_version_id = ${input.capa_section_version_id}::uuid,
        capa_creation_audit_event_id = ${input.capa_creation_audit_event_id}::uuid,
        handoff_audit_event_id = ${input.handoff_audit_event_id}::uuid
      where organization_id = ${input.organization_id}::uuid and handoff_id = ${input.handoff_id}::uuid
        and handoff_status = 'pending'
      returning handoff_id
    `;
    if (rows.length !== 1) throw new Error("QUALITY_DATA_CAPA_HANDOFF_LINK_FAILED");
  }

  async findLinkedForCase(organizationId: string, caseId: string): Promise<QualityDataCapaEvidenceLink | null> {
    const rows = await this.database<Row[]>`
      select handoff_id, organization_id, report_id, dataset_id, dataset_version_id,
        approval_event_id, finding_key, finding_classification, finding_fingerprint, result_fingerprint,
        capa_case_id, capa_case_status
      from public.quality_data_intelligence_capa_handoffs
      where organization_id = ${organizationId}::uuid and capa_case_id = ${caseId}::uuid
        and handoff_status = 'linked' and capa_case_status = 'S00'
      limit 2
    `;
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    const classification = text(row.finding_classification);
    if (!["deterministic_signal", "deterministic_calculation", "advisory_hypothesis", "advisory_uncertainty", "advisory_investigation_step"].includes(classification)) return null;
    return {
      handoff_id: text(row.handoff_id), organization_id: text(row.organization_id), report_id: text(row.report_id),
      dataset_id: text(row.dataset_id), dataset_version_id: text(row.dataset_version_id), approval_event_id: text(row.approval_event_id),
      finding_key: text(row.finding_key), finding_classification: classification as QualityDataCapaEvidenceLink["finding_classification"],
      finding_fingerprint: text(row.finding_fingerprint), result_fingerprint: text(row.result_fingerprint),
      capa_case_id: text(row.capa_case_id), capa_case_status: text(row.capa_case_status),
    };
  }
}
