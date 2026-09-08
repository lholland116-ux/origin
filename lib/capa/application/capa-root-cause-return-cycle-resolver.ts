import type { AuditRepository } from "../../database/repositories/audit-repository";
import { CAPA_STATE, type CapaStateId } from "../domain/capa-state";
import type {
  ActorReference,
  AuditEvent,
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  IsoDateTime,
  OrganizationId,
} from "../domain/capa-types";

const CAPA_CASE_AGGREGATE_TYPE = "CAPA_CASE";
const STATE_TRANSITION_EVENT_TYPE = "EVT-STATE-TRANSITION";
const ROOT_CAUSE_GATE_ACTION = "DECIDE_CAPA_ROOT_CAUSE_GATE";
const G04_GATE = "G-04";
const RETURN_TRANSITION = "Return root cause for investigation";
const MAXIMUM_AUDIT_PAGE_SIZE = 100;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const STATES = new Set<string>(Object.values(CAPA_STATE));

export interface CapaRootCauseReturnCycle {
  readonly return_transition_audit_event_id: AuditEventId;
  readonly source_case_version_id: CapaCaseVersionId;
  readonly resulting_case_version_id: CapaCaseVersionId;
  readonly returned_by: ActorReference;
  readonly returned_at: IsoDateTime;
  readonly rationale: string;
  readonly source_record_version: number;
  readonly resulting_record_version: number;
}

export type CapaRootCauseReturnCycleResolutionResult =
  | { readonly status: "no_active_return_cycle" }
  | { readonly status: "active"; readonly cycle: CapaRootCauseReturnCycle }
  | {
      readonly status: "invalid";
      readonly reason_code: "INVALID_RETURN_CYCLE_PROVENANCE";
    };

export interface CapaRootCauseReturnCycleResolver {
  resolve(input: {
    readonly organization_id: OrganizationId;
    readonly capa_case_id: CapaCaseId;
  }): Promise<CapaRootCauseReturnCycleResolutionResult>;
}

export interface CapaRootCauseReturnCycleResolverDependencies {
  readonly audit_repository: AuditRepository;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === "string" &&
    ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function safePositiveInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0;
}

function state(value: unknown): value is CapaStateId {
  return typeof value === "string" && STATES.has(value);
}

function objectVersionId(value: unknown, caseId: CapaCaseId): string | null {
  if (!record(value)) return null;
  if (
    value.object_type !== CAPA_CASE_AGGREGATE_TYPE ||
    value.object_id !== caseId ||
    !uuid(value.object_version_id)
  ) return null;
  return value.object_version_id;
}

function transitionEnvelopeIsValid(
  event: AuditEvent,
  organizationId: OrganizationId,
  caseId: CapaCaseId,
): boolean {
  if (
    !record(event) ||
    !record(event.actor) ||
    event.organization_id !== organizationId ||
    event.event_type !== STATE_TRANSITION_EVENT_TYPE ||
    event.aggregate_type !== CAPA_CASE_AGGREGATE_TYPE ||
    event.aggregate_id !== caseId ||
    !uuid(event.event_id) ||
    event.actor.actor_type !== "human" ||
    !uuid(event.actor.actor_id) ||
    !isoDateTime(event.occurred_at) ||
    !safePositiveInteger(event.aggregate_version) ||
    !nonEmptyText(event.reason) ||
    !record(event.metadata)
  ) return false;

  const fromState = event.metadata.from_state;
  const toState = event.metadata.to_state;
  const beforeVersionId = objectVersionId(event.change?.before_ref, caseId);
  const afterVersionId = objectVersionId(event.change?.after_ref, caseId);
  const targetVersionId = objectVersionId(event.target, caseId);
  if (
    !state(fromState) ||
    !state(toState) ||
    toState !== CAPA_STATE.INVESTIGATION_ACTIVE ||
    fromState === CAPA_STATE.INVESTIGATION_ACTIVE ||
    beforeVersionId === null ||
    afterVersionId === null ||
    targetVersionId === null ||
    targetVersionId !== afterVersionId ||
    event.aggregate_version < 2
  ) return false;

  return true;
}

