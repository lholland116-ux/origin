/**
 * Controlled CAPA lifecycle states and transition graph.
 *
 * Primary source:
 * Document #4 — LVT CAPA Workflow and State Specification
 *
 * Traceability:
 * WFR-001 through WFR-013
 * CON-001 through CON-007
 *
 * Authorization, gate evaluation, audit persistence and transactions
 * are enforced by the application layer. This file defines only the
 * approved workflow vocabulary and transition graph.
 */

export const CAPA_STATE = {
  DRAFT_INTAKE: "S00",
  TRIAGE_AND_SCOPE: "S10",
  CONTAINMENT_AND_IMPACT_RISK: "S20",
  INVESTIGATION_PLANNING: "S30",
  INVESTIGATION_ACTIVE: "S40",
  ROOT_CAUSE_REVIEW: "S50",
  ACTION_PLANNING: "S60",
  ACTION_PLAN_REVIEW: "S70",
  IMPLEMENTATION_ACTIVE: "S80",
  IMPLEMENTATION_REVIEW: "S90",
  EFFECTIVENESS_MONITORING: "S100",
  EFFECTIVENESS_REVIEW: "S110",
  CLOSURE_REVIEW: "S120",
  CLOSED: "S130",
  CANCELLED: "S140",
  REOPENED_ASSESSMENT: "S150",
} as const;

export type CapaStateId =
  (typeof CAPA_STATE)[keyof typeof CAPA_STATE];

export type CapaStateClass =
  | "working"
  | "review_gate"
  | "waiting_working"
  | "terminal"
  | "working_gate";

export interface CapaStateDefinition {
  readonly id: CapaStateId;
  readonly name: string;
  readonly state_class: CapaStateClass;
  readonly terminal: boolean;
}

export const CAPA_STATE_DEFINITIONS = {
  S00: {
    id: CAPA_STATE.DRAFT_INTAKE,
    name: "Draft Intake",
    state_class: "working",
    terminal: false,
  },
  S10: {
    id: CAPA_STATE.TRIAGE_AND_SCOPE,
    name: "Triage and Scope",
    state_class: "working",
    terminal: false,
  },
  S20: {
    id: CAPA_STATE.CONTAINMENT_AND_IMPACT_RISK,
    name: "Containment and Impact/Risk",
    state_class: "working",
    terminal: false,
  },
  S30: {
    id: CAPA_STATE.INVESTIGATION_PLANNING,
    name: "Investigation Planning",
    state_class: "working",
    terminal: false,
  },
  S40: {
    id: CAPA_STATE.INVESTIGATION_ACTIVE,
    name: "Investigation Active",
    state_class: "working",
    terminal: false,
  },
  S50: {
    id: CAPA_STATE.ROOT_CAUSE_REVIEW,
    name: "Root Cause Review",
    state_class: "review_gate",
    terminal: false,
  },
  S60: {
    id: CAPA_STATE.ACTION_PLANNING,
    name: "Action Planning",
    state_class: "working",
    terminal: false,
  },
  S70: {
    id: CAPA_STATE.ACTION_PLAN_REVIEW,
    name: "Action Plan Review",
    state_class: "review_gate",
    terminal: false,
  },
  S80: {
    id: CAPA_STATE.IMPLEMENTATION_ACTIVE,
    name: "Implementation Active",
    state_class: "working",
    terminal: false,
  },
  S90: {
    id: CAPA_STATE.IMPLEMENTATION_REVIEW,
    name: "Implementation Review",
    state_class: "review_gate",
    terminal: false,
  },
  S100: {
    id: CAPA_STATE.EFFECTIVENESS_MONITORING,
    name: "Effectiveness Monitoring",
    state_class: "waiting_working",
    terminal: false,
  },
  S110: {
    id: CAPA_STATE.EFFECTIVENESS_REVIEW,
    name: "Effectiveness Review",
    state_class: "review_gate",
    terminal: false,
  },
  S120: {
    id: CAPA_STATE.CLOSURE_REVIEW,
    name: "Closure Review",
    state_class: "review_gate",
    terminal: false,
  },
  S130: {
    id: CAPA_STATE.CLOSED,
    name: "Closed",
    state_class: "terminal",
    terminal: true,
  },
  S140: {
    id: CAPA_STATE.CANCELLED,
    name: "Cancelled",
    state_class: "terminal",
    terminal: true,
  },
  S150: {
    id: CAPA_STATE.REOPENED_ASSESSMENT,
    name: "Reopened Assessment",
    state_class: "working_gate",
    terminal: false,
  },
} as const satisfies Record<CapaStateId, CapaStateDefinition>;

