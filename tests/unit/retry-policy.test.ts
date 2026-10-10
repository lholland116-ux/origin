import { describe, expect, it } from "vitest";
import { decideRetry, MAX_RETRY_DELAY_MS } from "@/lib/agent-runtime/retry-policy";

const safeStandardFailure = {
  code: "transient_dependency_failure",
  phase: "pre_provider",
  retrySafety: "SAFE_RETRY",
} as const;

describe("durable capability retry policy", () => {
  it("allows only the explicitly qualified pre-provider/read-only capability phases", () => {
    expect(decideRetry({ capabilityId: "standard", failure: safeStandardFailure, attempt: 1 }))
      .toEqual({ action: "retry", backoffMs: 1_000 });
    expect(decideRetry({ capabilityId: "web_search", failure: safeStandardFailure, attempt: 2 }))
      .toEqual({ action: "retry", backoffMs: 3_000 });
    expect(decideRetry({
      capabilityId: "file_analysis",
      failure: { ...safeStandardFailure, phase: "read_only_lookup" },
      attempt: 1,
    })).toEqual({ action: "retry", backoffMs: 1_000 });
    expect(decideRetry({
      capabilityId: "document_generation",
      failure: { ...safeStandardFailure, phase: "pre_execution" },
      attempt: 1,
    })).toEqual({ action: "retry", backoffMs: 1_000 });
  });

  it("fails terminal failures and requires recovery for ambiguous or capability-mismatched failures", () => {
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, retrySafety: "TERMINAL" }, attempt: 1 }))
      .toEqual({ action: "fail" });
    expect(decideRetry({ capabilityId: "image_generation", failure: safeStandardFailure, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "image_editing", failure: safeStandardFailure, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, phase: "provider_in_flight", retrySafety: "RECOVERY_REQUIRED" }, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "document_generation", failure: safeStandardFailure, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "standard", failure: { code: "executor_failed", phase: "unknown", retrySafety: "SAFE_RETRY" }, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, phase: "unknown" }, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
  });

  it("caps attempts at three and bounds normalized retry-after overrides", () => {
    expect(decideRetry({ capabilityId: "standard", failure: safeStandardFailure, attempt: 3 }))
      .toEqual({ action: "fail" });
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, retryAfterMs: 9_000 }, attempt: 1 }))
      .toEqual({ action: "retry", backoffMs: 9_000 });
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, retryAfterMs: 999_999 }, attempt: 1 }))
      .toEqual({ action: "retry", backoffMs: MAX_RETRY_DELAY_MS });
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, retryAfterMs: -1 }, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
  });

  it("fails closed for unknown descriptors and invalid attempt numbers", () => {
    expect(decideRetry({ capabilityId: "standard", failure: { ...safeStandardFailure, code: "private_error" }, attempt: 1 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "standard", failure: safeStandardFailure, attempt: 0 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({ capabilityId: "standard", failure: safeStandardFailure, attempt: 4 }))
      .toEqual({ action: "recovery_required" });
    expect(decideRetry({
      capabilityId: "standard",
      failure: { ...safeStandardFailure, maxAttempts: 100, delayMs: 0 },
      attempt: 1,
    })).toEqual({ action: "recovery_required" });
  });
});
