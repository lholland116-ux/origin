import { z } from "zod";
import type { CapabilityOutputKind } from "@/lib/ai/capability-registry";

export const EXECUTION_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export const EXECUTION_STEP_STATUSES = ["pending", "running", "succeeded", "failed", "skipped"] as const;

export const executionStepSchema = z.object({
  id: z.string().min(1),
  capability: z.string().min(1),
  status: z.enum(EXECUTION_STEP_STATUSES),
  dependsOn: z.array(z.string()),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  attempt: z.number().int().min(1),
  resultRef: z.string().optional(),
  errorCode: z.string().optional(),
}).strict();

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
  "invalid_executor_result",
] as const;

export type ExecutionFailureCode = (typeof EXECUTION_FAILURE_CODES)[number];
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
