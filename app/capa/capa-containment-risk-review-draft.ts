import type {
  CapaContainmentAction,
  CapaContainmentActionStatus,
  CapaContainmentActionType,
  CapaContainmentRiskContent,
  CapaRiskEscalation,
} from "@/lib/capa/domain/capa-containment-risk";

export interface CapaContainmentRiskReviewDraft {
  readonly actionRows: string;
  readonly products: string;
  readonly processes: string;
  readonly dataImpact: string;
  readonly customerImpact: string;
  readonly patientImpact: string;
  readonly riskMethod: string;
  readonly riskTerminologyVersion: string;
  readonly riskResult: string;
  readonly riskRationale: string;
  readonly missingRiskInformation: string;
  readonly escalationRows: string;
  readonly approvalRationale: string;
}

export const EMPTY_CAPA_CONTAINMENT_RISK_REVIEW_DRAFT:
  CapaContainmentRiskReviewDraft = Object.freeze({
    actionRows: "",
    products: "",
    processes: "",
    dataImpact: "",
    customerImpact: "",
    patientImpact: "",
    riskMethod: "",
    riskTerminologyVersion: "",
    riskResult: "",
    riskRationale: "",
    missingRiskInformation: "",
    escalationRows: "",
    approvalRationale: "",
  });

export type BuildCapaContainmentRiskReviewSubmissionResult =
  | {
      readonly valid: true;
      readonly submission: {
        readonly containmentRisk: CapaContainmentRiskContent;
        readonly approvalRationale: string;
      };
    }
  | {
      readonly valid: false;
      readonly field: keyof CapaContainmentRiskReviewDraft;
      readonly message: string;
    };

function lines(value: string): readonly string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function nullable(value: string): string | null {
  const result = value.trim();
  return result.length === 0 ? null : result;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseActions(value: string): readonly CapaContainmentAction[] | null {
  const result: CapaContainmentAction[] = [];
  const ids = new Set<string>();
  for (const row of lines(value)) {
    const parts = row.split("|").map((item) => item.trim());
    if (parts.length !== 10) return null;
    const [id, type, description, owner, actionDate, targetDate, completedDate, status, rationale, evidence] = parts;
    if (
      !id || ids.has(id) ||
      (type !== "correction" && type !== "containment") ||
      !description ||
      !["planned", "in_progress", "completed", "cancelled"].includes(status ?? "") ||
      !rationale ||
      (actionDate !== "" && !validDate(actionDate ?? "")) ||
      (targetDate !== "" && !validDate(targetDate ?? "")) ||
      (completedDate !== "" && !validDate(completedDate ?? "")) ||
      (status === "completed" && completedDate === "")
    ) return null;
    ids.add(id);
    result.push({
      action_id: id,
      action_type: type as CapaContainmentActionType,
      description,
      owner_user_id: nullable(owner ?? ""),
      action_date: nullable(actionDate ?? ""),
      target_date: nullable(targetDate ?? ""),
      completed_date: nullable(completedDate ?? ""),
      status: status as CapaContainmentActionStatus,
      rationale,
      supporting_evidence_references: (evidence ?? "")
        .split(",").map((item) => item.trim()).filter(Boolean),
    });
  }
  return result;
}

function parseEscalations(value: string): readonly CapaRiskEscalation[] | null {
  const result: CapaRiskEscalation[] = [];
  for (const row of lines(value)) {
    const parts = row.split("|").map((item) => item.trim());
    if (parts.length !== 4 || parts.some((item) => item.length === 0)) return null;
    result.push({ process: parts[0]!, reference: parts[1]!, status: parts[2]!, rationale: parts[3]! });
  }
  return result;
}

export function buildCapaContainmentRiskReviewSubmission(
  draft: CapaContainmentRiskReviewDraft,
): BuildCapaContainmentRiskReviewSubmissionResult {
  const actions = parseActions(draft.actionRows);
  if (actions === null) return {
    valid: false, field: "actionRows",
    message: "Actions must use the documented ten-column controlled format.",
  };
  const escalations = parseEscalations(draft.escalationRows);
  if (escalations === null) return {
    valid: false, field: "escalationRows",
    message: "Escalations must use: process | reference | status | rationale.",
  };
  const riskParts = [draft.riskMethod, draft.riskResult, draft.riskRationale].map((item) => item.trim());
  const riskStarted = riskParts.some(Boolean) || draft.riskTerminologyVersion.trim().length > 0;
  if (riskStarted && riskParts.some((item) => item.length === 0)) return {
    valid: false, field: "riskRationale",
    message: "Risk method, result, and rationale are all required when a risk evaluation is recorded.",
  };
  const approvalRationale = draft.approvalRationale.trim();
  if (approvalRationale.length === 0) return {
    valid: false, field: "approvalRationale",
    message: "A human G-02 acceptance rationale is required.",
  };
  return {
    valid: true,
    submission: {
      containmentRisk: {
        actions,
        impact_scope: {
          products: lines(draft.products),
          processes: lines(draft.processes),
          data: lines(draft.dataImpact),
          customers: lines(draft.customerImpact),
          patients: lines(draft.patientImpact),
        },
        risk_evaluation: riskStarted ? {
          method: riskParts[0]!,
          terminology_version: nullable(draft.riskTerminologyVersion),
          result: riskParts[1]!,
          rationale: riskParts[2]!,
        } : null,
        missing_risk_information: lines(draft.missingRiskInformation),
        escalations,
      },
      approvalRationale,
    },
  };
}
