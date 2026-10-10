import type { CapabilityId } from "@/lib/ai/capability-registry";

/** Synchronous bounded-worker allowlist; Replicate image generation awaits a remote prediction and is deferred to durable submit/poll support. Standalone routes are unaffected. */
export const AUTONOMOUS_CAPABILITY_ALLOWLIST = Object.freeze([
  "standard",
  "file_analysis",
  "document_generation",
] as const satisfies readonly CapabilityId[]);

const ALLOWED = new Set<string>(AUTONOMOUS_CAPABILITY_ALLOWLIST);

export function isAutonomousCapabilityAllowed(capabilityId: string): capabilityId is typeof AUTONOMOUS_CAPABILITY_ALLOWLIST[number] {
  return ALLOWED.has(capabilityId);
}
