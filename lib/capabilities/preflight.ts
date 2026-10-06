import { CAPABILITY_REGISTRY, type CapabilityId } from "@/lib/ai/capability-registry";
import {
  resolveProviderReasoningEffort,
  type ParsedUserReasoningMode,
} from "@/lib/ai/reasoning-mode";
import type { AdaptiveReasoningEffort } from "@/lib/ai/reasoning-effort";
import type { AccountPlanResolution } from "./account-plan";
import type {
  CapabilityResourceReference,
  CapabilityServiceContext,
} from "./service-context";

export type CapabilityDenialReason =
  | "unauthenticated"
  | "account_state_unavailable"
  | "conversation_required"
  | "capability_not_entitled"
  | "reasoning_not_entitled"
  | "resource_not_owned"
  | "resource_unavailable"
  | "quota_unavailable"
  | "quota_limit_reached"
  | "capability_disabled";

export type CapabilityPreflightResult =
  | { readonly kind: "allowed"; readonly plan: "free" | "pro" }
  | { readonly kind: "denied"; readonly reason: CapabilityDenialReason };

export type OwnershipResult = "owned" | "not_owned" | "unavailable";
export type QuotaEligibility = "eligible" | "limit_reached" | "unavailable";

export interface CapabilityPreflightPolicy {
  isEnabled(capabilityId: CapabilityId): boolean;
  /** Keep capability-specific plan/quota rules at the authoritative policy boundary. */
  isEntitled(plan: "free" | "pro", capabilityId: CapabilityId): boolean;
  checkConversationOwnership(
    userId: string,
    conversationId: string,
  ): PromiseLike<OwnershipResult>;
  checkOwnership(
    userId: string,
    resource: CapabilityResourceReference,
  ): PromiseLike<OwnershipResult>;
  /** Read-only eligibility only; authoritative reservation happens afterward. */
  checkQuotaEligibility?(
    userId: string,
    capabilityId: CapabilityId,
  ): PromiseLike<QuotaEligibility>;
}

export async function preflightCapability(params: {
  readonly context: CapabilityServiceContext | null;
  readonly capabilityId: string;
  readonly account: AccountPlanResolution;
  readonly reasoning?: Exclude<ParsedUserReasoningMode, { readonly kind: "invalid" }>;
  readonly adaptiveEffort?: AdaptiveReasoningEffort;
  readonly policy: CapabilityPreflightPolicy;
}): Promise<CapabilityPreflightResult> {
  const { context, capabilityId, account } = params;
  if (!context) return { kind: "denied", reason: "unauthenticated" };
  if (account.kind !== "resolved" || account.userId !== context.userId) {
    return { kind: "denied", reason: "account_state_unavailable" };
  }

  const capability = CAPABILITY_REGISTRY.get(capabilityId);
  if (!capability) return { kind: "denied", reason: "capability_disabled" };
  if (
    context.kind !== "conversation" &&
    (capability.id === "standard" || capability.id === "web_search")
  ) {
    return { kind: "denied", reason: "conversation_required" };
  }
  if (!params.policy.isEnabled(capability.id)) {
    return { kind: "denied", reason: "capability_disabled" };
  }
  if (!params.policy.isEntitled(account.plan, capability.id)) {
    return { kind: "denied", reason: "capability_not_entitled" };
  }

  if (context.kind === "conversation") {
    let conversationOwnership: OwnershipResult;
    try {
      conversationOwnership = await params.policy.checkConversationOwnership(
        context.userId,
        context.conversationId,
      );
    } catch {
      conversationOwnership = "unavailable";
    }
    if (conversationOwnership === "not_owned") {
      return { kind: "denied", reason: "resource_not_owned" };
    }
    if (conversationOwnership === "unavailable") {
      return { kind: "denied", reason: "resource_unavailable" };
    }
  }

  if (params.reasoning) {
    const reasoningResult = resolveProviderReasoningEffort({
      parsedMode: params.reasoning,
      plan: account.plan,
      adaptiveEffort: params.adaptiveEffort,
    });
    if (!reasoningResult.ok) {
      return { kind: "denied", reason: "reasoning_not_entitled" };
    }
  }

  const resources = [
    ...(context.attachmentRefs ?? []),
    ...(context.imageRefs ?? []),
    ...(context.artifactRefs ?? []),
  ];
  const hasAcceptedAttachment = resources.some((resource) =>
    resource.kind !== "artifact" && capability.acceptedInputs.includes(resource.kind),
  );
  if (capability.requiresAttachment && !hasAcceptedAttachment) {
    return { kind: "denied", reason: "resource_unavailable" };
  }
  for (const resource of resources) {
    let ownership: OwnershipResult;
    try {
      ownership = await params.policy.checkOwnership(context.userId, resource);
    } catch {
      ownership = "unavailable";
    }
    if (ownership === "not_owned") {
      return { kind: "denied", reason: "resource_not_owned" };
    }
    if (ownership === "unavailable") {
      return { kind: "denied", reason: "resource_unavailable" };
    }
  }

  if (params.policy.checkQuotaEligibility) {
    let quota: QuotaEligibility;
    try {
      quota = await params.policy.checkQuotaEligibility(context.userId, capability.id);
    } catch {
      quota = "unavailable";
    }
    if (quota === "unavailable") return { kind: "denied", reason: "quota_unavailable" };
    if (quota === "limit_reached") return { kind: "denied", reason: "quota_limit_reached" };
  }

  return { kind: "allowed", plan: account.plan };
}
