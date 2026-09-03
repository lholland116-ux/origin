import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
} from "./capa-investigation-planning-advisory-contract";

import type {
  CapaInvestigationPlanningAdvisoryHumanDraft,
} from "./capa-investigation-planning-advisory-context";

import type {
  CapaInvestigationPlanningAdvisoryRequest,
} from "./capa-investigation-planning-advisory-service";

const MAXIMUM_FOCUS_CHARACTERS = 1_000;
const MAXIMUM_DRAFT_CHARACTERS = 30_000;
const MAXIMUM_DRAFT_ITEMS = 20;
const MAXIMUM_DRAFT_DEPENDENCIES = 20;
const MAXIMUM_DRAFT_TEXT_CHARACTERS = 4_000;
const DRAFT_LOCAL_KEY_PATTERN = /^D[1-9][0-9]{0,2}$/;

const ALLOWED_FIELDS = new Set([
  "focus",
  "untrusted_human_draft",
]);

export const CAPA_INVESTIGATION_PLANNING_ADVISORY_VALIDATION_REASON_CODES = [
  "INVALID_ADVISORY_INPUT",
  "UNSUPPORTED_ADVISORY_INPUT_FIELD",
  "ADVISORY_FOCUS_TOO_LONG",
  "INVALID_UNTRUSTED_HUMAN_DRAFT",
  "UNTRUSTED_HUMAN_DRAFT_TOO_LARGE",
] as const;

export type CapaInvestigationPlanningAdvisoryValidationReasonCode =
  (typeof CAPA_INVESTIGATION_PLANNING_ADVISORY_VALIDATION_REASON_CODES)[number];

export class CapaInvestigationPlanningAdvisoryValidationError extends Error {
  readonly reason_code:
    CapaInvestigationPlanningAdvisoryValidationReasonCode;

  constructor(reasonCode: CapaInvestigationPlanningAdvisoryValidationReasonCode) {
    super("The governed CAPA investigation-planning advisory request is invalid.");
    this.name = "CapaInvestigationPlanningAdvisoryValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(
  reasonCode: CapaInvestigationPlanningAdvisoryValidationReasonCode,
): never {
  throw new CapaInvestigationPlanningAdvisoryValidationError(reasonCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    );
}

function normalizedFocus(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") fail("INVALID_ADVISORY_INPUT");

  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAXIMUM_FOCUS_CHARACTERS) {
    fail("ADVISORY_FOCUS_TOO_LONG");
  }
  return normalized;
}

function draftText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > MAXIMUM_DRAFT_TEXT_CHARACTERS) {
    return undefined;
  }
  return normalized.length === 0 ? null : normalized;
}

function draftLocalKey(value: unknown): string | undefined {
  return typeof value === "string" &&
    DRAFT_LOCAL_KEY_PATTERN.test(value)
    ? value
    : undefined;
}

function normalizeUntrustedHumanDraft(
  value: unknown,
): CapaInvestigationPlanningAdvisoryHumanDraft | null {
  if (value === undefined || value === null) return null;

  if (!isRecord(value) || !hasExactKeys(value, ["trust", "content"]) ||
      value.trust !== "untrusted_human_draft" ||
      !isRecord(value.content) ||
      !hasExactKeys(value.content, ["items"]) ||
      !Array.isArray(value.content.items) ||
      value.content.items.length > MAXIMUM_DRAFT_ITEMS) {
    fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  }

  const serialized = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  })();

  if (serialized === undefined) {
    fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  }
  if (serialized.length > MAXIMUM_DRAFT_CHARACTERS) {
    fail("UNTRUSTED_HUMAN_DRAFT_TOO_LARGE");
  }

  const sourceItems = value.content.items;
  const localKeys = new Set<string>();

  for (const source of sourceItems) {
    if (!isRecord(source) || !hasExactKeys(source, [
      "local_key",
      "investigation_question",
      "evidence_target",
      "investigation_method",
      "scope_relationship",
      "due_date_consideration",
      "dependency_local_keys",
      "owner_selected",
    ])) {
      fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
    }

    const localKey = draftLocalKey(source.local_key);
    if (localKey === undefined || localKeys.has(localKey)) {
      fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
    }
    localKeys.add(localKey);
  }

  const items = sourceItems.map((source) => {
    const localKey = source.local_key as string;
    const investigationQuestion = draftText(source.investigation_question);
    const evidenceTarget = draftText(source.evidence_target);
    const investigationMethod = draftText(source.investigation_method);
    const scopeRelationship = draftText(source.scope_relationship);
    const dueDateConsideration = draftText(source.due_date_consideration);

    if (
      investigationQuestion === undefined ||
      evidenceTarget === undefined ||
      investigationMethod === undefined ||
      scopeRelationship === undefined ||
      dueDateConsideration === undefined ||
      typeof source.owner_selected !== "boolean" ||
      !Array.isArray(source.dependency_local_keys) ||
      source.dependency_local_keys.length > MAXIMUM_DRAFT_DEPENDENCIES
    ) {
      fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
    }

    const dependencies: string[] = [];
    for (const dependency of source.dependency_local_keys) {
      if (
        draftLocalKey(dependency) === undefined ||
        !localKeys.has(dependency) ||
        dependency === localKey ||
        dependencies.includes(dependency)
      ) {
        fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
      }
      dependencies.push(dependency);
    }

    return Object.freeze({
      local_key: localKey,
      investigation_question: investigationQuestion,
      evidence_target: evidenceTarget,
      investigation_method: investigationMethod,
      scope_relationship: scopeRelationship,
      due_date_consideration: dueDateConsideration,
      dependency_local_keys: Object.freeze(dependencies),
      owner_selected: source.owner_selected,
    });
  });

  const graph = new Map(
    items.map((item) => [item.local_key, item.dependency_local_keys]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(localKey: string): boolean {
    if (visiting.has(localKey)) return true;
    if (visited.has(localKey)) return false;
    visiting.add(localKey);
    for (const dependency of graph.get(localKey) ?? []) {
      if (hasCycle(dependency)) return true;
    }
    visiting.delete(localKey);
    visited.add(localKey);
    return false;
  }

  if (items.some((item) => hasCycle(item.local_key))) {
    fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  }

  return Object.freeze({
    trust: "untrusted_human_draft" as const,
    content: Object.freeze({
      items: Object.freeze(items),
    }),
  });
}

export function validateCapaInvestigationPlanningAdvisoryBrowserRequest(
  value: unknown,
): CapaInvestigationPlanningAdvisoryRequest {
  if (!isRecord(value)) fail("INVALID_ADVISORY_INPUT");

  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) {
      fail("UNSUPPORTED_ADVISORY_INPUT_FIELD");
    }
  }

  return Object.freeze({
    requested_output: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
    focus: normalizedFocus(value.focus),
    untrusted_human_draft: normalizeUntrustedHumanDraft(
      value.untrusted_human_draft,
    ),
  });
}
