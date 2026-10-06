import type { CapabilityId, CapabilityOutputKind } from "@/lib/ai/capability-registry";

export type PlanStatus = "draft" | "validated" | "invalid";

export type PlanInputRef =
  | { source: "user" }
  | { source: "attachment"; output?: "text" | "image" | "file" | "structured_data" }
  | { source: "step"; stepId: string; output?: CapabilityOutputKind };

export type PlanStep = {
  id: string;
  capability: CapabilityId;
  dependsOn: string[];
  inputs?: PlanInputRef[];
  expectedOutput?: CapabilityOutputKind;
};

export type IntelligencePlan = {
  objective: string;
  steps: PlanStep[];
  status: PlanStatus;
};
