import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_REGISTRY,
  createCapabilityRegistry,
  type CapabilityDefinition,
} from "@/lib/ai/capability-registry";
import type { IntelligenceRoute } from "@/lib/ai/intelligence-router";

const IDS: IntelligenceRoute[] = [
  "standard",
  "web_search",
  "image_generation",
  "image_editing",
  "file_analysis",
  "document_generation",
];

describe("capability registry", () => {
  it("registers exactly the six existing production IntelligenceRoutes", () => {
    expect(CAPABILITIES.map(({ id }) => id)).toEqual(IDS);
    expect(CAPABILITIES.map(({ id }) => id satisfies IntelligenceRoute)).toEqual(IDS);
  });

  it("looks up known capabilities and safely rejects unknown IDs", () => {
    expect(CAPABILITY_REGISTRY.get("web_search")?.producedOutputs).toContain("search_results");
    expect(CAPABILITY_REGISTRY.get("not_a_capability")).toBeUndefined();
    expect(CAPABILITY_REGISTRY.has("document_generation")).toBe(true);
    expect(CAPABILITY_REGISTRY.has("not_a_capability")).toBe(false);
  });

  it("throws rather than silently overwriting duplicate capability IDs", () => {
    const definition = CAPABILITIES[0] as CapabilityDefinition;
    expect(() => createCapabilityRegistry([definition, definition])).toThrow(/Duplicate capability id/);
  });

  it("keeps capability metadata complete and internally coherent", () => {
    for (const capability of CAPABILITIES) {
      expect(capability.description.trim()).not.toBe("");
      expect(capability.acceptedInputs.length).toBeGreaterThan(0);
      expect(capability.producedOutputs.length).toBeGreaterThan(0);
      if (capability.requiresAttachment) expect(capability.supportsAttachments).toBe(true);
      if (capability.createsArtifact) {
        expect(capability.producedOutputs.some((kind) => ["image", "artifact", "document"].includes(kind))).toBe(true);
      }
      expect(capability.supportsPlanning).toBe(true);
    }

    expect(CAPABILITY_REGISTRY.get("file_analysis")?.requiresAttachment).toBe(true);
  });
});
