import { createIntelligenceDecisionCoordinator, type IntelligenceDecision } from "@/lib/ai/intelligence-decision-coordinator";
import { agentRequestAcceptanceInputSchema, fingerprintAgentRequest, type AgentRequestAcceptanceResult } from "@/lib/agent-runtime/request-acceptance";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import type { ExecutionRuntimeInput, RuntimeAttachmentReference } from "@/lib/agent-runtime/capability-executor";
import type { AcceptedRunAssociationOutcome } from "@/lib/agent-runtime/durable-execution-runtime";
import { validateExecutionHandoff } from "@/lib/agent-runtime/xstate-runtime-adapter";
import type { AcceptedRequestExecutionIdentity, DurableExecutionRun, LookupAcceptedExecutionRunResult } from "@/lib/agent-runtime/execution-store";

if (typeof window !== "undefined") throw new Error("Accepted execution composition is server-only");

export type AcceptedExecutionCompositionDependencies = Readonly<{
  accept: (input: unknown) => Promise<AgentRequestAcceptanceResult>;
  lookup: (identity: AcceptedRequestExecutionIdentity) => Promise<LookupAcceptedExecutionRunResult>;
  associate: (handoff: unknown, runtimeInput: ExecutionRuntimeInput, identity: AcceptedRequestExecutionIdentity) => Promise<AcceptedRunAssociationOutcome>;
  resolveImages: (binding: RequestMessageBinding) => Promise<readonly RuntimeAttachmentReference[]>;
  decide: (input: Parameters<ReturnType<typeof createIntelligenceDecisionCoordinator>["decideIntelligenceAction"]>[0]) => Promise<IntelligenceDecision>;
}>;

export type AcceptedExecutionCompositionResult =
  | { readonly kind: "associated"; readonly status: "created" | "existing"; readonly run: DurableExecutionRun }
  | { readonly kind: "single_step"; readonly decision: Extract<IntelligenceDecision, { kind: "single_step" }> }
  | { readonly kind: "unable_to_plan"; readonly decision: Extract<IntelligenceDecision, { kind: "unable_to_plan" }> }
  | { readonly kind: "rejected"; readonly reason: "invalid_request" | "unauthorized" | "unavailable" | "conflict" | "invalid_handoff" };

function acceptedIdentity(accepted: Extract<AgentRequestAcceptanceResult, { kind: "accepted" }>): AcceptedRequestExecutionIdentity {
  return {
    requestId: accepted.binding.requestId,
    userId: accepted.binding.userId,
    conversationId: accepted.binding.conversationId,
    userMessageId: accepted.binding.userMessageId,
    assistantMessageId: accepted.binding.assistantMessageId,
    idempotencyKey: accepted.idempotencyKey,
    requestFingerprint: accepted.requestFingerprint,
  };
}

function existingResult(lookup: LookupAcceptedExecutionRunResult): AcceptedExecutionCompositionResult | null {
  if (lookup.status !== "found") {
    return lookup.status === "not_found" ? null : { kind: "rejected", reason: "conflict" };
  }
  return { kind: "associated", status: "existing", run: lookup.run };
}

export function createAcceptedExecutionComposer(dependencies: AcceptedExecutionCompositionDependencies) {
  return Object.freeze({
    async prepare(rawInput: unknown): Promise<AcceptedExecutionCompositionResult> {
      const parsed = agentRequestAcceptanceInputSchema.safeParse(rawInput);
      if (!parsed.success) return { kind: "rejected", reason: "invalid_request" };

      let accepted: AgentRequestAcceptanceResult;
      try {
        accepted = await dependencies.accept(parsed.data);
      } catch {
        return { kind: "rejected", reason: "unavailable" };
      }
      if (accepted.kind !== "accepted") {
        return { kind: "rejected", reason: accepted.kind === "unauthorized" ? "unauthorized" : accepted.kind === "invalid_request" ? "invalid_request" : accepted.kind === "idempotency_conflict" ? "conflict" : "unavailable" };
      }
      let fingerprint: string;
      try {
        fingerprint = fingerprintAgentRequest(parsed.data);
      } catch {
        return { kind: "rejected", reason: "invalid_request" };
      }
      if (accepted.requestFingerprint !== fingerprint
        || accepted.binding.conversationId !== parsed.data.conversationId
        || accepted.binding.userId === "") return { kind: "rejected", reason: "conflict" };

      const identity = acceptedIdentity(accepted);
      try {
        const prior = existingResult(await dependencies.lookup(identity));
        if (prior) return prior;
      } catch {
        return { kind: "rejected", reason: "unavailable" };
      }

      let imageAttachments: readonly RuntimeAttachmentReference[];
      try {
        imageAttachments = await dependencies.resolveImages(accepted.binding);
      } catch {
        return { kind: "rejected", reason: "unavailable" };
      }
      if (imageAttachments.length !== parsed.data.images.length
        || imageAttachments.some((item) => item.kind !== "image" || !item.id)
        || new Set(imageAttachments.map(({ id }) => id)).size !== imageAttachments.length) {
        return { kind: "rejected", reason: "conflict" };
      }
      const attachments: RuntimeAttachmentReference[] = [
        ...parsed.data.documentIds.map((id) => ({ id, kind: "file" as const })),
        ...imageAttachments,
      ];
      const attachmentKinds = attachments.map(({ kind }) => kind);
      let decision: IntelligenceDecision;
      try {
        decision = await dependencies.decide({
          prompt: parsed.data.message,
          router: {
            mode: parsed.data.requestOptions.routingMode,
            hasImageContext: false,
            hasImageAttachment: imageAttachments.length > 0,
            hasDocumentAttachment: parsed.data.documentIds.length > 0,
          },
          attachments: attachmentKinds,
        });
      } catch {
        return { kind: "rejected", reason: "unavailable" };
      }
      if (decision.kind === "single_step") return { kind: "single_step", decision };
      if (decision.kind === "unable_to_plan") return { kind: "unable_to_plan", decision };
      const checkedHandoff = validateExecutionHandoff(decision.handoff);
      if (!checkedHandoff.handoff) return { kind: "rejected", reason: "invalid_handoff" };

      const runtimeInput: ExecutionRuntimeInput = {
        userInput: parsed.data.message,
        attachments,
        authenticatedUserId: accepted.binding.userId,
        conversationId: accepted.binding.conversationId,
        requestMessageBinding: accepted.binding,
        ...(parsed.data.requestOptions.reasoningMode ? { reasoningMode: parsed.data.requestOptions.reasoningMode } : {}),
        requestId: accepted.binding.requestId,
      };
      let associated: AcceptedRunAssociationOutcome;
      try {
        associated = await dependencies.associate(checkedHandoff.handoff, runtimeInput, identity);
      } catch {
        return { kind: "rejected", reason: "unavailable" };
      }
      if (associated.kind !== "associated") {
        return { kind: "rejected", reason: associated.failure.code === "invalid_handoff" ? "invalid_handoff" : "conflict" };
      }
      let persisted: LookupAcceptedExecutionRunResult;
      try {
        persisted = await dependencies.lookup(identity);
      } catch {
        return { kind: "rejected", reason: "unavailable" };
      }
      if (persisted.status !== "found" || persisted.run.id !== associated.runId
        || persisted.run.requestFingerprint !== associated.planFingerprint) {
        return { kind: "rejected", reason: "conflict" };
      }
      return { kind: "associated", status: associated.status, run: persisted.run };
    },
  });
}
