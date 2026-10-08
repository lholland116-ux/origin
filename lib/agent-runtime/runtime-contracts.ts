import { z } from "zod";
import type { CapabilityOutputKind } from "@/lib/ai/capability-registry";

export const EXECUTION_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export const EXECUTION_STEP_STATUSES = ["pending", "running", "retry_pending", "succeeded", "failed", "skipped"] as const;
export const MAX_EXECUTION_STEP_ATTEMPTS = 3 as const;

export const executionStepSchema = z.object({
  id: z.string().min(1),
  capability: z.string().min(1),
  status: z.enum(EXECUTION_STEP_STATUSES),
  dependsOn: z.array(z.string()),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  attempt: z.number().int().min(1).max(MAX_EXECUTION_STEP_ATTEMPTS),
  nextRetryAt: z.string().datetime().optional(),
  resultRef: z.string().optional(),
  errorCode: z.string().optional(),
}).strict().superRefine((step, context) => {
  if ((step.status === "retry_pending") !== (step.nextRetryAt !== undefined)) {
    context.addIssue({ code: "custom", message: "Only retry-pending steps may have a retry eligibility time." });
  }
  if (step.status === "retry_pending" && (!step.startedAt || step.completedAt || step.resultRef)) {
    context.addIssue({ code: "custom", message: "Retry-pending steps must represent an incomplete attempt without a result." });
  }
});

export const executionRunSchema = z.object({
  id: z.string().min(1),
  handoffVersion: z.number().int(),
  objective: z.string(),
  status: z.enum(EXECUTION_RUN_STATUSES),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  orderedStepIds: z.array(z.string()),
  steps: z.array(executionStepSchema),
}).strict();

export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];
export type ExecutionStepStatus = (typeof EXECUTION_STEP_STATUSES)[number];
export type ExecutionStep = z.infer<typeof executionStepSchema>;
export type ExecutionRun = z.infer<typeof executionRunSchema>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ExecutionStepResult = {
  readonly kind: CapabilityOutputKind;
  readonly value?: JsonValue;
  readonly ref?: {
    readonly id: string;
    readonly kind: "artifact" | "document" | "image" | "file";
  };
};

export const EXECUTION_FAILURE_CODES = [
  "invalid_handoff",
  "unsupported_capability",
  "missing_input",
  "missing_predecessor_result",
  "authorization_denied",
  "authorization_failed",
  "executor_failed",
  "transient_dependency_failure",
  "retry_exhausted",
  "quota_exhausted",
  "invalid_executor_result",
  "result_too_large",
  "ownership_denied",
  "idempotency_conflict",
  "snapshot_conflict",
  "indeterminate_step",
  "invalid_persisted_state",
  "unsupported_handoff_version",
  "unsupported_snapshot_version",
  "invalid_snapshot",
  "persistence_failed",
] as const;

export type ExecutionFailureCode = (typeof EXECUTION_FAILURE_CODES)[number];

export const EXECUTION_FAILURE_PHASES = [
  "pre_execution",
  "pre_provider",
  "provider_in_flight",
  "post_provider",
  "read_only_lookup",
  "pre_persistence",
  "persistence",
  "post_persistence",
  "unknown",
] as const;

export const RETRY_SAFETY_CLASSES = ["SAFE_RETRY", "TERMINAL", "RECOVERY_REQUIRED"] as const;

export type ExecutionFailurePhase = (typeof EXECUTION_FAILURE_PHASES)[number];
export type RetrySafetyClass = (typeof RETRY_SAFETY_CLASSES)[number];

/** Safe, normalized metadata only; never contains provider/SQL exception details. */
export type ExecutionFailureDescriptor = Readonly<{
  code: ExecutionFailureCode;
  phase: ExecutionFailurePhase;
  retrySafety: RetrySafetyClass;
  retryAfterMs?: number;
}>;

export type ExecutionFailure = {
  readonly code: ExecutionFailureCode;
  readonly message: string;
};

export type ExecutionOperationalMetadata = {
  readonly execution_id: string;
  readonly status: "succeeded" | "failed";
  readonly step_count: number;
  readonly completed_step_count: number;
  readonly current_step_id: string | null;
  readonly capability_steps: readonly {
    readonly step_id: string;
    readonly capability: string;
    readonly status: ExecutionStepStatus;
    readonly attempt: number;
  }[];
  readonly runtime_duration_ms: number;
  readonly failure_code: ExecutionFailureCode | null;
};

export type ExecutionOutcome =
  | {
      readonly kind: "succeeded";
      readonly run: ExecutionRun;
      readonly stepResults: Readonly<Record<string, ExecutionStepResult>>;
      readonly telemetry: ExecutionOperationalMetadata;
    }
  | {
      readonly kind: "failed";
      readonly run: ExecutionRun;
      readonly failure: ExecutionFailure;
      readonly stepResults: Readonly<Record<string, ExecutionStepResult>>;
      readonly telemetry: ExecutionOperationalMetadata;
    }
  | {
      readonly kind: "rejected";
      readonly failure: ExecutionFailure;
    }
  | {
      readonly kind: "recovery_required";
      readonly run: ExecutionRun;
      readonly failure: ExecutionFailure;
      readonly stepId: string;
    }
  | {
      readonly kind: "retry_pending";
      readonly run: ExecutionRun;
      readonly stepId: string;
      readonly nextRetryAt: string;
    };

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value).every(isJsonValue);
}
