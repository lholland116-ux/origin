import type { CapabilityId } from "@/lib/ai/capability-registry";
import type { CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";

/** Execution dispatch allowlist. Kept separate from planning capability metadata. */
export const EXECUTION_CAPABILITY_IDS = Object.freeze([
  "standard",
  "web_search",
  "file_analysis",
  "document_generation",
  "image_generation",
  "image_editing",
] as const satisfies readonly CapabilityId[]);

export type ExecutionRegistryExecutors = Readonly<{
  standardExecutor: CapabilityExecutor;
  webSearchExecutor: CapabilityExecutor;
  fileAnalysisExecutor: CapabilityExecutor;
  documentGenerationExecutor: CapabilityExecutor;
  imageGenerationExecutor: CapabilityExecutor;
  imageEditingExecutor: CapabilityExecutor;
}>;

export interface ExecutionRegistry {
  all(): readonly CapabilityId[];
  get(capabilityId: string): CapabilityExecutor | undefined;
  has(capabilityId: string): capabilityId is CapabilityId;
}

function isExecutor(value: unknown): value is CapabilityExecutor {
  return value !== null && typeof value === "object"
    && typeof (value as { execute?: unknown }).execute === "function";
}

type ExactExecutorDependencies<TExecutors extends ExecutionRegistryExecutors> = TExecutors
  & Record<Exclude<keyof TExecutors, keyof ExecutionRegistryExecutors>, never>;

export function createExecutionRegistry<const TExecutors extends ExecutionRegistryExecutors>(
  executors: ExactExecutorDependencies<TExecutors>,
): ExecutionRegistry {
  if (executors === null || typeof executors !== "object") {
    throw new TypeError("Execution registry requires all six approved executors.");
  }

  if (!isExecutor(executors.standardExecutor)
    || !isExecutor(executors.webSearchExecutor)
    || !isExecutor(executors.fileAnalysisExecutor)
    || !isExecutor(executors.documentGenerationExecutor)
    || !isExecutor(executors.imageGenerationExecutor)
    || !isExecutor(executors.imageEditingExecutor)) {
    throw new TypeError("Every approved execution capability requires an executor.");
  }
  const injectedExecutors = [
    executors.standardExecutor,
    executors.webSearchExecutor,
    executors.fileAnalysisExecutor,
    executors.documentGenerationExecutor,
    executors.imageGenerationExecutor,
    executors.imageEditingExecutor,
  ];
  if (new Set(injectedExecutors).size !== injectedExecutors.length) {
    throw new TypeError("Each approved execution capability requires its own executor.");
  }

  const entries: Readonly<Record<CapabilityId, CapabilityExecutor>> = Object.freeze({
    standard: executors.standardExecutor,
    web_search: executors.webSearchExecutor,
    file_analysis: executors.fileAnalysisExecutor,
    document_generation: executors.documentGenerationExecutor,
    image_generation: executors.imageGenerationExecutor,
    image_editing: executors.imageEditingExecutor,
  });

  const get = (capabilityId: string): CapabilityExecutor | undefined => {
    switch (capabilityId) {
      case "standard": return entries.standard;
      case "web_search": return entries.web_search;
      case "file_analysis": return entries.file_analysis;
      case "document_generation": return entries.document_generation;
      case "image_generation": return entries.image_generation;
      case "image_editing": return entries.image_editing;
      default: return undefined;
    }
  };

  return Object.freeze({
    all: () => EXECUTION_CAPABILITY_IDS,
    get,
    has: (capabilityId: string): capabilityId is CapabilityId => get(capabilityId) !== undefined,
  });
}
