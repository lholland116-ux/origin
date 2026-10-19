import { afterEach, describe, expect, it, vi } from "vitest";
import { trackMarketingLeadEvent } from "../../lib/marketing/lead-analytics";

afterEach(() => vi.unstubAllGlobals());

describe("marketing lead analytics", () => {
  it("emits only categorical source and interest for form views and submissions", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });

    trackMarketingLeadEvent("lead_form_view", "early_access", "workflow_preview");
    trackMarketingLeadEvent("lead_form_submit", "demo", "about");

    expect(gtag).toHaveBeenNthCalledWith(1, "event", "lead_form_view", {
      event_category: "marketing_lead",
      interest_type: "early_access",
      source: "workflow_preview",
    });
    expect(gtag).toHaveBeenNthCalledWith(2, "event", "lead_form_submit", {
      event_category: "marketing_lead",
      interest_type: "demo",
      source: "about",
    });
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/name|email|company|problem|utm|person/i);
  });

  it("does not require or invoke a browser analytics client during server rendering", () => {
    expect(() => trackMarketingLeadEvent("lead_form_view", "demo", "direct")).not.toThrow();
  });
});
