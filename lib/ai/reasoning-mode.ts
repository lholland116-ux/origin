import type { AdaptiveReasoningEffort } from "./reasoning-effort";

export type UserReasoningMode = "instant" | "medium" | "high";
export type ReasoningPlan = "free" | "pro" | string | null | undefined;
export type ProviderChatReasoningEffort = "none" | AdaptiveReasoningEffort;

export type ParsedUserReasoningMode =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly mode: UserReasoningMode }
  | { readonly kind: "invalid" };

export type ReasoningResolution =
  | { readonly ok: true; readonly effort: ProviderChatReasoningEffort }
  | { readonly ok: false; readonly code: "REASONING_MODE_NOT_ENTITLED" };

const USER_REASONING_MODES: readonly UserReasoningMode[] = [
  "instant",
  "medium",
  "high",
];

export function parseUserReasoningMode(body: unknown): ParsedUserReasoningMode {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid" };
  }

  if (!Object.prototype.hasOwnProperty.call(body, "reasoningMode")) {
    return { kind: "absent" };
  }

  const value = (body as { reasoningMode?: unknown }).reasoningMode;
  if (typeof value !== "string" || !USER_REASONING_MODES.includes(value as UserReasoningMode)) {
    return { kind: "invalid" };
  }

  return { kind: "valid", mode: value as UserReasoningMode };
}

export function mapUserReasoningModeToProviderEffort(
  mode: UserReasoningMode,
): ProviderChatReasoningEffort {
  switch (mode) {
    case "instant":
      return "none";
    case "medium":
      return "medium";
    case "high":
      return "high";
  }
}

export function resolveProviderReasoningEffort(params: {
  readonly parsedMode: Exclude<ParsedUserReasoningMode, { readonly kind: "invalid" }>;
  readonly plan: ReasoningPlan;
  readonly adaptiveEffort?: AdaptiveReasoningEffort;
}): ReasoningResolution {
  const isPro = params.plan === "pro";

  if (params.parsedMode.kind === "valid") {
    if (params.parsedMode.mode === "high" && !isPro) {
      return { ok: false, code: "REASONING_MODE_NOT_ENTITLED" };
    }

    return {
      ok: true,
      effort: mapUserReasoningModeToProviderEffort(params.parsedMode.mode),
    };
  }

  const adaptiveEffort = params.adaptiveEffort ?? "medium";
  return {
    ok: true,
    effort: !isPro && adaptiveEffort === "high" ? "medium" : adaptiveEffort,
  };
}
