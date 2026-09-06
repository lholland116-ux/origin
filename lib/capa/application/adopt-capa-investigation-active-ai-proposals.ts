import type { ActorReference, AuditEvent, AuditEventId, CapaCaseId, RequestTrace, UserId } from "../domain/capa-types";
import { fingerprintCanonicalJson } from "../ai/capa-ai-generation-trace";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
  type CapaInvestigationActiveAdoptionIntentRequest,
  type CapaInvestigationActiveAdoptedContent,
  type CapaInvestigationActiveAdoptionRecord,
} from "../ai/capa-investigation-active-adoption-contract";
import {
  constructCapaInvestigationActiveAdoption,
  validateCapaInvestigationActiveAdoptedContent,
} from "../ai/capa-investigation-active-adoption-validator";
import type { CapaInvestigationActiveAdoptionAuthorizer } from "../authorization/capa-investigation-active-adoption-authorizer";
import type { TenantContext } from "../../security/tenant-context";
import type { CreateCapaClock } from "./create-capa";
import type { AuditRepository } from "../../database/repositories/audit-repository";
import type { TransactionManager } from "../../database/transactions";
import type {
  CapaInvestigationActiveAdoptionPersistenceInput,
  CapaInvestigationActiveAdoptionRepository,
  PersistedCapaInvestigationActiveAdoption,
} from "../../database/repositories/capa-investigation-active-adoption-repository";
import type { CapaInvestigationActiveAdoptionSourceResolver } from "./capa-investigation-active-adoption-source-resolver";
import type { CapaInvestigationActiveWorkspaceDraftRepository } from "../../database/repositories/capa-investigation-active-workspace-draft-repository";
import type { CapaInvestigationActiveWorkspaceDraft } from "./capa-investigation-active-workspace-draft-contract";
import { validateCapaInvestigationActiveWorkspaceDraft } from "./capa-investigation-active-workspace-draft-validator";
import { materializeCapaInvestigationActiveAdoptions } from "./capa-investigation-active-adoption-workspace-materializer";

export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_OPERATION = "ADOPT_CAPA_INVESTIGATION_ACTIVE_AI_PROPOSALS" as const;
export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_REQUEST_FINGERPRINT_VERSION = "capa-investigation-active-adoption-request-fingerprint-1" as const;
const AUDIT_EVENT_TYPE = "EVT-AI-PROPOSAL-ADOPTED";
const AUDIT_OBJECT_TYPE = "CAPA_INVESTIGATION_ACTIVE_ADOPTION";

export interface AdoptCapaInvestigationActiveAiProposalsCommand {
  readonly capa_case_id: CapaCaseId;
  readonly adoption_intent: CapaInvestigationActiveAdoptionIntentRequest;
  readonly request_trace: RequestTrace;
}
export interface CapaInvestigationActiveAdoptionIdGenerator {
  generateAdoptionId(): CapaInvestigationActiveAdoptionRecord["adoption_id"];
  generateAuditEventId(): AuditEventId;
}
export interface CapaInvestigationActiveAdoptionConfiguration { readonly audit_schema_version: string; }
export interface AdoptCapaInvestigationActiveAiProposalsDependencies {
  readonly tenant: TenantContext;
  readonly adopter: ActorReference & { readonly actor_type: "human" };
  readonly transaction_manager: TransactionManager;
  readonly adoption_repository: CapaInvestigationActiveAdoptionRepository;
  readonly audit_repository: AuditRepository;
  readonly authorizer: CapaInvestigationActiveAdoptionAuthorizer;
  readonly source_resolver: CapaInvestigationActiveAdoptionSourceResolver;
  readonly workspace_repository: CapaInvestigationActiveWorkspaceDraftRepository;
  readonly id_generator: CapaInvestigationActiveAdoptionIdGenerator;
  readonly clock: CreateCapaClock;
  readonly configuration: CapaInvestigationActiveAdoptionConfiguration;
}
type Success = { readonly status: "adopted" | "already_adopted"; readonly records: readonly PersistedCapaInvestigationActiveAdoption[]; readonly workspace: CapaInvestigationActiveWorkspaceDraft };
export type AdoptCapaInvestigationActiveAiProposalsResult =
  | Success
  | { readonly status: "authorization_denied"; readonly reason_code: "ADOPTION_NOT_AUTHORIZED" }
  | { readonly status: "output_not_found_or_not_authorized" }
  | { readonly status: "output_not_adoptable" }
  | { readonly status: "case_changed" }
  | { readonly status: "workspace_conflict" }
  | { readonly status: "idempotency_conflict" };

