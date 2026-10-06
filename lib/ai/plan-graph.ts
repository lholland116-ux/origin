import { alg, Graph } from "@dagrejs/graphlib";
import type { PlanStep } from "@/lib/ai/intelligence-plan";

export type PlanGraphResult =
  | { ok: true; orderedStepIds: string[] }
  | { ok: false; reason: "missing_dependency" | "self_dependency" | "cycle" };

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Graphlib stays behind this adapter; callers receive plan IDs, not Graph objects. */
export function orderPlanSteps(steps: readonly PlanStep[]): PlanGraphResult {
  const graph = new Graph({ directed: true });
  const ids = steps.map((step) => step.id).sort(compareIds);
  const knownIds = new Set(ids);

  for (const id of ids) graph.setNode(id);

  for (const step of [...steps].sort((left, right) => compareIds(left.id, right.id))) {
    for (const dependencyId of [...step.dependsOn].sort(compareIds)) {
      if (!knownIds.has(dependencyId)) return { ok: false, reason: "missing_dependency" };
      if (dependencyId === step.id) return { ok: false, reason: "self_dependency" };
      graph.setEdge(dependencyId, step.id);
    }
  }

  if (!alg.isAcyclic(graph)) return { ok: false, reason: "cycle" };

  // Stable node/edge insertion makes Graphlib's topological result deterministic
  // for a given plan while preserving its dependency constraints.
  return { ok: true, orderedStepIds: alg.topsort(graph) };
}
