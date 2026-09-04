import type { CapaInvestigationPlanAdvisoryProposal } from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  validateCapaInvestigationPlanAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-output-validator";
import type { InvestigationPlanDraft } from "./capa-investigation-plan-draft";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CapaInvestigationPlanningAdvisoryRequest {
  readonly focus?: string;
  readonly untrusted_human_draft: {
    readonly trust: "untrusted_human_draft";
    readonly content: {
      readonly items: readonly {
        readonly local_key: string;
        readonly investigation_question: string | null;
        readonly evidence_target: string | null;
        readonly investigation_method: string | null;
        readonly scope_relationship: string | null;
        readonly due_date_consideration: string | null;
        readonly dependency_local_keys: readonly string[];
        readonly owner_selected: boolean;
      }[];
    };
  };
}

export interface CapaInvestigationPlanningAdvisorySuccess {
  readonly advisory: {
    readonly runId: string;
    readonly outputId: string;
    readonly status: "completed_draft";
    readonly proposal: CapaInvestigationPlanAdvisoryProposal;
    readonly assumptions: ReturnType<typeof validateCapaInvestigationPlanAdvisoryModelOutput>["assumptions"];
    readonly uncertaintyAndLimitations: ReturnType<typeof validateCapaInvestigationPlanAdvisoryModelOutput>["uncertainty_and_limitations"];
    readonly warnings: readonly string[];
  };
  readonly snapshot: {
    readonly capaCaseId: string;
    readonly caseVersionId: string;
    readonly recordVersion: number;
  };
  readonly correlationId: string;
}

export interface CapaInvestigationPlanningAdvisoryFailure {
  readonly code: string | null;
  readonly message: string;
  readonly correlationId: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value) && value.trim() === value;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function safeWarningList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) =>
    typeof item !== "string" || item.trim() !== item || item.length === 0,
  )) return null;
  return Object.freeze([...value]);
}

function parseAdvisory(value: unknown): CapaInvestigationPlanningAdvisorySuccess["advisory"] | null {
  if (!record(value) || !exact(value, [
    "run_id", "output_id", "output_schema_version", "status", "proposal",
    "assumptions", "uncertainty_and_limitations", "citations", "warnings",
    "advisory_only", "workflow_mutated", "human_acceptance_required",
  ]) || !uuid(value.run_id) || !uuid(value.output_id) ||
    value.output_schema_version !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    value.status !== "completed_draft" || value.advisory_only !== true ||
    value.workflow_mutated !== false || value.human_acceptance_required !== true ||
    !Array.isArray(value.citations) || value.citations.length !== 0) return null;

  const warnings = safeWarningList(value.warnings);
  if (warnings === null || !Array.isArray(value.assumptions) ||
    !Array.isArray(value.uncertainty_and_limitations)) return null;
  let parsed: ReturnType<typeof validateCapaInvestigationPlanAdvisoryModelOutput>;
  try {
    parsed = validateCapaInvestigationPlanAdvisoryModelOutput(JSON.stringify({
      proposal: value.proposal,
      assumptions: value.assumptions,
      uncertainty_and_limitations: value.uncertainty_and_limitations,
      citations: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    }));
  } catch {
    return null;
  }
  return Object.freeze({
    runId: value.run_id,
    outputId: value.output_id,
    status: "completed_draft" as const,
    proposal: parsed.proposal,
    assumptions: parsed.assumptions,
    uncertaintyAndLimitations: parsed.uncertainty_and_limitations,
    warnings,
  });
}

export function parseCapaInvestigationPlanningAdvisorySuccess(
  value: unknown,
): CapaInvestigationPlanningAdvisorySuccess | null {
  if (!record(value) || !exact(value, ["advisory", "snapshot", "correlation_id"]) ||
    !record(value.snapshot) || !exact(value.snapshot, ["capa_case_id", "case_version_id", "record_version"]) ||
    !uuid(value.snapshot.capa_case_id) || !uuid(value.snapshot.case_version_id) ||
    !positiveInteger(value.snapshot.record_version) || !uuid(value.correlation_id)) return null;
  const advisory = parseAdvisory(value.advisory);
  if (advisory === null) return null;
  return Object.freeze({
    advisory,
    snapshot: Object.freeze({
      capaCaseId: value.snapshot.capa_case_id,
      caseVersionId: value.snapshot.case_version_id,
      recordVersion: value.snapshot.record_version,
    }),
    correlationId: value.correlation_id,
  });
}

export function parseCapaInvestigationPlanningAdvisoryFailure(
  value: unknown,
): CapaInvestigationPlanningAdvisoryFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  return Object.freeze({
    code: error && typeof error.code === "string" ? error.code : null,
    message: error && typeof error.message === "string" ? error.message : "The governed S30 advisory could not be completed.",
    correlationId: error && uuid(error.correlation_id) ? error.correlation_id : null,
  });
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

/** Builds only the fields allowed by the committed browser advisory validator. */
export function buildCapaInvestigationPlanningAdvisoryRequest(
  focus: string,
  draft: InvestigationPlanDraft,
): CapaInvestigationPlanningAdvisoryRequest {
  const localKeys = new Map(draft.items.map((item, index) => [item.itemId, `D${index + 1}`]));
  const items = draft.items.map((item, index) => Object.freeze({
    local_key: `D${index + 1}`,
    investigation_question: nullable(item.investigationQuestion),
    evidence_target: nullable(item.evidenceTarget),
    investigation_method: nullable(item.investigationMethod),
    scope_relationship: nullable(item.scopeRelationship),
    due_date_consideration: null,
    dependency_local_keys: Object.freeze(item.dependencyItemIds.map((id) => localKeys.get(id) ?? id)),
    owner_selected: item.ownerUserId.trim().length > 0,
  }));
  const request: CapaInvestigationPlanningAdvisoryRequest = {
    ...(focus.trim().length > 0 ? { focus } : {}),
    untrusted_human_draft: Object.freeze({
      trust: "untrusted_human_draft",
      content: Object.freeze({ items: Object.freeze(items) }),
    }),
  };
  return Object.freeze(request);
}

export async function fetchCapaInvestigationPlanningAdvisory(
  caseId: string,
  request: CapaInvestigationPlanningAdvisoryRequest,
  fetcher: typeof fetch = fetch,
  trace: { readonly requestId: string; readonly correlationId: string } = {
    requestId: crypto.randomUUID(), correlationId: crypto.randomUUID(),
  },
): Promise<CapaInvestigationPlanningAdvisorySuccess | CapaInvestigationPlanningAdvisoryFailure> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/investigation-planning-advisory`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": trace.requestId,
        "x-correlation-id": trace.correlationId,
      },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseCapaInvestigationPlanningAdvisoryFailure(body);
    return parseCapaInvestigationPlanningAdvisorySuccess(body) ?? {
      code: "INVALID_ADVISORY_RESPONSE",
      message: "The advisory response could not be verified.",
      correlationId: trace.correlationId,
    };
  } catch {
    return { code: null, message: "The governed S30 advisory could not be completed.", correlationId: trace.correlationId };
  }
}