export class CapaInvestigationActiveAdoptionIdempotencyConfigurationError extends Error {
  constructor() { super("CAPA investigation-active adoption requires a valid idempotency key."); this.name = "CapaInvestigationActiveAdoptionIdempotencyConfigurationError"; }
}
export class CapaInvestigationActiveAdoptionIntegrityError extends Error {
  constructor(message = "The CAPA investigation-active adoption is inconsistent.") { super(message); this.name = "CapaInvestigationActiveAdoptionIntegrityError"; }
}
class BatchAbort extends Error { constructor(readonly result: AdoptCapaInvestigationActiveAiProposalsResult) { super("The CAPA investigation-active adoption batch must roll back."); } }

function idempotencyKey(trace: RequestTrace): string {
  const value = trace.idempotency_key;
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || value.trim() !== value) throw new CapaInvestigationActiveAdoptionIdempotencyConfigurationError();
  return value;
}
function stableSelected(intent: CapaInvestigationActiveAdoptionIntentRequest, resolved: Awaited<ReturnType<CapaInvestigationActiveAdoptionSourceResolver["resolve"]>> & { readonly status: "resolved" }, normalizedContent: ReadonlyMap<string, unknown>) {
  const byKey = new Map(resolved.selected_proposals.map((proposal) => [proposal.proposal_key, proposal]));
  return [...intent.selected_items].sort((a, b) => Number(a.proposal_key.slice(1)) - Number(b.proposal_key.slice(1))).map((item) => ({ proposal_key: item.proposal_key, proposal_category: byKey.get(item.proposal_key as never)?.proposal_category, adopted_content: normalizedContent.get(item.proposal_key), ...(item.human_causal_role === undefined ? {} : { human_causal_role: item.human_causal_role }) }));
}
function requestFingerprint(dependencies: AdoptCapaInvestigationActiveAiProposalsDependencies, command: AdoptCapaInvestigationActiveAiProposalsCommand, resolved: Awaited<ReturnType<CapaInvestigationActiveAdoptionSourceResolver["resolve"]>> & { readonly status: "resolved" }, normalizedContent: ReadonlyMap<string, unknown>): CapaInvestigationActiveAdoptionPersistenceInput["request_fingerprint"] {
  return fingerprintCanonicalJson({ fingerprint_version: CAPA_INVESTIGATION_ACTIVE_ADOPTION_REQUEST_FINGERPRINT_VERSION, operation: CAPA_INVESTIGATION_ACTIVE_ADOPTION_OPERATION, organization_id: dependencies.tenant.organization_id, capa_case_id: command.capa_case_id, expected_case_version_id: command.adoption_intent.expected_case_version_id, expected_record_version: command.adoption_intent.expected_record_version, output_id: command.adoption_intent.output_id, adopted_by: { actor_type: dependencies.adopter.actor_type, actor_id: dependencies.adopter.actor_id }, selected_items: stableSelected(command.adoption_intent, resolved, normalizedContent), adoption_policy_version: CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION }) as CapaInvestigationActiveAdoptionPersistenceInput["request_fingerprint"];
}
function auditEvent(dependencies: AdoptCapaInvestigationActiveAiProposalsDependencies, command: AdoptCapaInvestigationActiveAiProposalsCommand, record: PersistedCapaInvestigationActiveAdoption): AuditEvent {
  const adoption = record.adoption;
  return { organization_id: adoption.organization_id, event_id: record.audit_event_id, event_type: AUDIT_EVENT_TYPE as never, schema_version: dependencies.configuration.audit_schema_version, aggregate_type: "CAPA_CASE" as never, aggregate_id: adoption.capa_case_id, aggregate_version: adoption.record_version, actor: adoption.adopted_by, occurred_at: adoption.adopted_at, request_id: adoption.request_id, correlation_id: adoption.correlation_id, idempotency_key: adoption.idempotency_key, action: CAPA_INVESTIGATION_ACTIVE_ADOPTION_OPERATION as never, target: { object_type: AUDIT_OBJECT_TYPE as never, object_id: adoption.adoption_id }, outcome: "succeeded", configuration_versions: { adoption_policy: adoption.adoption_policy_version, audit_schema: dependencies.configuration.audit_schema_version, reference_manifest: adoption.reference_manifest_schema_version }, metadata: { capa_case_id: adoption.capa_case_id, case_version_id: adoption.case_version_id, record_version: adoption.record_version, output_id: adoption.output_id, proposal_key: adoption.proposal_key, proposal_category: adoption.proposal_category, adoption_id: adoption.adoption_id, adopted_by_user_id: adoption.adopted_by.actor_id, adopted_at: adoption.adopted_at, adoption_policy_version: adoption.adoption_policy_version, reference_manifest_sha256: adoption.reference_manifest_sha256, workflow_mutated: false, controlled_record_mutated: false, gate_approved: false, request_id: command.request_trace.request_id, correlation_id: command.request_trace.correlation_id } };
}
function assertPersisted(record: PersistedCapaInvestigationActiveAdoption, input: CapaInvestigationActiveAdoptionPersistenceInput): void {
  if (record.adoption.organization_id !== input.adoption.organization_id || record.adoption.capa_case_id !== input.adoption.capa_case_id || record.adoption.proposal_key !== input.adoption.proposal_key || record.adoption.output_id !== input.adoption.output_id || record.adoption.idempotency_key !== input.adoption.idempotency_key || record.request_fingerprint !== input.request_fingerprint) throw new CapaInvestigationActiveAdoptionIntegrityError();
}

