import { describe, expect, it } from "vitest";
import { calculateComposerTextareaSize } from "@/app/chat/ChatClient";

describe("composer textarea auto-resize", () => {
  it("expands for multiline input and resets after the input is cleared", () => {
    const expanded = calculateComposerTextareaSize("first line\nsecond line", 112);

    expect(expanded.height).toBeGreaterThan(52);
    expect(expanded.height).toBeLessThanOrEqual(180);
    expect(expanded.overflowY).toBe("hidden");

    const cleared = calculateComposerTextareaSize("", expanded.height);

    expect(cleared).toEqual({ height: 52, overflowY: "hidden" });
  });

  it("caps long input and enables scrolling only at the maximum", () => {
    expect(calculateComposerTextareaSize("many lines", 240)).toEqual({
      height: 180,
      overflowY: "auto",
    });
  });
});