function isG04Return(
  event: AuditEvent,
  organizationId: OrganizationId,
  caseId: CapaCaseId,
): boolean {
  if (!transitionEnvelopeIsValid(event, organizationId, caseId)) return false;
  if (
    event.action !== ROOT_CAUSE_GATE_ACTION ||
    event.metadata.gate !== G04_GATE ||
    event.metadata.transition_event !== RETURN_TRANSITION ||
    event.metadata.from_state !== CAPA_STATE.ROOT_CAUSE_REVIEW ||
    !nonEmptyText(event.metadata.rationale) ||
    event.reason !== event.metadata.rationale
  ) return false;
  return true;
}

function activeCycle(
  event: AuditEvent,
  organizationId: OrganizationId,
  caseId: CapaCaseId,
): CapaRootCauseReturnCycle | null {
  if (!isG04Return(event, organizationId, caseId)) return null;
  if (
    !nonEmptyText(event.reason) ||
    !isoDateTime(event.occurred_at) ||
    !safePositiveInteger(event.aggregate_version) ||
    !uuid(event.actor.actor_id)
  ) return null;
  const sourceVersionId = objectVersionId(event.change?.before_ref, caseId);
  const resultingVersionId = objectVersionId(event.change?.after_ref, caseId);
  if (sourceVersionId === null || resultingVersionId === null) return null;
  return Object.freeze({
    return_transition_audit_event_id: event.event_id,
    source_case_version_id: sourceVersionId as CapaCaseVersionId,
    resulting_case_version_id: resultingVersionId as CapaCaseVersionId,
    returned_by: Object.freeze({
      actor_type: "human" as const,
      actor_id: event.actor.actor_id,
    }),
    returned_at: event.occurred_at,
    rationale: event.reason,
    source_record_version: event.aggregate_version - 1,
    resulting_record_version: event.aggregate_version,
  });
}

async function allEvents(
  dependencies: CapaRootCauseReturnCycleResolverDependencies,
  organizationId: OrganizationId,
  caseId: CapaCaseId,
): Promise<readonly AuditEvent[]> {
  const events: AuditEvent[] = [];
  const cursors = new Set<string>();
  let cursor: Parameters<AuditRepository["listEventsForAggregate"]>[0]["cursor"];
  do {
    const page = await dependencies.audit_repository.listEventsForAggregate({
      organization_id: organizationId,
      aggregate_type: CAPA_CASE_AGGREGATE_TYPE as never,
      aggregate_id: caseId,
      limit: MAXIMUM_AUDIT_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    events.push(...page.events);
    if (page.next_cursor === undefined) break;
    const cursorValue = String(page.next_cursor);
    if (cursors.has(cursorValue)) throw new Error("INVALID_RETURN_CYCLE_PAGINATION");
    cursors.add(cursorValue);
    cursor = page.next_cursor;
  } while (true);
  return Object.freeze(events);
}

export function createCapaRootCauseReturnCycleResolver(
  dependencies: CapaRootCauseReturnCycleResolverDependencies,
): CapaRootCauseReturnCycleResolver {
  return {
    async resolve(input) {
      const events = await allEvents(
        dependencies,
        input.organization_id,
        input.capa_case_id,
      );
      const candidates = events.filter((event) =>
        record(event) &&
        event.event_type === STATE_TRANSITION_EVENT_TYPE &&
        event.outcome === "succeeded" &&
        record(event.metadata) &&
        event.metadata.to_state === CAPA_STATE.INVESTIGATION_ACTIVE &&
        event.metadata.from_state !== CAPA_STATE.INVESTIGATION_ACTIVE,
      );
      const latest = candidates[candidates.length - 1];
      if (latest === undefined) return { status: "no_active_return_cycle" };
      const isG04Like = latest.action === ROOT_CAUSE_GATE_ACTION ||
        latest.metadata.gate === G04_GATE ||
        latest.metadata.transition_event === RETURN_TRANSITION;
      if (!isG04Like) return { status: "no_active_return_cycle" };
      if (!transitionEnvelopeIsValid(latest, input.organization_id, input.capa_case_id)) {
        return { status: "invalid", reason_code: "INVALID_RETURN_CYCLE_PROVENANCE" };
      }
      if (!isG04Return(latest, input.organization_id, input.capa_case_id)) {
        return { status: "invalid", reason_code: "INVALID_RETURN_CYCLE_PROVENANCE" };
      }
      const cycle = activeCycle(
        latest,
        input.organization_id,
        input.capa_case_id,
      );
      return cycle === null
        ? { status: "no_active_return_cycle" }
        : { status: "active", cycle };
    },
  };
}