function loadedWorkspace(value: CapaInvestigationActiveWorkspaceDraft | null, organizationId: string, capaCaseId: CapaCaseId): CapaInvestigationActiveWorkspaceDraft | null {
  if (value === null) return null;
  const result = validateCapaInvestigationActiveWorkspaceDraft(value);
  if (result.status !== "valid" || result.value.organization_id !== organizationId || result.value.capa_case_id !== capaCaseId) throw new CapaInvestigationActiveAdoptionIntegrityError();
  return result.value;
}

export async function adoptCapaInvestigationActiveAiProposals(dependencies: AdoptCapaInvestigationActiveAiProposalsDependencies, command: AdoptCapaInvestigationActiveAiProposalsCommand): Promise<AdoptCapaInvestigationActiveAiProposalsResult> {
  const key = idempotencyKey(command.request_trace);
  let now: Date; try { now = dependencies.clock.now(); } catch { return { status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" }; }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" };
  const intent = command.adoption_intent;
  let authorized = false;
  try { authorized = await dependencies.authorizer.authorize({ organization_id: dependencies.tenant.organization_id, capa_case_id: command.capa_case_id, case_version_id: intent.expected_case_version_id, record_version: intent.expected_record_version, output_id: intent.output_id, adopter: { ...dependencies.adopter, actor_id: dependencies.adopter.actor_id as UserId }, trusted_now: now }); } catch { authorized = false; }
  if (!authorized) return { status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" };
  const resolved = await dependencies.source_resolver.resolve({ organization_id: dependencies.tenant.organization_id, capa_case_id: command.capa_case_id, expected_case_version_id: intent.expected_case_version_id, expected_record_version: intent.expected_record_version, output_id: intent.output_id, proposal_keys: intent.selected_items.map((item) => item.proposal_key as never) });
  if (resolved.status !== "resolved") return resolved;
  if (resolved.organization_id !== dependencies.tenant.organization_id || resolved.capa_case_id !== command.capa_case_id || resolved.case_version_id !== intent.expected_case_version_id || resolved.record_version !== intent.expected_record_version || resolved.output_id !== intent.output_id || resolved.selected_proposals.length !== intent.selected_items.length) throw new CapaInvestigationActiveAdoptionIntegrityError();
  const proposals = new Map(resolved.selected_proposals.map((proposal) => [proposal.proposal_key, proposal]));
  const normalizedContent = new Map<string, CapaInvestigationActiveAdoptedContent>();
  for (const item of intent.selected_items) {
    const proposal = proposals.get(item.proposal_key as never); if (proposal === undefined) throw new CapaInvestigationActiveAdoptionIntegrityError();
    normalizedContent.set(item.proposal_key, validateCapaInvestigationActiveAdoptedContent(proposal.proposal_category, item.adopted_content));
  }
  const fingerprint = requestFingerprint(dependencies, command, resolved, normalizedContent);
  const adoptedAt = now.toISOString() as CapaInvestigationActiveAdoptionRecord["adopted_at"];
  const existingWorkspace = loadedWorkspace(await dependencies.workspace_repository.findDraft(dependencies.tenant.organization_id, command.capa_case_id), dependencies.tenant.organization_id, command.capa_case_id);
  const inputs = intent.selected_items.map((item) => {
    const proposal = proposals.get(item.proposal_key as never); if (proposal === undefined) throw new CapaInvestigationActiveAdoptionIntegrityError();
    const adoptedContent = normalizedContent.get(item.proposal_key); if (adoptedContent === undefined) throw new CapaInvestigationActiveAdoptionIntegrityError();
    const adoption = constructCapaInvestigationActiveAdoption({ adoption_id: dependencies.id_generator.generateAdoptionId(), organization_id: dependencies.tenant.organization_id, capa_case_id: command.capa_case_id, case_version_id: intent.expected_case_version_id, record_version: intent.expected_record_version, output_id: intent.output_id, proposal_key: item.proposal_key, proposal_category: proposal.proposal_category, adopted_item: { proposal_key: item.proposal_key, adopted_content: adoptedContent, ...(item.human_causal_role === undefined ? {} : { human_causal_role: item.human_causal_role }) }, resolved_reference_bindings: proposal.resolved_reference_bindings, reference_manifest_schema_version: resolved.reference_manifest_schema_version, reference_manifest_fingerprint_algorithm: resolved.reference_manifest_fingerprint_algorithm, reference_manifest_sha256: resolved.reference_manifest_sha256, adopted_at: adoptedAt, adopted_by: dependencies.adopter, adoption_policy_version: CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION, request_id: command.request_trace.request_id, correlation_id: command.request_trace.correlation_id, idempotency_key: key as never, workflow_mutated: false, controlled_record_mutated: false, gate_approved: false });
    return { adoption, request_fingerprint: fingerprint, record_fingerprint: fingerprintCanonicalJson(adoption) as CapaInvestigationActiveAdoptionPersistenceInput["record_fingerprint"], audit_event_id: dependencies.id_generator.generateAuditEventId() };
  });
  try { return await dependencies.transaction_manager.runInTransaction(command.request_trace, async (transaction) => { let mode: "saved" | "already_recorded" | undefined; const records: PersistedCapaInvestigationActiveAdoption[] = []; for (const input of inputs) { const append = await dependencies.adoption_repository.appendAdoption(transaction, input); if (append.status === "case_changed") throw new BatchAbort({ status: "case_changed" }); if (append.status === "output_not_found_or_not_authorized" || append.status === "output_not_adoptable") throw new BatchAbort({ status: append.status }); if (append.status === "conflict") { if (append.reason_code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST") throw new BatchAbort({ status: "idempotency_conflict" }); throw new CapaInvestigationActiveAdoptionIntegrityError(); } assertPersisted(append.record, input); if (append.status === "saved" && (append.record.adoption.adoption_id !== input.adoption.adoption_id || append.record.record_fingerprint !== input.record_fingerprint || append.record.audit_event_id !== input.audit_event_id)) throw new CapaInvestigationActiveAdoptionIntegrityError(); const next = append.status === "saved" ? "saved" : "already_recorded"; if (mode !== undefined && mode !== next) throw new CapaInvestigationActiveAdoptionIntegrityError("A logical adoption batch mixed newly saved and replayed records."); mode = next; if (append.status === "saved") { const audit = await dependencies.audit_repository.appendEvent(transaction, auditEvent(dependencies, command, append.record)); if (audit.status !== "appended" || audit.event_id !== append.record.audit_event_id) throw new CapaInvestigationActiveAdoptionIntegrityError("The adoption audit event was not appended atomically."); } records.push(append.record); } if (mode === undefined) throw new CapaInvestigationActiveAdoptionIntegrityError("An adoption batch contained no selected proposals.");
      const baseLedger = existingWorkspace?.evidence_assumption_ledger ?? { items: [] };
      const basePackage = existingWorkspace?.root_cause_package ?? { hypotheses: [], root_cause_not_confirmed: null };
      const materialized = materializeCapaInvestigationActiveAdoptions({ ledger: baseLedger, root_cause_package: basePackage, adoptions: records });
      if (!materialized.changed) {
        if (existingWorkspace === null) throw new CapaInvestigationActiveAdoptionIntegrityError("A successful adoption has no durable workspace.");
        return { status: mode === "saved" ? "adopted" : "already_adopted", records: Object.freeze(records), workspace: existingWorkspace };
      }
      const draftCandidate = { schema_version: "capa-investigation-active-workspace-draft-1.0.0" as const, trust: "untrusted_human_draft" as const, workflow_state: "S40" as const, organization_id: dependencies.tenant.organization_id, capa_case_id: command.capa_case_id, case_version_id: intent.expected_case_version_id, record_version: intent.expected_record_version, draft_revision: existingWorkspace === null ? 1 : existingWorkspace.draft_revision + 1, evidence_assumption_ledger: materialized.ledger, root_cause_package: materialized.root_cause_package, updated_by_user_id: dependencies.adopter.actor_id as UserId, updated_at: adoptedAt };
      const draftResult = validateCapaInvestigationActiveWorkspaceDraft(draftCandidate);
      if (draftResult.status !== "valid") throw new CapaInvestigationActiveAdoptionIntegrityError();
      const saved = await dependencies.workspace_repository.saveDraft(transaction, { draft: draftResult.value, expected_draft_revision: existingWorkspace?.draft_revision ?? null, expected_case_version_id: intent.expected_case_version_id, expected_record_version: intent.expected_record_version, expected_workflow_state: "S40" });
      if (saved.status === "case_changed") throw new BatchAbort({ status: "case_changed" });
      if (saved.status === "concurrency_conflict") throw new BatchAbort({ status: "workspace_conflict" });
      return { status: mode === "saved" ? "adopted" : "already_adopted", records: Object.freeze(records), workspace: saved.draft };
    }); } catch (error) { if (error instanceof BatchAbort) return error.result; throw error; }
}
