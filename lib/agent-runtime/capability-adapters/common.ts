import { requestMessageBindingSchema, type RequestMessageBinding, type RequestTransactionContext } from "@/lib/agent-runtime/application-contracts";
import type { CapabilityExecutionInput, ResolvedExecutionInput } from "@/lib/agent-runtime/capability-executor";
import {
  isJsonValue,
  type ExecutionFailureCode,
  type ExecutionFailureDescriptor,
  type ExecutionStepResult,
} from "@/lib/agent-runtime/runtime-contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_FAILURE_CODES = new Set<ExecutionFailureCode>([
  "invalid_handoff",
  "unsupported_capability",
  "missing_input",
  "missing_predecessor_result",
  "authorization_denied",
  "authorization_failed",
  "result_too_large",
  "quota_exhausted",
  "retry_exhausted",
  "ownership_denied",
  "idempotency_conflict",
  "invalid_persisted_state",
  "unsupported_handoff_version",
  "unsupported_snapshot_version",
  "invalid_snapshot",
]);

export type AdapterFailureMetadata = Omit<ExecutionFailureDescriptor, "code">;

/** Safe adapter failure. Raw provider, storage, and database errors never cross this boundary. */
export class CapabilityAdapterError extends Error {
  readonly descriptor: ExecutionFailureDescriptor;

  constructor(readonly code: ExecutionFailureCode, metadata?: AdapterFailureMetadata) {
    super("The requested step could not be completed.");
    this.name = "CapabilityAdapterError";
    this.descriptor = Object.freeze({
      code,
      ...(metadata ?? {
        phase: "unknown" as const,
        retrySafety: TERMINAL_FAILURE_CODES.has(code) ? "TERMINAL" as const : "RECOVERY_REQUIRED" as const,
      }),
    });
  }
}

export function fail(code: ExecutionFailureCode): never {
  throw new CapabilityAdapterError(code);
}

export function failWithMetadata(code: ExecutionFailureCode, metadata: AdapterFailureMetadata): never {
  throw new CapabilityAdapterError(code, metadata);
}

export function assertAdapterInput(input: CapabilityExecutionInput, capabilityId: string): RequestMessageBinding {
  if (!input || typeof input !== "object" || input.capabilityId !== capabilityId) {
    return fail("unsupported_capability");
  }
  const context = input.context;
  if (!context || typeof context !== "object") return fail("invalid_handoff");
  const parsed = requestMessageBindingSchema.safeParse(context.requestMessageBinding);
  if (!parsed.success
    || parsed.data.userId !== context.authenticatedUserId
    || parsed.data.conversationId !== context.conversationId
    || (context.requestId !== undefined && context.requestId !== parsed.data.requestId)) {
    return fail("ownership_denied");
  }
  if (input.inputs !== undefined && !Array.isArray(input.inputs)) return fail("invalid_handoff");
  if (input.executionKey !== undefined
    && (typeof input.executionKey !== "string" || !UUID_PATTERN.test(input.executionKey))) return fail("invalid_handoff");
  return parsed.data;
}

export function requireExecutionKey(input: CapabilityExecutionInput): string {
  if (!input.executionKey || !UUID_PATTERN.test(input.executionKey)) return fail("missing_input");
  return input.executionKey;
}

export function requestContextFromBinding(binding: RequestMessageBinding): RequestTransactionContext {
  return {
    requestId: binding.requestId,
    userId: binding.userId,
    conversationId: binding.conversationId,
    userMessageId: binding.userMessageId,
    assistantMessageId: binding.assistantMessageId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function normalizedInputs(input: CapabilityExecutionInput): readonly ResolvedExecutionInput[] {
  if (!Array.isArray(input.inputs)) return fail("invalid_handoff");
  for (const item of input.inputs) {
    if (!isRecord(item) || typeof item.source !== "string") return fail("invalid_handoff");
    if (item.source === "user") {
      if (Object.keys(item).some((key) => !["source", "value"].includes(key)) || typeof item.value !== "string") {
        return fail("missing_input");
      }
      continue;
    }
    if (item.source === "attachment") {
      if (Object.keys(item).some((key) => !["source", "reference"].includes(key)) || !isRecord(item.reference)
        || Object.keys(item.reference).some((key) => !["id", "kind"].includes(key))
        || typeof item.reference.id !== "string" || item.reference.id.length < 1 || item.reference.id.length > 200
        || !["file", "image"].includes(String(item.reference.kind))) return fail("missing_input");
      continue;
    }
    if (item.source === "step") {
      if (Object.keys(item).some((key) => !["source", "stepId", "result"].includes(key))
        || typeof item.stepId !== "string" || !item.stepId || !isRecord(item.result)
        || Object.keys(item.result).some((key) => !["kind", "value", "ref"].includes(key))
        || !["text", "search_results", "image", "structured_data", "artifact", "document"].includes(String(item.result.kind))
        || (!Object.prototype.hasOwnProperty.call(item.result, "value") && !Object.prototype.hasOwnProperty.call(item.result, "ref"))
        || (Object.prototype.hasOwnProperty.call(item.result, "value") && !isJsonValue(item.result.value))) {
        return fail("missing_predecessor_result");
      }
      const ref = item.result.ref;
      if (ref !== undefined && (!isRecord(ref)
        || Object.keys(ref).some((key) => !["id", "kind"].includes(key))
        || typeof ref.id !== "string" || ref.id.length < 1 || ref.id.length > 200
        || /[\u0000-\u001f\u007f]/.test(ref.id)
        || !["artifact", "document", "image", "file"].includes(String(ref.kind)))) {
        return fail("missing_predecessor_result");
      }
      continue;
    }
    return fail("invalid_handoff");
  }
  return input.inputs;
}

export function userObjective(inputs: readonly ResolvedExecutionInput[]): string {
  const values = inputs.filter((item): item is Extract<ResolvedExecutionInput, { source: "user" }> => item.source === "user");
  if (values.length !== 1 || !values[0]!.value.trim()) return fail("missing_input");
  return values[0]!.value.trim();
}

export function predecessorInputs(inputs: readonly ResolvedExecutionInput[]): readonly Extract<ResolvedExecutionInput, { source: "step" }>[] {
  return inputs.filter((item): item is Extract<ResolvedExecutionInput, { source: "step" }> => item.source === "step");
}

export function attachmentInputs(inputs: readonly ResolvedExecutionInput[]): readonly Extract<ResolvedExecutionInput, { source: "attachment" }>[] {
  return inputs.filter((item): item is Extract<ResolvedExecutionInput, { source: "attachment" }> => item.source === "attachment");
}

export function requireResultKind(result: ExecutionStepResult, kind: string): unknown {
  if (result.kind !== kind || !Object.prototype.hasOwnProperty.call(result, "value")) {
    return fail("missing_predecessor_result");
  }
  return result.value;
}
