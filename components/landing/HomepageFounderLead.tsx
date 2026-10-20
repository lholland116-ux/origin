import Image from "next/image";
import Link from "next/link";
import LeadForm from "@/app/request/LeadForm";

export default function HomepageFounderLead() {
  return (
    <section aria-label="Founder and workflow inquiry" className="px-4 pb-7 pt-2 sm:px-8 sm:pb-10">
      <div className="mx-auto grid max-w-[1360px] gap-4 lg:grid-cols-2 lg:items-start">
        <article className="grid gap-5 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-slate-50 p-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start sm:p-6">
          <Image
            src="/images/founder/levi-holland-portrait.png"
            alt="Levi Holland, founder of LVTChat LLC"
            width={560}
            height={700}
            className="mx-auto h-48 w-36 rounded-xl object-cover object-center shadow-sm sm:h-52 sm:w-[150px]"
            sizes="(min-width: 640px) 150px, 144px"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-800">Founder perspective</p>
            <h2 className="mt-2 text-xl font-extrabold leading-tight text-slate-950 sm:text-2xl">Built by someone who understands regulated workflows.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              LVTChat was founded by Levi Holland, drawing on 25+ years of experience across pharmaceutical, biotechnology, cosmetic, and medical-device environments, including quality systems, validation, and regulatory work.
            </p>
            <Link href="/about" className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white/80 px-4 py-2 text-sm font-bold text-blue-800 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2">
              <span className="text-blue-800">About the Founder</span> <span aria-hidden="true" className="text-blue-800">→</span>
            </Link>
          </div>
        </article>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4">
            <h2 className="text-xl font-extrabold text-slate-950">Have a workflow you want to automate?</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">Tell us about your needs and we’ll be in touch.</p>
          </div>
          <LeadForm
            initialInterest="early_access"
            source="homepage"
            turnstileSiteKey={process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY}
            compact
          />
        </div>
      </div>
    </section>
  );
}
