import { z } from "zod";
import { classifyTaskComplexity } from "@/lib/ai/task-complexity";
import type { WorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workflowState = z.enum([
  "prepared", "executing", "pause_requested", "paused", "stop_requested",
  "stopped", "returned", "approval_required", "completed", "failed",
]);
const controlState = z.enum(["active", "pause_requested", "paused", "stop_requested", "stopped", "returned"]);
const stepState = z.enum(["pending", "running", "retry_pending", "succeeded", "failed", "skipped"]);

const workflowProgressSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(UUID),
  conversationId: z.string().regex(UUID),
  state: workflowState,
  controlState,
  controlRevision: z.number().int().nonnegative(),
  createdAt: z.string().min(1).max(64),
  startedAt: z.string().min(1).max(64).optional(),
  completedAt: z.string().min(1).max(64).optional(),
  completedStepCount: z.number().int().nonnegative(),
  totalStepCount: z.number().int().positive(),
  failurePresent: z.boolean(),
  recoveryRequired: z.boolean(),
  approvalCheckpoints: z.array(z.object({
    id: z.string().regex(UUID),
    stepId: z.string().min(1).max(128),
    state: z.enum(["pending", "approved", "returned"]),
  }).strict()).max(64),
  steps: z.array(z.object({
    id: z.string().min(1).max(128),
    capabilityLabel: z.string().min(1).max(100),
    state: stepState,
    approvalRequired: z.boolean(),
    startedAt: z.string().min(1).max(64).optional(),
    completedAt: z.string().min(1).max(64).optional(),
  }).strict()).min(1).max(64),
}).strict().refine((value) => value.completedStepCount <= value.totalStepCount
  && value.steps.length === value.totalStepCount, "Invalid workflow progress counts.");

const trackingRecordSchema = z.object({
  runId: z.string().regex(UUID),
  conversationId: z.string().regex(UUID),
  assistantMessageId: z.string().regex(UUID),
}).strict();

const acceptedRequestSchema = z.object({
  requestId: z.string().regex(UUID),
  userMessageId: z.string().regex(UUID),
  assistantMessageId: z.string().regex(UUID),
  idempotencyKey: z.string().regex(UUID),
}).strict();

export const WORKFLOW_PROGRESS_STORAGE_KEY = "lvtchat.workflow-progress.v1";
export const WORKFLOW_PROGRESS_REFRESH_MS = 30_000;
export const WORKFLOW_PROGRESS_WAIT_REFRESH_MS = 60_000;
export const WORKFLOW_PROGRESS_MAX_REFRESH_MS = 120_000;

export type WorkflowTrackingRecord = Readonly<z.infer<typeof trackingRecordSchema>>;
export type WorkflowAcceptedStart = Readonly<{
  acceptedRequest: z.infer<typeof acceptedRequestSchema>;
  status: WorkflowProgressDto;
}>;

export type WorkflowProgressStorage = Pick<Storage, "getItem" | "setItem">;

function parseTrackingRecords(value: unknown): WorkflowTrackingRecord[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, WorkflowTrackingRecord>();
  for (const candidate of value) {
    const parsed = trackingRecordSchema.safeParse(candidate);
    if (!parsed.success) continue;
    unique.set(`${parsed.data.conversationId}:${parsed.data.assistantMessageId}`, parsed.data);
  }
  return [...unique.values()];
}

export function readWorkflowTrackingRecords(
  storage: WorkflowProgressStorage | null,
  conversationId: string,
): WorkflowTrackingRecord[] {
  if (!storage || !UUID.test(conversationId)) return [];
  try {
    return parseTrackingRecords(JSON.parse(storage.getItem(WORKFLOW_PROGRESS_STORAGE_KEY) ?? "[]"))
      .filter((record) => record.conversationId === conversationId);
  } catch {
    return [];
  }
}

