"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MarketingLeadInterest, MarketingLeadSource } from "@/lib/marketing/lead-analytics";
import { trackMarketingLeadEvent } from "@/lib/marketing/lead-analytics";

type LeadFormProps = {
  readonly initialInterest: MarketingLeadInterest;
  readonly source: MarketingLeadSource;
  readonly turnstileSiteKey?: string;
  readonly compact?: boolean;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
};

type SubmitResult = { readonly status?: string; readonly error?: string };
type TurnstileApi = {
  render: (container: HTMLElement, options: Readonly<{
    sitekey: string;
    action: string;
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

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

export default function LeadForm({ initialInterest, source, turnstileSiteKey, utmSource, utmMedium, utmCampaign, compact = false }: LeadFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const idempotencyPayload = useRef<string | null>(null);
  const [interest, setInterest] = useState<MarketingLeadInterest>(initialInterest);
  const [attribution, setAttribution] = useState({ utmSource, utmMedium, utmCampaign });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileScriptReady, setTurnstileScriptReady] = useState(false);
  const [turnstileScriptFailed, setTurnstileScriptFailed] = useState(false);

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileScriptReady || !turnstileContainerRef.current || !window.turnstile || turnstileWidgetId.current) return;
    const api = window.turnstile;
    turnstileWidgetId.current = api.render(turnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      action: "marketing_lead_submit",
      callback: (token) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => {
        setTurnstileToken(null);
        setTurnstileScriptFailed(true);
      },
    });
    return () => {
      if (turnstileWidgetId.current) api.remove(turnstileWidgetId.current);
      turnstileWidgetId.current = null;
    };
  }, [turnstileScriptReady, turnstileSiteKey]);

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
    if (!turnstileToken) {
      setError("Complete the verification check before sending your request.");
      return;
    }
    const form = formRef.current;
    if (!form) return;
    setSubmitting(true);
    setError(null);
    const data = new FormData(form);
    const retryablePayload = {
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
    const payloadSignature = JSON.stringify(retryablePayload);
    if (idempotencyPayload.current !== payloadSignature) {
      idempotencyPayload.current = payloadSignature;
      idempotencyKey.current = crypto.randomUUID();
    }
    const payload = {
      ...retryablePayload,
      idempotency_key: idempotencyKey.current as string,
      turnstile_token: turnstileToken,
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
            ? "This submission could not be confirmed. Review your details and try again."
            : result.error === "verification_failed"
              ? "The verification expired or could not be confirmed. Complete the check again and retry."
              : "We could not send your request right now. Complete the verification again and retry.");
        return;
      }
      setSubmitted(true);
      try { window.sessionStorage.removeItem("lvtchat:lead-attribution:v1"); } catch { /* optional browser storage */ }
      trackMarketingLeadEvent("lead_form_submit", interest, source);
    } catch {
      setError("We could not confirm your request. You can safely try again; duplicate submissions are handled.");
    } finally {
      setSubmitting(false);
      setTurnstileToken(null);
      if (turnstileWidgetId.current && window.turnstile) window.turnstile.reset(turnstileWidgetId.current);
    }
  }

  const fieldClass = `mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 ${compact ? "py-2.5 text-xs" : "py-3 text-sm"} text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20`;
  const labelClass = `block font-semibold text-slate-800 ${compact ? "text-xs" : "text-sm"}`;

  if (submitted) return (
    <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
      <h2 className="text-xl font-bold">Thanks for reaching out.</h2>
      <p className="mt-2 text-sm leading-6">Your request was received. LVTChat will use the information you provided to follow up about your interest.</p>
    </div>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className={compact ? "space-y-3" : "space-y-5"}>
      {turnstileSiteKey ? (
        <>
          <Script
            id="cloudflare-turnstile"
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            onReady={() => setTurnstileScriptReady(true)}
            onError={() => setTurnstileScriptFailed(true)}
          />
          <div>
            <div ref={turnstileContainerRef} aria-label="Bot verification" />
            {turnstileScriptFailed ? <p role="alert" className="mt-2 text-sm text-red-800">Verification is unavailable. Please try again later.</p> : null}
          </div>
        </>
      ) : (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Verification is not configured, so requests cannot be sent right now.</p>
      )}
      <div className={`grid sm:grid-cols-2 ${compact ? "gap-3" : "gap-5"}`}>
        <label className={labelClass}>Name<input name="name" autoComplete="name" required maxLength={120} className={fieldClass} /></label>
        <label className={labelClass}>Business email<input name="business_email" type="email" autoComplete="email" required maxLength={254} className={fieldClass} /></label>
        <label className={labelClass}>Company<input name="company" autoComplete="organization" required maxLength={160} className={fieldClass} /></label>
        <label className={labelClass}>Role<input name="role" autoComplete="organization-title" required maxLength={160} className={fieldClass} /></label>
      </div>
      <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-5"}>
        <label className={labelClass}>Interest type
          <select value={interest} onChange={(event) => setInterest(event.target.value as MarketingLeadInterest)} className={fieldClass}>
            <option value="early_access">Request Early Access</option>
            <option value="demo">Request a Demo</option>
          </select>
        </label>
        <label className={labelClass}>What workflow or business problem would you like to discuss?
          <textarea name="workflow_problem" required minLength={8} maxLength={2400} rows={compact ? 2 : 5} className={fieldClass} placeholder="Share the task, handoff, or information challenge you want to improve." />
        </label>
        <label className={labelClass}>Current process or tools <span className="font-normal text-slate-500">(optional)</span>
          <textarea name="current_process_tools" maxLength={1200} rows={compact ? 1 : 3} className={fieldClass} placeholder="For example, spreadsheets, documents, or existing systems." />
        </label>
        <label className={`flex items-start gap-3 leading-5 text-slate-700 ${compact ? "pt-1 text-xs" : "text-sm leading-6"}`}>
          <input name="marketing_consent" type="checkbox" className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-700 focus:ring-blue-600" />
          <span>I would like to receive occasional product updates. Optional; this is not required for a response to my request.</span>
        </label>
      </div>
      <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        Leave this field blank<input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <p className={`leading-5 text-slate-500 ${compact ? "text-[11px]" : "text-xs"}`}>LVTChat uses these details to respond to your request and operate this contact process. Cloudflare Turnstile checks this submission for automated abuse; form fields are sent to LVTChat, not to Turnstile Siteverify. See the <Link href="/privacy" className="font-semibold text-blue-800 underline"><span className="text-blue-800">Privacy Policy</span></Link>. Marketing consent is stored separately.</p>
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <button type="submit" disabled={submitting || !turnstileSiteKey || !turnstileToken || turnstileScriptFailed} aria-busy={submitting} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60">
        {submitting ? "Sending request…" : interest === "demo" ? "Request Demo" : "Request Early Access"}
      </button>
      <p className="sr-only" aria-live="polite">{submitting ? "Submitting your request" : ""}</p>
    </form>
  );
}
