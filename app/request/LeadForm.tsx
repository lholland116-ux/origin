"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MarketingLeadInterest, MarketingLeadSource } from "@/lib/marketing/lead-analytics";
import { trackMarketingLeadEvent } from "@/lib/marketing/lead-analytics";

type LeadFormProps = {
  readonly initialInterest: MarketingLeadInterest;
  readonly source: MarketingLeadSource;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
};

type SubmitResult = { readonly status?: string; readonly error?: string };
type StoredAttribution = {
  readonly utm_source?: unknown;
  readonly utm_medium?: unknown;
  readonly utm_campaign?: unknown;
  readonly savedAt?: unknown;
};

function safeUtm(value: string | undefined): string | undefined {
  if (!value || value.length > 100 || !/^[A-Za-z0-9._~%-]+$/.test(value)) return undefined;
  return value;
}

export default function LeadForm({ initialInterest, source, utmSource, utmMedium, utmCampaign }: LeadFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [interest, setInterest] = useState<MarketingLeadInterest>(initialInterest);
  const [attribution, setAttribution] = useState({ utmSource, utmMedium, utmCampaign });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem("lvtchat:lead-attribution:v1") ?? "null") as StoredAttribution | null;
      const savedAt = typeof stored?.savedAt === "number" ? stored.savedAt : 0;
      const age = Date.now() - savedAt;
      if (stored && age >= 0 && age < 24 * 60 * 60 * 1000) {
        setAttribution((current) => ({
          utmSource: current.utmSource ?? safeUtm(typeof stored.utm_source === "string" ? stored.utm_source : undefined),
          utmMedium: current.utmMedium ?? safeUtm(typeof stored.utm_medium === "string" ? stored.utm_medium : undefined),
          utmCampaign: current.utmCampaign ?? safeUtm(typeof stored.utm_campaign === "string" ? stored.utm_campaign : undefined),
        }));
      } else window.sessionStorage.removeItem("lvtchat:lead-attribution:v1");
    } catch {
      // Session storage is optional; direct request-page attribution still works.
    }
    trackMarketingLeadEvent("lead_form_view", initialInterest, source);
  }, [initialInterest, source]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || submitted) return;
    const form = formRef.current;
    if (!form) return;
    setSubmitting(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const data = new FormData(form);
    const payload = {
      idempotency_key: idempotencyKey.current,
      name: String(data.get("name") ?? ""),
      business_email: String(data.get("business_email") ?? ""),
      company: String(data.get("company") ?? ""),
      role: String(data.get("role") ?? ""),
      workflow_problem: String(data.get("workflow_problem") ?? ""),
      interest_type: interest,
      current_process_tools: String(data.get("current_process_tools") ?? ""),
      marketing_consent: data.get("marketing_consent") === "on",
      source,
      utm_source: safeUtm(attribution.utmSource),
      utm_medium: safeUtm(attribution.utmMedium),
      utm_campaign: safeUtm(attribution.utmCampaign),
      website: String(data.get("website") ?? ""),
    };
    try {
      const response = await fetch("/api/marketing/leads", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json().catch(() => ({})) as SubmitResult;
      if (!response.ok || result.status !== "received") {
        setError(response.status === 429
          ? "Please wait before sending another request."
          : response.status === 409
            ? "This submission could not be confirmed. Please reload the form and try again."
            : "We could not send your request right now. Please try again.");
        return;
      }
      setSubmitted(true);
      try { window.sessionStorage.removeItem("lvtchat:lead-attribution:v1"); } catch { /* optional browser storage */ }
      trackMarketingLeadEvent("lead_form_submit", interest, source);
    } catch {
      setError("We could not confirm your request. You can safely try again; duplicate submissions are handled.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20";
  const labelClass = "block text-sm font-semibold text-slate-800";

  if (submitted) return (
    <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
      <h2 className="text-xl font-bold">Thanks for reaching out.</h2>
      <p className="mt-2 text-sm leading-6">Your request was received. LVTChat will use the information you provided to follow up about your interest.</p>
    </div>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={labelClass}>Name<input name="name" autoComplete="name" required maxLength={120} className={fieldClass} /></label>
        <label className={labelClass}>Business email<input name="business_email" type="email" autoComplete="email" required maxLength={254} className={fieldClass} /></label>
        <label className={labelClass}>Company<input name="company" autoComplete="organization" required maxLength={160} className={fieldClass} /></label>
        <label className={labelClass}>Role<input name="role" autoComplete="organization-title" required maxLength={160} className={fieldClass} /></label>
      </div>
      <label className={labelClass}>Interest type
        <select value={interest} onChange={(event) => setInterest(event.target.value as MarketingLeadInterest)} className={fieldClass}>
          <option value="early_access">Request Early Access</option>
          <option value="demo">Request a Demo</option>
        </select>
      </label>
      <label className={labelClass}>What workflow or business problem would you like to discuss?
        <textarea name="workflow_problem" required minLength={8} maxLength={2400} rows={5} className={fieldClass} placeholder="Share the task, handoff, or information challenge you want to improve." />
      </label>
      <label className={labelClass}>Current process or tools <span className="font-normal text-slate-500">(optional)</span>
        <textarea name="current_process_tools" maxLength={1200} rows={3} className={fieldClass} placeholder="For example, spreadsheets, documents, or existing systems." />
      </label>
      <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        Leave this field blank<input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
        <input name="marketing_consent" type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600" />
        <span>I would like to receive occasional product updates. Optional; this is not required for a response to my request.</span>
      </label>
      <p className="text-xs leading-5 text-slate-500">LVTChat uses these details to respond to your request and operate this contact process. See the <Link href="/privacy" className="font-semibold text-blue-800 underline">Privacy Policy</Link>. Marketing consent is stored separately.</p>
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <button type="submit" disabled={submitting} aria-busy={submitting} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60">
        {submitting ? "Sending request…" : interest === "demo" ? "Request Demo" : "Request Early Access"}
      </button>
      <p className="sr-only" aria-live="polite">{submitting ? "Submitting your request" : ""}</p>
    </form>
  );
}
