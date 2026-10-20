import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import type { QualityDataCapaHandoffDependencies } from "./quality-data-capa-handoff-service";
import { qualityDataIntelligenceResultFingerprint } from "./quality-data-intelligence-fingerprint";
import { resolveQualityDataIntelligenceFinding } from "./quality-data-intelligence-finding";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QualityDataCapaEvidenceLookup =
  | { readonly status: "found"; readonly report_id: string; readonly handoff_id: string; readonly finding_key: string; readonly finding_classification: string }
  | { readonly status: "denied" | "not_found_or_not_authorized" | "not_approved" | "unavailable" | "invalid_request" };

/** Resolves only a linked S00 handoff in the caller's organization while source-read and exact-version approval remain current. */
export async function getQualityDataCapaSupportingEvidence(
  dependencies: QualityDataCapaHandoffDependencies,
  context: CapaRequestContext,
  caseId: string,
): Promise<QualityDataCapaEvidenceLookup> {
  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime()) || !isHumanPrincipal(context.authentication) || !isSessionActive(context.authentication, now)
    || context.owner_user_id !== context.authentication.principal.user_id || !UUID.test(context.tenant.organization_id)
    || !UUID.test(context.authentication.principal.user_id) || !UUID.test(caseId)) return { status: "invalid_request" };
  const read = await dependencies.authorizer.authorizeRead(context, now).catch(() => ({ allowed: false as const, reason_code: "QUALITY_DATA_PERMISSION_DENIED" as const }));
  if (!read.allowed || read.organization_id !== context.tenant.organization_id) return { status: "denied" };
  let link;
  try { link = await dependencies.handoff_repository.findLinkedForCase(read.organization_id, caseId); }
  catch { return { status: "unavailable" }; }
  if (!link || link.capa_case_status !== "S00" || link.organization_id !== read.organization_id || link.capa_case_id !== caseId) {
    return { status: "not_found_or_not_authorized" };
  }
  const report = await dependencies.stage3d_repository.findReport(read.organization_id, link.report_id).catch(() => null);
  if (!report || report.organization_id !== read.organization_id || report.status !== "complete" || !report.result || !report.result_fingerprint
    || report.dataset_id !== link.dataset_id || report.dataset_version_id !== link.dataset_version_id
    || report.approval_event_id !== link.approval_event_id
    || report.request_payload.dataset_version_id !== report.dataset_version_id
    || report.result_fingerprint !== link.result_fingerprint
    || report.result.interpretation_status === undefined
    || qualityDataIntelligenceResultFingerprint(report.result) !== report.result_fingerprint) {
    return { status: "not_found_or_not_authorized" };
  }
  const deterministic = report.result.interpretation_status === "not_requested";
  if (deterministic
    ? report.request_payload.schema_version !== "quality-data-deterministic-analysis-request-1.0.0"
      || report.result.schema_version !== "quality-data-deterministic-analysis-result-1.0.0"
    : report.request_payload.schema_version !== "quality-data-ai-analysis-request-1.0.0"
      || report.result.schema_version !== "quality-data-ai-analysis-result-1.0.0") {
    return { status: "not_found_or_not_authorized" };
  }
  const finding = resolveQualityDataIntelligenceFinding(report.result, link.finding_key);
  if (!finding || finding.classification !== link.finding_classification || finding.fingerprint !== link.finding_fingerprint) {
    return { status: "not_found_or_not_authorized" };
  }
  const current = await dependencies.quality_data.repository.findApprovedDatasetVersion({
    organization_id: read.organization_id, membership_id: read.membership_id,
    user_id: read.uploader_user_id, now: now.toISOString(),
  }, link.dataset_version_id).catch(() => null);
  if (!current || current.status !== "approved" || current.approval.approval_event_id !== link.approval_event_id
    || current.snapshot.dataset.dataset_id !== link.dataset_id) return { status: "not_approved" };
  return { status: "found", report_id: report.report_id, handoff_id: link.handoff_id,
    finding_key: link.finding_key, finding_classification: link.finding_classification };
}
