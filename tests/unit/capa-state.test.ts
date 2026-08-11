import { describe, expect, it } from "vitest";

import {
  CAPA_STATE,
  CAPA_STATE_DEFINITIONS,
  CAPA_TRANSITIONS,
  CANCELLABLE_STATES,
  PRIMARY_TRANSITIONS,
  REENTRY_TARGET_STATES,
  REWORK_TRANSITIONS,
  getAllowedCapaTransitions,
  getCapaStateDefinition,
  isAllowedCapaTransition,
  isTerminalCapaState,
  type CapaStateId,
} from "../../lib/capa/domain/capa-state";

/**
 * Requirements-traced unit tests for the controlled CAPA workflow graph.
 *
 * Primary source:
 * Document #4 — LVT CAPA Workflow and State Specification
 *
 * Traceability:
 * WFR-001 — Only explicitly listed transitions are permitted.
 * WFR-003 — Current server-authoritative state must be evaluated.
 * WFR-007 — AI/background processes cannot execute human decisions.
 * CAN-001 through CAN-005 — Controlled cancellation path.
 * CON-001 through CON-007 — Concurrency and controlled transition rules.
 * WF-AT-001 — Normal forward lifecycle.
 * WF-AT-010 — Cancellation.
 * WF-AT-011 — Reopening and controlled reentry.
 */

describe("CAPA state definitions", () => {
  it("defines all 16 approved lifecycle states", () => {
    expect(Object.keys(CAPA_STATE_DEFINITIONS)).toHaveLength(16);
    expect(Object.values(CAPA_STATE)).toHaveLength(16);
  });

  it("uses unique state identifiers", () => {
    const stateIds = Object.values(CAPA_STATE);

    expect(new Set(stateIds).size).toBe(stateIds.length);
  });

  it("defines S130 and S140 as the only terminal states", () => {
    const terminalStates = Object.values(
      CAPA_STATE_DEFINITIONS,
    )
      .filter((definition) => definition.terminal)
      .map((definition) => definition.id)
      .sort();

    expect(terminalStates).toEqual(["S130", "S140"]);
    expect(isTerminalCapaState("S130")).toBe(true);
    expect(isTerminalCapaState("S140")).toBe(true);
    expect(isTerminalCapaState("S00")).toBe(false);
    expect(isTerminalCapaState("S150")).toBe(false);
  });

  it("returns the controlled definition for a state", () => {
    expect(getCapaStateDefinition("S50")).toEqual({
      id: "S50",
      name: "Root Cause Review",
      state_class: "review_gate",
      terminal: false,
    });
  });
});

describe("primary CAPA workflow", () => {
  it("implements the approved S00 through S130 forward path", () => {
    expect(PRIMARY_TRANSITIONS).toEqual([
      ["S00", "S10", "Create case"],
      ["S10", "S20", "Accept CAPA scope"],
      ["S20", "S30", "Accept containment and risk"],
      ["S30", "S40", "Authorize investigation execution"],
      ["S40", "S50", "Submit root cause for review"],
      ["S50", "S60", "Approve root cause conclusion"],
      ["S60", "S70", "Submit action plan"],
      ["S70", "S80", "Approve action plan"],
      ["S80", "S90", "Submit implementation evidence"],
      ["S90", "S100", "Accept implementation"],
      ["S100", "S110", "Submit effectiveness results"],
      ["S110", "S120", "Approve effectiveness"],
      ["S120", "S130", "Close CAPA"],
    ]);
  });

  it("permits every approved primary transition", () => {
    for (const [from, to] of PRIMARY_TRANSITIONS) {
      expect(isAllowedCapaTransition(from, to)).toBe(true);
    }
  });

  it("rejects unlisted transition shortcuts", () => {
    expect(isAllowedCapaTransition("S00", "S20")).toBe(false);
    expect(isAllowedCapaTransition("S40", "S60")).toBe(false);
    expect(isAllowedCapaTransition("S80", "S100")).toBe(false);
    expect(isAllowedCapaTransition("S120", "S140")).toBe(true);
  });
});

describe("CAPA rework transitions", () => {
  it("permits every approved rework transition", () => {
    for (const [from, to] of REWORK_TRANSITIONS) {
      expect(isAllowedCapaTransition(from, to)).toBe(true);
    }
  });

  it("does not define self-transitions", () => {
    for (const transition of CAPA_TRANSITIONS) {
      expect(transition.from).not.toBe(transition.to);
    }
  });

  it("does not define duplicate source and destination pairs", () => {
    const transitionKeys = CAPA_TRANSITIONS.map(
      ({ from, to }) => `${from}:${to}`,
    );

    expect(new Set(transitionKeys).size).toBe(
      transitionKeys.length,
    );
  });
});

describe("CAPA cancellation", () => {
  it("allows cancellation from every approved active baseline state", () => {
    expect(CANCELLABLE_STATES).toEqual([
      "S00",
      "S10",
      "S20",
      "S30",
      "S40",
      "S50",
      "S60",
      "S70",
      "S80",
      "S90",
      "S100",
      "S110",
      "S120",
    ]);

    for (const state of CANCELLABLE_STATES) {
      expect(isAllowedCapaTransition(state, "S140")).toBe(true);
    }
  });

  it("requires human authorization and confirmation for cancellation", () => {
    const cancellationTransitions = CAPA_TRANSITIONS.filter(
      ({ kind }) => kind === "cancellation",
    );

    expect(cancellationTransitions).toHaveLength(
      CANCELLABLE_STATES.length,
    );

    for (const transition of cancellationTransitions) {
      expect(transition.human_authorization_required).toBe(true);
      expect(transition.confirmation_required).toBe(true);
      expect(transition.to).toBe("S140");
    }
  });

  it("allows no transitions out of Cancelled", () => {
    expect(getAllowedCapaTransitions("S140")).toEqual([]);
  });
});

describe("CAPA reopening and controlled reentry", () => {
  it("allows Closed to enter only Reopened Assessment", () => {
    const closedTransitions = getAllowedCapaTransitions("S130");

    expect(closedTransitions).toHaveLength(1);
    expect(closedTransitions[0]).toMatchObject({
      from: "S130",
      to: "S150",
      kind: "reopening",
      human_authorization_required: true,
      confirmation_required: true,
    });
  });

  it("allows reentry only to the approved active states", () => {
    expect(REENTRY_TARGET_STATES).toEqual([
      "S20",
      "S30",
      "S40",
      "S60",
      "S80",
      "S100",
    ]);

    const actualTargets = getAllowedCapaTransitions("S150")
      .map(({ to }) => to)
      .sort();

    const expectedTargets = [
      ...REENTRY_TARGET_STATES,
    ].sort();

    expect(actualTargets).toEqual(expectedTargets);
  });

  it("requires human authorization and confirmation for reentry", () => {
    const reentryTransitions =
      getAllowedCapaTransitions("S150");

    for (const transition of reentryTransitions) {
      expect(transition.kind).toBe("reentry");
      expect(transition.human_authorization_required).toBe(true);
      expect(transition.confirmation_required).toBe(true);
    }
  });
});

describe("transition query behavior", () => {
  it("returns only transitions originating from the requested state", () => {
    const sourceState: CapaStateId = "S50";
    const transitions =
      getAllowedCapaTransitions(sourceState);

    expect(transitions.length).toBeGreaterThan(0);

    for (const transition of transitions) {
      expect(transition.from).toBe(sourceState);
    }
  });
});