export type CapaTransitionKind =
  | "forward"
  | "rework"
  | "cancellation"
  | "reopening"
  | "reentry";

export interface CapaTransitionDefinition {
  readonly from: CapaStateId;
  readonly to: CapaStateId;
  readonly event: string;
  readonly kind: CapaTransitionKind;
  readonly human_authorization_required: boolean;
  readonly confirmation_required: boolean;
}

/**
 * Approved primary forward path.
 */
export const PRIMARY_TRANSITIONS = [
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
] as const satisfies readonly [
  CapaStateId,
  CapaStateId,
  string,
][];

/**
 * Approved review and rework paths.
 */
export const REWORK_TRANSITIONS = [
  ["S50", "S40", "Return for investigation"],
  ["S70", "S60", "Return for action planning"],
  ["S90", "S80", "Return for implementation"],
  ["S110", "S100", "Return for effectiveness monitoring"],
  ["S110", "S60", "Return for action reassessment"],
  ["S120", "S100", "Return to effectiveness monitoring"],
  ["S120", "S110", "Return to effectiveness review"],
  ["S120", "S80", "Return to implementation"],
  ["S120", "S90", "Return to implementation review"],
  ["S120", "S40", "Return to investigation"],
  ["S120", "S50", "Return to root cause review"],
] as const satisfies readonly [
  CapaStateId,
  CapaStateId,
  string,
][];

/**
 * Cancellation is permitted from active states S00 through S120.
 * Cancellation requires an authorized human decision and confirmation.
 */
export const CANCELLABLE_STATES = [
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
] as const satisfies readonly CapaStateId[];

/**
 * Approved reentry targets from S150.
 */
export const REENTRY_TARGET_STATES = [
  "S20",
  "S30",
  "S40",
  "S60",
  "S80",
  "S100",
] as const satisfies readonly CapaStateId[];

function createTransitions(): readonly CapaTransitionDefinition[] {
  const forward: CapaTransitionDefinition[] =
    PRIMARY_TRANSITIONS.map(([from, to, event]) => ({
      from,
      to,
      event,
      kind: "forward",
      human_authorization_required: true,
      confirmation_required:
        to === "S60" || to === "S80" || to === "S120" || to === "S130",
    }));

  const rework: CapaTransitionDefinition[] =
    REWORK_TRANSITIONS.map(([from, to, event]) => ({
      from,
      to,
      event,
      kind: "rework",
      human_authorization_required: true,
      confirmation_required: false,
    }));

  const cancellation: CapaTransitionDefinition[] =
    CANCELLABLE_STATES.map((from) => ({
      from,
      to: CAPA_STATE.CANCELLED,
      event: "Cancel CAPA",
      kind: "cancellation",
      human_authorization_required: true,
      confirmation_required: true,
    }));

  const reopening: CapaTransitionDefinition = {
    from: CAPA_STATE.CLOSED,
    to: CAPA_STATE.REOPENED_ASSESSMENT,
    event: "Reopen CAPA for assessment",
    kind: "reopening",
    human_authorization_required: true,
    confirmation_required: true,
  };

  const reentry: CapaTransitionDefinition[] =
    REENTRY_TARGET_STATES.map((to) => ({
      from: CAPA_STATE.REOPENED_ASSESSMENT,
      to,
      event: "Approve controlled reentry",
      kind: "reentry",
      human_authorization_required: true,
      confirmation_required: true,
    }));

  return [
    ...forward,
    ...rework,
    ...cancellation,
    reopening,
    ...reentry,
  ];
}

export const CAPA_TRANSITIONS = createTransitions();

/**
 * Returns true only when the requested state movement exists in the
 * approved baseline transition graph.
 *
 * This function does not authorize the actor or evaluate gate criteria.
 */
export function isAllowedCapaTransition(
  from: CapaStateId,
  to: CapaStateId,
): boolean {
  return CAPA_TRANSITIONS.some(
    (transition) =>
      transition.from === from && transition.to === to,
  );
}

export function getAllowedCapaTransitions(
  from: CapaStateId,
): readonly CapaTransitionDefinition[] {
  return CAPA_TRANSITIONS.filter(
    (transition) => transition.from === from,
  );
}

export function isTerminalCapaState(
  state: CapaStateId,
): boolean {
  return CAPA_STATE_DEFINITIONS[state].terminal;
}

export function getCapaStateDefinition(
  state: CapaStateId,
): CapaStateDefinition {
  return CAPA_STATE_DEFINITIONS[state];
}