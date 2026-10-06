import type { IntelligenceRoute } from "@/lib/ai/intelligence-router";

export type CapabilityId = IntelligenceRoute;

export type CapabilityInputKind =
  | "text"
  | "search_results"
  | "image"
  | "file"
  | "structured_data";

export type CapabilityOutputKind =
  | "text"
  | "search_results"
  | "image"
  | "structured_data"
  | "artifact"
  | "document";

export type CapabilityDefinition = {
  id: CapabilityId;
  description: string;
  acceptedInputs: readonly CapabilityInputKind[];
  producedOutputs: readonly CapabilityOutputKind[];
  supportsAttachments: boolean;
  requiresAttachment: boolean;
  createsArtifact: boolean;
  supportsPlanning: boolean;
};

export type CapabilityRegistry = {
  all(): readonly CapabilityDefinition[];
  get(id: string): CapabilityDefinition | undefined;
  has(id: string): id is CapabilityId;
};

export function createCapabilityRegistry(
  definitions: readonly CapabilityDefinition[],
): CapabilityRegistry {
  const byId = new Map<CapabilityId, CapabilityDefinition>();

  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(`Duplicate capability id: ${definition.id}`);
    }
    byId.set(definition.id, Object.freeze({
      ...definition,
      acceptedInputs: Object.freeze([...definition.acceptedInputs]),
      producedOutputs: Object.freeze([...definition.producedOutputs]),
    }));
  }

  const all = Object.freeze([...byId.values()]);
  return Object.freeze({
    all: () => all,
    get: (id: string) => byId.get(id as CapabilityId),
    has: (id: string): id is CapabilityId => byId.has(id as CapabilityId),
  });
}

const definitions = [
  {
    id: "standard",
    description: "General conversational response.",
    acceptedInputs: ["text", "search_results", "image", "file", "structured_data"],
    producedOutputs: ["text"],
    supportsAttachments: true,
    requiresAttachment: false,
    createsArtifact: false,
    supportsPlanning: true,
  },
  {
    id: "web_search",
    description: "Retrieve current information from the web.",
    acceptedInputs: ["text"],
    producedOutputs: ["search_results"],
    supportsAttachments: false,
    requiresAttachment: false,
    createsArtifact: false,
    supportsPlanning: true,
  },
  {
    id: "image_generation",
    description: "Generate an image from a text prompt.",
    acceptedInputs: ["text"],
    producedOutputs: ["image"],
    supportsAttachments: false,
    requiresAttachment: false,
    createsArtifact: true,
    supportsPlanning: true,
  },
  {
    id: "image_editing",
    description: "Edit an existing image using a text instruction.",
    acceptedInputs: ["image", "text"],
    producedOutputs: ["image"],
    supportsAttachments: true,
    requiresAttachment: true,
    createsArtifact: true,
    supportsPlanning: true,
  },
  {
    id: "file_analysis",
    description: "Analyze an attached file or image.",
    acceptedInputs: ["file", "image", "text"],
    producedOutputs: ["text", "structured_data"],
    supportsAttachments: true,
    requiresAttachment: true,
    createsArtifact: false,
    supportsPlanning: true,
  },
  {
    id: "document_generation",
    description: "Generate a downloadable document or artifact.",
    acceptedInputs: ["text", "structured_data", "search_results", "file"],
    producedOutputs: ["document", "artifact"],
    supportsAttachments: true,
    requiresAttachment: false,
    createsArtifact: true,
    supportsPlanning: true,
  },
] as const satisfies readonly CapabilityDefinition[];

export const CAPABILITY_REGISTRY = createCapabilityRegistry(definitions);
export const CAPABILITIES = CAPABILITY_REGISTRY.all();
