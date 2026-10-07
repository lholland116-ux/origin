import type { CapabilityId, CapabilityOutputKind } from "@/lib/ai/capability-registry";
import type { ExecutionStepResult, JsonValue } from "@/lib/agent-runtime/runtime-contracts";

export type RuntimeAttachmentReference = {
  readonly id: string;
  readonly kind: "file" | "image";
};

export type ExecutionRuntimeInput = {
  readonly userInput?: string;
  /** Identifiers and broad kinds only. File names, bytes, and extracted content are not accepted. */
  readonly attachments?: readonly RuntimeAttachmentReference[];
  readonly authenticatedUserId: string;
  /** Runtime V1 capabilities that use chat semantics are bound to one conversation. */
  readonly conversationId: string;
  readonly organizationId?: string;
  readonly resourceReferences?: readonly string[];
  readonly requestId?: string;
  readonly correlationId?: string;
};

export type ResolvedExecutionInput =
  | { readonly source: "user"; readonly value: string }
  | { readonly source: "attachment"; readonly reference: RuntimeAttachmentReference }
  | { readonly source: "step"; readonly stepId: string; readonly result: ExecutionStepResult };

export type CapabilityExecutionInput = {
  readonly executionId: string;
  readonly stepId: string;
  /** Stable, durable key for this run/step/attempt; present only for persisted execution. */
  readonly executionKey?: string;
  readonly capabilityId: CapabilityId;
  readonly inputs: readonly ResolvedExecutionInput[];
  readonly context: {
    readonly authenticatedUserId: string;
    readonly conversationId: string;
    readonly organizationId?: string;
    readonly resourceReferences: readonly string[];
    readonly requestId?: string;
    readonly correlationId?: string;
  };
};

export type CapabilityExecutionResult = ExecutionStepResult & {
  readonly kind: CapabilityOutputKind;
  readonly value?: JsonValue;
};

export interface CapabilityExecutor {
  execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult>;
}

export type ExecutionAuthorizationInput = {
  readonly executionId: string;
  readonly stepId: string;
  readonly capabilityId: CapabilityId;
  readonly authenticatedUserId: string;
  readonly conversationId: string;
  readonly organizationId?: string;
  readonly resourceReferences: readonly string[];
  readonly requestId?: string;
  readonly correlationId?: string;
};

export type ExecutionAuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasonCode?: string };

export interface ExecutionAuthorizer {
  authorize(input: ExecutionAuthorizationInput): Promise<ExecutionAuthorizationDecision>;
}
