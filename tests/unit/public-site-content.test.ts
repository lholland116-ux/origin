import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPROVED_POSITIONING,
  features,
  navItems,
} from "@/lib/landing-content";
import { FAQ_ITEMS } from "@/components/help/faq-data";
import { BRAND } from "@/lib/branding";

const read = (path: string) => readFileSync(path, "utf8");
const heroSource = read("components/landing/Hero.tsx");
const featureGridSource = read("components/landing/FeatureGrid.tsx");
const workflowAutomationSource = read("app/workflow-automation/page.tsx");
const workflowPreviewSource = read("app/workflow-preview/page.tsx");
const pricingSource = read("app/pricing/page.tsx");
const aboutSource = read("app/about/page.tsx");
const faqSource = read("components/help/faq-data.ts");
const headerSource = read("components/landing/Header.tsx");

describe("public product-site refresh", () => {
  it("keeps the approved positioning and current general-purpose capabilities visible", () => {
    expect(APPROVED_POSITIONING).toContain(
      "AI Workflow Automation for Manufacturing Quality—and Beyond."
    );
    expect(workflowAutomationSource).toContain(
      "AI Workflow Automation for Manufacturing Quality—and Beyond."
    );
    expect(heroSource).toMatch(/AI workflow automation for manufacturing quality—and beyond/i);
    expect(featureGridSource).toContain("General-purpose LVTChat - Available Now");
    expect(featureGridSource).toContain("Practical AI capabilities for work, research, and everyday tasks");

    for (const feature of features) {
      expect(feature.description).toBeTruthy();
    }

    expect(features.find((feature) => feature.title.startsWith("Smart Conversations"))?.description)
      .toContain("general-purpose AI");
    expect(features.find((feature) => feature.title.startsWith("Web Search"))?.description)
      .toContain("available");
    expect(features.find((feature) => feature.title.startsWith("Documents"))?.description)
      .toContain("TXT, MD, CSV, PDF, DOCX, and XLSX");
    expect(features.find((feature) => feature.title.startsWith("Images"))?.description)
      .toContain("Generate, Regenerate, and Edit share one operation allowance");
    expect(features.find((feature) => feature.title.startsWith("Voice"))?.description)
      .toContain("Voice Input and Read Aloud");
  });

  it("uses the current public navigation and marks workflow previews as developing", () => {
    expect(navItems).toEqual([
      "Product",
      "Workflow Automation",
      "Workflow Preview",
      "Pricing",
      "FAQ / Resources",
      "About",
    ]);
    expect(headerSource).toContain('Product: "/#capabilities"');
    expect(featureGridSource).toContain('id="capabilities"');
    expect(headerSource).toContain('"Workflow Automation": "/workflow-automation"');
    expect(headerSource).toContain('"Workflow Preview": "/workflow-preview"');
    expect(headerSource).toContain("Pricing: BRAND.routes.pricing");
    expect(headerSource).toContain('"FAQ / Resources": BRAND.routes.help');
    expect(headerSource).toContain("About: BRAND.routes.about");
    expect(BRAND.routes.pricing).toBe("/pricing");
    expect(BRAND.routes.help).toBe("/help");
    expect(BRAND.routes.about).toBe("/about");

    expect(workflowAutomationSource).toContain("Workflow Automation · Early Access");
    expect(workflowAutomationSource).toContain("In development");
    expect(workflowAutomationSource).toContain("CAPA-related workflow concepts");
    expect(workflowAutomationSource).toContain("customer-facing execution is still in development");
    expect(workflowPreviewSource).toContain("Illustrative CAPA Workflow Preview");
    expect(workflowPreviewSource).toContain("fictional six-stage example");
    expect(features.some((feature) => feature.title.startsWith("Mobile"))).toBe(true);
  });

  it("presents the approved pricing and shared image-operation limits", () => {
    expect(BRAND.pricing.freePlanName).toBe("Free");
    expect(BRAND.pricing.proPlanName).toBe("Pro Early Adopter");
    expect(BRAND.pricing.proMonthlyPrice).toBe(5.99);
    expect(BRAND.pricing.standardProMonthlyPrice).toBe(15);
    expect(pricingSource).toContain("{BRAND.pricing.freePlanName}");
    expect(pricingSource).toContain("{BRAND.pricing.proPlanName}");
    expect(pricingSource).toContain("$0");
    expect(pricingSource).toContain("Limited-time offer");
    expect(pricingSource).toContain("3 shared image operations/day");
    expect(pricingSource).toContain("21 shared image operations/month");
    expect(pricingSource).toContain("20 shared image operations/day");
    expect(pricingSource).toContain("200 shared image operations/month");
    expect(pricingSource).toContain(
      "Generate, Regenerate, and Edit share the same image-operation allowance."
    );
    expect(pricingSource).not.toMatch(/for life|lifetime|permanently locked/i);
  });

  it("keeps About and Help aligned with current founder and workflow information", () => {
    expect(aboutSource).toContain("Founder Levi Holland");
    expect(aboutSource).toContain("more than 25 years of regulated-industry experience");
    expect(aboutSource).toContain("25+ years in regulated industries");
    expect(aboutSource).not.toMatch(/\b(?:2,500|4,000)\s*\+/);
    expect(aboutSource).toContain("purpose-built workflow automation in development");

    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(15);
    expect(faqSource).not.toMatch(/document uploads? (are )?coming/i);
    expect(faqSource).toContain("Voice Input");
    expect(faqSource).toContain("Read Aloud");
    expect(faqSource).toContain("Full conversational Voice Mode");
    expect(FAQ_ITEMS.find((item) => item.question === "What is the CAPA AI Agent?")?.answer)
      .toMatch(/CAPA AI Agent.*In Development/);
    expect(FAQ_ITEMS.some((item) => item.question === "What is available today, and what is still in development?"))
      .toBe(true);
  });
});
