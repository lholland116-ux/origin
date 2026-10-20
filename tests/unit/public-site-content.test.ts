import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPROVED_POSITIONING,
  features,
  footerColumns,
  navItems,
} from "@/lib/landing-content";
import { FAQ_ITEMS } from "@/components/help/faq-data";
import { BRAND } from "@/lib/branding";
import { CAPA_WORKFLOW_PREVIEW_STAGES } from "@/lib/marketing/workflow-preview";

const read = (path: string) => readFileSync(path, "utf8");
const heroSource = read("components/landing/Hero.tsx");
const featureGridSource = read("components/landing/FeatureGrid.tsx");
const workflowAutomationSource = read("app/workflow-automation/page.tsx");
const workflowPreviewSource = read("app/workflow-preview/page.tsx");
const pricingSource = read("app/pricing/page.tsx");
const aboutSource = read("app/about/page.tsx");
const faqSource = read("components/help/faq-data.ts");
const headerSource = read("components/landing/Header.tsx");
const landingSource = read("components/landing/LandingPage.tsx");
const homepageFounderLeadSource = read("components/landing/HomepageFounderLead.tsx");
const workflowPreviewClientSource = read("app/workflow-preview/WorkflowPreview.tsx");
const leadFormSource = read("app/request/LeadForm.tsx");
const footerSource = read("components/landing/Footer.tsx");
const privacySource = read("app/privacy/page.tsx");
const termsSource = read("app/terms/page.tsx");

describe("public product-site refresh", () => {
  it("keeps the approved positioning and current general-purpose capabilities visible", () => {
    expect(APPROVED_POSITIONING).toContain(
      "AI Workflow Automation for Manufacturing Quality—and Beyond."
    );
    expect(workflowAutomationSource).toContain(
      "AI Workflow Automation for Manufacturing Quality—and Beyond."
    );
    expect(heroSource).toContain("AI Workflow Automation");
    expect(heroSource).toContain("for Manufacturing Quality—");
    expect(heroSource).toContain("and Beyond.");
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

  it("assembles the homepage in the approved order and reuses secured preview and lead flows", () => {
    const orderedHomepageSections = [
      '<Header variant="homepage" />',
      "<Hero />",
      "<HomepageWorkflowStages />",
      "id=\"capa-preview\"",
      "<HomepageProductPanels />",
      "<HomepageBenefits />",
      "<HomepageFounderLead />",
      '<Footer variant="dark" />',
    ];
    let priorIndex = -1;
    for (const section of orderedHomepageSections) {
      const currentIndex = landingSource.indexOf(section);
      expect(currentIndex, `homepage includes ${section}`).toBeGreaterThan(priorIndex);
      priorIndex = currentIndex;
    }

    expect(heroSource).toContain("/images/marketing/manufacturing-quality-hero.png");
    expect(heroSource).toContain("/request?interest=early_access&source=homepage");
    expect(heroSource).toContain("/workflow-preview");
    expect(heroSource).toContain("BRAND.routes.login");
    expect(headerSource).toContain('"CAPA Preview"');
    expect(headerSource).toContain('"Workflow Preview": "/workflow-preview"');
    expect(CAPA_WORKFLOW_PREVIEW_STAGES).toHaveLength(6);
    expect(workflowPreviewClientSource).toContain("CAPA_WORKFLOW_PREVIEW_STAGES.map");
    expect(workflowPreviewClientSource).toContain("aria-pressed={selected === index}");
    expect(workflowPreviewClientSource).toContain("focus:ring-2");

    expect(homepageFounderLeadSource).toContain("/images/founder/levi-holland-portrait.png");
    expect(homepageFounderLeadSource).toContain("@/app/request/LeadForm");
    expect(homepageFounderLeadSource).toContain('source="homepage"');
    expect(homepageFounderLeadSource).toContain("NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY");
    expect(homepageFounderLeadSource).toContain("compact");
    expect(leadFormSource).toContain('action: "marketing_lead_submit"');
    expect(leadFormSource).toContain('fetch("/api/marketing/leads"');
    expect(footerSource).toContain('variant === "dark"');
  });

  it("keeps legal pages in the public light design without changing legal terms", () => {
    for (const [route, source] of [["privacy", privacySource], ["terms", termsSource]] as const) {
      expect(source, route).toContain("<Header />");
      expect(source, route).toContain('<Footer variant="dark" />');
      expect(source, route).toContain("bg-slate-50 text-slate-950");
      expect(source, route).toContain("text-slate-700");
      expect(source, route).not.toContain("bg-[#020817]");
      expect(source, route).not.toMatch(/\bdark:/);
      expect(source, route).toContain("Effective date:");
    }

    expect(privacySource).toContain("Information We Collect");
    expect(privacySource).toContain("Cloudflare&apos;s Siteverify service");
    expect(privacySource).toContain("Data Retention");
    expect(privacySource).toContain("You may request access, correction, or deletion");
    expect(termsSource).toContain("Limitation of Liability");
    expect(termsSource).toContain("BRAND.legal.jurisdiction");
    expect(termsSource).toContain("address.line1");
  });

  it("shows the Terms-authoritative mailing address in the footer and keeps Contact in one place", () => {
    expect(footerSource).toContain("Business Mailing Address");
    expect(footerSource).toContain("const address = BRAND.contact.address");
    for (const field of ["address.line1", "address.line2", "address.city", "address.state", "address.postalCode", "address.country"]) {
      expect(footerSource).toContain(field);
    }
    expect(footerSource).not.toContain("1101 Hillcrest Pkwy");
    expect(footerSource).toContain('<nav aria-label="Legal">');
    expect(footerSource).toContain("mailto:${BRAND.contact.email}");
    expect(footerColumns.find((column) => column.title === "Resources")?.links).toEqual([
      "FAQ / Resources",
      "Request Early Access",
    ]);
    expect(termsSource).toContain("BRAND.contact.address");
  });
});
