import { describe, expect, it } from "vitest";
import {
  hasImageEditIntent,
  hasImageGenerationIntent,
  selectIntelligenceRoute,
} from "@/lib/ai/intelligence-router";

const autoRoute = (prompt: string, hasImageContext = false) =>
  selectIntelligenceRoute({
    mode: "auto",
    prompt,
    hasImageContext,
  });

describe("Intelligence Router core", () => {
  it("routes ordinary prompts to Standard by default", () => {
    expect(autoRoute("Explain how photosynthesis works.")).toEqual({
      route: "standard",
      reason: "default_standard",
    });
  });

  it("routes a current-information signal to Web Search", () => {
    expect(
      selectIntelligenceRoute({
        mode: "auto",
        prompt: "What is the latest release?",
        hasImageContext: false,
        autoWebSearchNeeded: true,
      }),
    ).toEqual({ route: "web_search", reason: "auto_web_search_required" });
  });

  it("preserves explicit Standard and Web Search overrides", () => {
    expect(
      selectIntelligenceRoute({
        mode: "standard",
        prompt: "What is the latest release?",
        hasImageContext: true,
        autoWebSearchNeeded: true,
      }).route,
    ).toBe("standard");
    expect(
      selectIntelligenceRoute({
        mode: "web_search",
        prompt: "Create an image of a fox",
        hasImageContext: true,
      }).route,
    ).toBe("web_search");
  });

  it("safely falls back to Standard for ambiguous or missing edit context", () => {
    expect(autoRoute("Maybe change it, if that makes sense.").route).toBe("standard");
    expect(autoRoute("Remove the background from this image.").route).toBe("standard");
    expect(hasImageEditIntent("Remove the background from this image.")).toBe(true);
  });

  it.each([
    "Create an image of a futuristic cleanroom.",
    "Generate a picture of a golden retriever.",
    "Draw a diagram of a manufacturing line.",
    "Make an illustration of a medical device.",
    "Render a photorealistic sports car.",
    "Design a poster showing a night sky.",
    "Create a product mockup of a chair.",
    "Make me a logo showing a mountain.",
  ])("detects clear visual creation: %s", (prompt) => {
    expect(hasImageGenerationIntent(prompt)).toBe(true);
    expect(autoRoute(prompt).route).toBe("image_generation");
  });

  it.each([
    "What is image generation?",
    "Explain how FLUX works.",
    "Why does this image format matter?",
    "Tell me about image editing.",
  ])("does not mistake discussion for image generation: %s", (prompt) => {
    expect(hasImageGenerationIntent(prompt)).toBe(false);
    expect(autoRoute(prompt).route).toBe("standard");
  });

  it.each([
    "Remove the background from this image.",
    "Make this image brighter.",
    "Change the walls to blue.",
    "Add safety glasses to the person in this image.",
    "Crop this photo.",
    "Edit this image to look like a watercolor.",
  ])("routes image edit intent with image context: %s", (prompt) => {
    expect(autoRoute(prompt, true).route).toBe("image_editing");
  });

  it.each([
    "Summarize this image.",
    "What is shown in this screenshot?",
    "Read the text in this image.",
    "Explain this chart.",
  ])("does not route image analysis to editing: %s", (prompt) => {
    expect(autoRoute(prompt, true).route).not.toBe("image_editing");
  });

  it("does not consume visual requests when other composer attachments are present", () => {
    expect(
      selectIntelligenceRoute({
        mode: "auto",
        prompt: "Make this image brighter.",
        hasImageContext: true,
        hasOtherAttachments: true,
      }).route,
    ).toBe("standard");
    expect(
      selectIntelligenceRoute({
        mode: "auto",
        prompt: "Create an image of a fox.",
        hasImageContext: false,
        hasOtherAttachments: true,
      }).route,
    ).toBe("standard");
  });

  it("preserves explicit Create Image and allows Auto to delegate to its existing classifier", () => {
    expect(
      selectIntelligenceRoute({
        mode: "create_image",
        prompt: "A calm lake at sunrise",
        hasImageContext: false,
      }).route,
    ).toBe("image_generation");
    expect(
      selectIntelligenceRoute({
        mode: "auto",
        prompt: "Explain photosynthesis.",
        hasImageContext: false,
        deferAutoWebSearch: true,
      }),
    ).toEqual({ route: "web_search", reason: "existing_auto_web_classifier" });
  });
});
