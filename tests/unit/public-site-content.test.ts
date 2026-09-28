import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPROVED_POSITIONING,
  features,
  futurePlatformCapabilities,
  navItems,
  purposeBuiltAgents,
} from "@/lib/landing-content";
import { FAQ_ITEMS } from "@/components/help/faq-data";

const read = (path: string) => readFileSync(path, "utf8");
const heroSource = read("components/landing/Hero.tsx");
const roadmapSource = read("components/landing/AgentRoadmap.tsx");
const pricingSource = read("app/pricing/page.tsx");
const brandingSource = read("lib/branding.ts");
const aboutSource = read("app/about/page.tsx");
const faqSource = read("components/help/faq-data.ts");
const headerSource = read("components/landing/Header.tsx");

describe("public product-site refresh", () => {
  it("keeps the approved positioning and current general-purpose capabilities visible", () => {
    expect(heroSource).toContain(APPROVED_POSITIONING);

    for (const feature of features) {
      expect(feature.description).toBeTruthy();
    }

    expect(features.find((feature) => feature.title.startsWith("Documents"))?.description)
      .toContain("TXT, MD, CSV, PDF, DOCX, and XLSX");
    expect(features.find((feature) => feature.title.startsWith("Images"))?.description)
      .toContain("Generate, Regenerate, and Edit share one operation allowance");
  });

  it("uses the approved public navigation and exposes the AI Agent roadmap", () => {
    expect(navItems).toEqual([
      "Product",
      "AI Agents",
      "Pricing",
      "Help",
      "About",
    ]);
    expect(headerSource).toContain('"AI Agents": "#ai-agents"');
    expect(roadmapSource).toContain("Purpose-Built AI Agents");
    expect(roadmapSource).toContain("{APPROVED_POSITIONING}");
    expect(roadmapSource).toContain(
      "CAPA AI Agent - Workflow  In Development"
    );

    for (const agent of purposeBuiltAgents) {
      expect(agent.name).toMatch(/AI Agent - Workflow  (Coming Soon|In Development)/);
    }

    for (const capability of futurePlatformCapabilities) {
      expect(capability).toBeTruthy();
    }

    expect(futurePlatformCapabilities).toContain("Cross-Chat Memory");
    expect(features.some((feature) => feature.title.startsWith("Mobile"))).toBe(true);
    expect(roadmapSource).not.toContain("Resume");
  });

  it("presents the approved pricing and shared image-operation limits", () => {
    expect(pricingSource).toContain("Limited-time offer");
    expect(pricingSource).toContain("3 shared image operations/day");
    expect(pricingSource).toContain("21 shared image operations/month");
    expect(pricingSource).toContain("20 shared image operations/day");
    expect(pricingSource).toContain("200 shared image operations/month");
    expect(pricingSource).toContain(
      "Generate, Regenerate, and Edit share the same image-operation allowance."
    );
    expect(pricingSource).not.toMatch(/for life|lifetime|permanently locked/i);
    expect(brandingSource).not.toContain("Custom AI Agents");
  });

  it("keeps About and Help aligned with the current product and roadmap", () => {
    expect(aboutSource).toContain("4,000+");
    expect(aboutSource).not.toContain("2,500");
    expect(aboutSource).toContain(APPROVED_POSITIONING);
    expect(aboutSource).toContain(
      "CAPA AI Agent - Workflow  In Development"
    );

    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(15);
    expect(faqSource).not.toMatch(/document uploads? (are )?coming/i);
    expect(faqSource).toContain("Voice Input");
    expect(faqSource).toContain("Read Aloud");
    expect(faqSource).toContain("Full conversational Voice Mode");
    expect(faqSource).toContain("Research AI Agent - Workflow  Coming Soon");
  });
});
