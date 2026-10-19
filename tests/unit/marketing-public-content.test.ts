import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "../../lib/branding";
import { FAQ_ITEMS } from "../../components/help/faq-data";
import { CAPA_WORKFLOW_PREVIEW_STAGES, WORKFLOW_PREVIEW_NOTICE } from "../../lib/marketing/workflow-preview";

describe("marketing public content and workflow preview", () => {
  it("preserves the six illustrative human-governed stages and explicit development notice", () => {
    expect(WORKFLOW_PREVIEW_NOTICE).toBe("Illustrative Workflow Preview — Customer-facing execution is in development.");
    expect(CAPA_WORKFLOW_PREVIEW_STAGES.map((stage) => stage.title)).toEqual([
      "Quality Signal", "Intelligence Report", "Human Review", "CAPA Draft", "Investigation", "Action Planning",
    ]);
    expect(CAPA_WORKFLOW_PREVIEW_STAGES.every((stage) => stage.summary.length > 0 && stage.output.length > 0)).toBe(true);
    expect(CAPA_WORKFLOW_PREVIEW_STAGES[0]?.output).toContain("simulated");
    expect(CAPA_WORKFLOW_PREVIEW_STAGES[2]?.output).toContain("human");
    expect(CAPA_WORKFLOW_PREVIEW_STAGES[3]?.output).toContain("Draft only");
    expect(CAPA_WORKFLOW_PREVIEW_STAGES[4]?.output).toContain("No cause is concluded");
    const source = readFileSync("app/workflow-preview/WorkflowPreview.tsx", "utf8");
    expect(source).not.toMatch(/fetch\s*\(|\/api\//);
  });

  it("distinguishes current product from developing workflow features in FAQ copy", () => {
    expect(FAQ_ITEMS.some((item) => item.question.includes("available today") && item.answer.includes("in development"))).toBe(true);
    expect(FAQ_ITEMS.some((item) => item.category === "Privacy" && item.question.includes("analytics"))).toBe(true);
    expect(FAQ_ITEMS.some((item) => item.question.includes("specific integrations") && item.answer.includes("not been promised"))).toBe(true);
  });

  it("keeps existing subscription prices and does not publish proposed workflow price points", () => {
    expect(BRAND.pricing.freePlanName).toBe("Free");
    expect(BRAND.pricing.proMonthlyPrice).toBe(5.99);
    const pricingPage = readFileSync("app/pricing/page.tsx", "utf8");
    expect(pricingPage).toContain("Workflow Automation — Early Access");
    expect(pricingPage).not.toMatch(/\$99|\$299/);
  });

  it("captures bounded campaign attribution locally and removes it from URLs before analytics", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const scrubber = layout.indexOf('id="sanitize-marketing-attribution"');
    const analyticsLoader = layout.indexOf("googletagmanager.com/gtag/js");
    expect(scrubber).toBeGreaterThanOrEqual(0);
    expect(analyticsLoader).toBeGreaterThan(scrubber);
    expect(layout).toContain("window.sessionStorage.setItem(storageKey");
    expect(layout).toContain("key.toLowerCase().startsWith('utm_')");
    expect(layout).toContain("window.history.replaceState");
    expect(readFileSync("app/request/LeadForm.tsx", "utf8")).toContain("utm_source: safeUtm(attribution.utmSource)");
  });
});
