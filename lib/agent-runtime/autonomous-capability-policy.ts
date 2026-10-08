import type { CapabilityId } from "@/lib/ai/capability-registry";

/** Dormant Agent Runtime V1 allowlist; standalone product routes use separate services. */
export const AUTONOMOUS_CAPABILITY_ALLOWLIST = Object.freeze([
  "standard",
  "file_analysis",
  "document_generation",
  "image_generation",
] as const satisfies readonly CapabilityId[]);

const ALLOWED = new Set<string>(AUTONOMOUS_CAPABILITY_ALLOWLIST);

export function isAutonomousCapabilityAllowed(capabilityId: string): capabilityId is typeof AUTONOMOUS_CAPABILITY_ALLOWLIST[number] {
  return ALLOWED.has(capabilityId);
}
