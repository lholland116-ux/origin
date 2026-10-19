import Link from "next/link";
import { BRAND } from "@/lib/branding";

export default function CTASection() {
  return (
    <section
      className="overflow-hidden rounded-[30px] border border-blue-900 bg-slate-950 px-5 py-8 shadow-xl md:px-8 lg:px-10"
      aria-label={`${BRAND.name} call to action`}
    >
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border border-blue-400/30 bg-blue-900 text-xl font-bold text-white">
            {BRAND.shortName}
          </div>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Bring us a workflow challenge.
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Request early access or a demo discussion about your quality, manufacturing, or business process.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Link href="/request?interest=early_access&source=homepage" className="inline-flex min-h-12 min-w-[190px] items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-blue-900 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-950">Request Early Access</Link>
          <Link href={BRAND.routes.login} className="text-center text-sm font-semibold text-blue-200 underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-blue-300">Try LVTChat Free</Link>
        </div>
      </div>
    </section>
  );
}
