export type MarketingLeadEvent = "lead_form_view" | "lead_form_submit";
export type MarketingLeadInterest = "early_access" | "demo";
export type MarketingLeadSource =
  | "homepage"
  | "workflow_automation"
  | "workflow_preview"
  | "pricing"
  | "about"
  | "faq"
  | "direct"
  | "other";

/** Sends categorical conversion metadata only; never includes form values or UTMs. */
export function trackMarketingLeadEvent(
  eventName: MarketingLeadEvent,
  interest: MarketingLeadInterest,
  source: MarketingLeadSource,
): void {
  if (typeof window === "undefined") return;
  const analyticsWindow = window as Window & { gtag?: (...args: unknown[]) => void };
  analyticsWindow.gtag?.("event", eventName, {
    event_category: "marketing_lead",
    interest_type: interest,
    source,
  });
}
