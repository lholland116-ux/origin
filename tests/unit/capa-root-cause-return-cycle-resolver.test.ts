import { describe, expect, it, vi } from "vitest";
import {
  createCapaRootCauseReturnCycleResolver,
} from "../../lib/capa/application/capa-root-cause-return-cycle-resolver";
import type { AuditEvent } from "../../lib/capa/domain/capa-types";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000001";
const RESULT = "40000000-0000-4000-8000-000000000001";
const AT = "2026-09-08T12:00:00.000Z";

function id(value: number): string {
  return `50000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function transition(overrides: Record<string, unknown> = {}): AuditEvent {
  const eventId = id(1);
  return {
    organization_id: ORG as never,
    event_id: eventId as never,
    event_type: "EVT-STATE-TRANSITION" as never,
    schema_version: "audit-1.0.0",
    aggregate_type: "CAPA_CASE" as never,
    aggregate_id: CASE,
    aggregate_version: 9,
    actor: { actor_type: "human", actor_id: "60000000-0000-4000-8000-000000000001" },
    occurred_at: AT as never,
    request_id: id(2) as never,
    correlation_id: id(3) as never,
    action: "DECIDE_CAPA_ROOT_CAUSE_GATE" as never,
    target: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: RESULT },
    outcome: "succeeded",
    reason: "Returned for additional investigation.",
    change: {
      before_ref: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: SOURCE },
      after_ref: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: RESULT },
    },
    configuration_versions: {},
    metadata: {
      gate: "G-04",
      transition_event: "Return root cause for investigation",
      from_state: "S50",
      to_state: "S40",
      rationale: "Returned for additional investigation.",
    },
    ...overrides,
  } as AuditEvent;
}

function resolver(events: readonly AuditEvent[], pages?: readonly (readonly AuditEvent[])[]) {
  const pageSets = pages ?? [events];
  const listEventsForAggregate = vi.fn(async ({ cursor }: { readonly cursor?: string }) => {
    const index = cursor === undefined ? 0 : Number(cursor);
    const page = pageSets[index] ?? [];
    return {
      events: page,
      ...(index + 1 < pageSets.length ? { next_cursor: String(index + 1) as never } : {}),
    };
  });
  return {
    resolver: createCapaRootCauseReturnCycleResolver({ audit_repository: { listEventsForAggregate } as never }),
    listEventsForAggregate,
  };
}

describe("CAPA root-cause G-04 return-cycle resolver", () => {
  it("returns no active cycle when there are no audit events", async () => {
    await expect(resolver([]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toEqual({ status: "no_active_return_cycle" });
  });

  it("does not treat the normal S30 to S40 release as a return cycle", async () => {
    const event = transition({
      action: "RELEASE_CAPA_INVESTIGATION" as never,
      target: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: RESULT },
      metadata: { from_state: "S30", to_state: "S40" },
    });
    await expect(resolver([event]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toEqual({ status: "no_active_return_cycle" });
  });

  it("returns the complete server-derived cycle for a valid G-04 return", async () => {
    await expect(resolver([transition()]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toMatchObject({
      status: "active",
      cycle: {
        return_transition_audit_event_id: id(1),
        source_case_version_id: SOURCE,
        resulting_case_version_id: RESULT,
        returned_by: { actor_type: "human", actor_id: "60000000-0000-4000-8000-000000000001" },
        returned_at: AT,
        rationale: "Returned for additional investigation.",
        source_record_version: 8,
        resulting_record_version: 9,
      },
    });
  });

  it.each(["S60", "S30"])("fails closed for G-04-like provenance from %s", async (from_state) => {
    const event = transition({
      metadata: {
        gate: "G-04",
        transition_event: "Return root cause for investigation",
        from_state,
        to_state: "S40",
        rationale: "Returned for additional investigation.",
      },
    });
    await expect(resolver([event]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid", reason_code: "INVALID_RETURN_CYCLE_PROVENANCE" });
  });

  it("follows pagination beyond one hundred events", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => transition({ event_id: id(index + 10) as never, action: "OTHER_TRANSITION" as never, metadata: { from_state: "S30", to_state: "S40" }, target: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: RESULT } }));
    const second = transition({ event_id: id(200) as never });
    const result = resolver([], [firstPage, [second]]);
    await expect(result.resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toMatchObject({ status: "active", cycle: { return_transition_audit_event_id: id(200) } });
    expect(result.listEventsForAggregate).toHaveBeenCalledTimes(2);
  });

  it("keeps the active return through a later same-state S40 event", async () => {
    const sameState = transition({ event_id: id(2) as never, action: "S40_WORKSPACE_CHANGE" as never, metadata: { from_state: "S40", to_state: "S40" } });
    await expect(resolver([transition(), sameState]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toMatchObject({ status: "active", cycle: { return_transition_audit_event_id: id(1) } });
  });

  it("suppresses an older return after a later unrelated transition into S40", async () => {
    const later = transition({ event_id: id(2) as never, action: "RETURN_FROM_CLOSURE_REVIEW" as never, metadata: { from_state: "S120", to_state: "S40" } });
    await expect(resolver([transition(), later]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toEqual({ status: "no_active_return_cycle" });
  });

  it("selects the second valid G-04 return cycle", async () => {
    const second = transition({ event_id: id(2) as never, occurred_at: "2026-09-09T12:00:00.000Z" as never, aggregate_version: 11, target: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: "70000000-0000-4000-8000-000000000001" }, reason: "Second return.", change: { before_ref: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: RESULT }, after_ref: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: "70000000-0000-4000-8000-000000000001" } }, metadata: { gate: "G-04", transition_event: "Return root cause for investigation", from_state: "S50", to_state: "S40", rationale: "Second return." } });
    await expect(resolver([transition(), second]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toMatchObject({ status: "active", cycle: { return_transition_audit_event_id: id(2), source_case_version_id: RESULT } });
  });

  it.each([
    ["inconsistent rationale", { metadata: { gate: "G-04", transition_event: "Return root cause for investigation", from_state: "S50", to_state: "S40", rationale: "Different rationale." } }],
    ["non-human actor", { actor: { actor_type: "agent", actor_id: "60000000-0000-4000-8000-000000000001" } }],
    ["wrong aggregate", { organization_id: "90000000-0000-4000-8000-000000000001" as never }],
    ["malformed version reference", { change: { before_ref: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: "bad" }, after_ref: { object_type: "CAPA_CASE" as never, object_id: CASE, object_version_id: RESULT } } }],
  ])("fails closed for %s", async (_label, overrides) => {
    await expect(resolver([transition(overrides)]).resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid", reason_code: "INVALID_RETURN_CYCLE_PROVENANCE" });
  });
});
