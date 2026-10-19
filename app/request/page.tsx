import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import LeadForm from "./LeadForm";
import { isMarketingLeadSource } from "@/lib/marketing/lead-contract";
import type { MarketingLeadInterest, MarketingLeadSource } from "@/lib/marketing/lead-analytics";

export const metadata: Metadata = {
  title: "Request Early Access or a Demo",
  description: "Tell LVTChat about a business workflow you would like to discuss. Request early access or a demonstration conversation.",
  alternates: { canonical: "/request" },
};

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RequestPage({ searchParams }: { readonly searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const interest: MarketingLeadInterest = first(params.interest) === "demo" ? "demo" : "early_access";
  const requestedSource = first(params.source);
  const source: MarketingLeadSource = isMarketingLeadSource(requestedSource) ? requestedSource : "other";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <Header />
      <section className="px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="lg:sticky lg:top-8">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-blue-800">LVTChat · Business workflows</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Let’s discuss your workflow.</h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">Share the work your team wants to move forward. Request early access or a demo discussion; workflow automation is in development.</p>
            <div className="mt-7 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-950">What to expect</h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <li>• A human follow-up about the problem you describe.</li>
                <li>• No commitment to use developing workflow capabilities.</li>
                <li>• Do not submit confidential manufacturing or customer records through this form.</li>
              </ul>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold">Request Early Access or a Demo</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Tell us who you are and what process you would like to discuss.</p>
            <div className="mt-6">
              <LeadForm
                initialInterest={interest}
                source={source}
                turnstileSiteKey={process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY}
                utmSource={first(params.utm_source)}
                utmMedium={first(params.utm_medium)}
                utmCampaign={first(params.utm_campaign)}
              />
            </div>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-[1440px] px-4 pb-5 sm:px-6 lg:px-8"><Footer /></div>
    </main>
  );
}