export function saveWorkflowTrackingRecord(
  storage: WorkflowProgressStorage | null,
  record: WorkflowTrackingRecord,
): boolean {
  if (!storage || !trackingRecordSchema.safeParse(record).success) return false;
  try {
    const existing = parseTrackingRecords(JSON.parse(storage.getItem(WORKFLOW_PROGRESS_STORAGE_KEY) ?? "[]"));
    const records = existing.filter((item) => item.conversationId !== record.conversationId
      || item.assistantMessageId !== record.assistantMessageId);
    records.push(record);
    storage.setItem(WORKFLOW_PROGRESS_STORAGE_KEY, JSON.stringify(records.slice(-250)));
    return true;
  } catch {
    return false;
  }
}

export function upsertWorkflowTrackingRecords(
  records: readonly WorkflowTrackingRecord[],
  record: WorkflowTrackingRecord,
): WorkflowTrackingRecord[] {
  const parsed = trackingRecordSchema.safeParse(record);
  if (!parsed.success) return [...records];
  return [
    ...records.filter((item) => item.conversationId !== record.conversationId
      || item.assistantMessageId !== record.assistantMessageId),
    parsed.data,
  ].slice(-250);
}

export function parseWorkflowProgress(value: unknown): WorkflowProgressDto | null {
  const parsed = workflowProgressSchema.safeParse(value);
  return parsed.success ? parsed.data as WorkflowProgressDto : null;
}

export function parseWorkflowStatusResponse(
  value: unknown,
  expectedRunId: string,
  expectedConversationId: string,
): WorkflowProgressDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = parseWorkflowProgress((value as Record<string, unknown>).status);
  return status?.runId === expectedRunId && status.conversationId === expectedConversationId
    ? status
    : null;
}

export function shouldPrepareMultiStepWorkflow(input: Readonly<{
  message: string;
  webSearchOverride: boolean;
  imageGeneration: boolean;
}>): boolean {
  return !input.webSearchOverride && !input.imageGeneration
    && classifyTaskComplexity(input.message) === "multi_step";
}

export function parseAcceptedWorkflowStart(
  value: unknown,
  expectedConversationId: string,
  expectedIdempotencyKey: string,
): WorkflowAcceptedStart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const acceptedRequest = acceptedRequestSchema.safeParse(record.acceptedRequest);
  const status = parseWorkflowProgress(record.status);
  if (record.accepted !== true || !acceptedRequest.success || !status
    || acceptedRequest.data.idempotencyKey !== expectedIdempotencyKey
    || status.conversationId !== expectedConversationId) return null;
  return { acceptedRequest: acceptedRequest.data, status };
}

export function parseAcceptedWorkflowRecovery(
  value: unknown,
  expectedIdempotencyKey: string,
): z.infer<typeof acceptedRequestSchema> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const recovery = (value as Record<string, unknown>).recovery;
  const parsed = acceptedRequestSchema.safeParse(recovery);
  return parsed.success && parsed.data.idempotencyKey === expectedIdempotencyKey
    ? parsed.data
    : null;
}

export function isWorkflowFeatureDisabledResponse(status: number, value: unknown): boolean {
  if (status !== 404 || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = (value as Record<string, unknown>).error;
  return Boolean(error && typeof error === "object" && !Array.isArray(error)
    && (error as Record<string, unknown>).code === "feature_disabled");
}

export function isWorkflowProgressTerminal(status: WorkflowProgressDto): boolean {
  return status.recoveryRequired || ["completed", "failed", "stopped", "returned"].includes(status.state);
}

export function workflowProgressRefreshDelay(
  status: WorkflowProgressDto | null,
  consecutiveFailures: number,
): number {
  if (consecutiveFailures > 0) {
    return Math.min(WORKFLOW_PROGRESS_REFRESH_MS * (2 ** (consecutiveFailures - 1)), WORKFLOW_PROGRESS_MAX_REFRESH_MS);
  }
  if (!status || ["approval_required", "pause_requested", "paused", "stop_requested"].includes(status.state)) {
    return WORKFLOW_PROGRESS_WAIT_REFRESH_MS;
  }
  return WORKFLOW_PROGRESS_REFRESH_MS;
}

export function workflowStatusHttpFailure(status: number): "reauthenticate" | "unavailable" | "retry" | null {
  if (status === 401) return "reauthenticate";
  if (status === 404) return "unavailable";
  return status >= 200 && status < 300 ? null : "retry";
}
