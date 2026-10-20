import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND } from "../../lib/branding";
import { FAQ_ITEMS } from "../../components/help/faq-data";
import { CAPA_WORKFLOW_PREVIEW_STAGES, WORKFLOW_PREVIEW_NOTICE } from "../../lib/marketing/workflow-preview";
import { getDocumentLimits } from "../../lib/documents/config";

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((channel) => parseInt(channel, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((channel) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return linear;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

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

  it("keeps public pages on the shared light-page and navy-footer design system", () => {
    const routes = [
      "app/pricing/page.tsx",
      "app/blog/page.tsx",
      "app/blog/watch-the-official-lvtchat-demo/page.tsx",
      "app/blog/lvtchat-now-available-on-google-play/page.tsx",
      "app/help/page.tsx",
      "app/about/page.tsx",
      "app/workflow-automation/page.tsx",
      "app/workflow-preview/page.tsx",
      "app/request/page.tsx",
    ];
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source, route).toContain("<Header");
      expect(source, route).toContain('<Footer variant="dark" />');
      expect(source, route).not.toContain("bg-[#020817]");
    }

    const faqRenderer = readFileSync("components/help/FaqAccordion.tsx", "utf8");
    expect(faqRenderer).not.toContain("dark:");
    expect(faqRenderer).toContain("focus-visible:ring-2");

    const homepageHero = readFileSync("components/landing/Hero.tsx", "utf8");
    expect(homepageHero).toContain("via-white/75");
    expect(homepageHero).toContain("text-slate-700");

    const white = "#ffffff";
    expect(contrastRatio("#334155", white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#475569", white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(white, "#1d4ed8")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(white, "#065f46")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps pricing and launch copy aligned with current Free and Pro entitlements", () => {
    const pricing = readFileSync("app/pricing/page.tsx", "utf8");
    const launchArticle = readFileSync("app/blog/lvtchat-now-available-on-google-play/page.tsx", "utf8");
    const helpPage = readFileSync("app/help/page.tsx", "utf8");
    const demoArticle = readFileSync("app/blog/watch-the-official-lvtchat-demo/page.tsx", "utf8");

    expect(getDocumentLimits("free")).toEqual({ maxFilesPerMessage: 1, maxFileSizeBytes: 5 * 1024 * 1024 });
    expect(getDocumentLimits("pro")).toEqual({ maxFilesPerMessage: 3, maxFileSizeBytes: 10 * 1024 * 1024 });
    expect(pricing).toContain("Web Search and document analysis are available on both plans.");
    expect(pricing).toMatch(/Free\s+includes one supported document up to 5 MB/);
    expect(pricing).toMatch(/Pro raises that to three documents up to 10 MB each/);
    expect(launchArticle).not.toContain("Document Upload and Analysis (Pro)");
    expect(launchArticle).toMatch(/Document Upload and Analysis\s*<\/h3>/);
    expect(launchArticle).toMatch(/Free supports one\s+document up to 5 MB per Standard message/);
    expect(launchArticle).toMatch(/Pro supports up to\s+three documents up to 10 MB each/);
    expect(helpPage).not.toContain("Try LVTChat Free");

    expect(demoArticle).toContain("https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}");
    expect(demoArticle).toContain("https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}");
    expect(demoArticle).toContain("Open the official demonstration");
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
