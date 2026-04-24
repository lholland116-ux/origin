import Link from "next/link";
import { BRAND } from "@/lib/branding";

const SUPPORT_EMAIL = BRAND.contact?.email || "support@lvtchat.com";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto max-w-5xl">
        <Link
          href={BRAND.routes.home}
          className="inline-flex rounded-md text-sm text-white/60 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-[#020817]"
        >
          ← Back to Home
        </Link>

        <section className="mt-10 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            About
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            About {BRAND.name}
          </h1>

          <p className="mt-6 text-lg leading-8 text-white/75">
            {BRAND.name} was built by Levi Holland, an AI Engineer and
            scientist with more than 25 years of experience across the
            pharmaceutical, biotech, cosmetic, and medical device industries.
          </p>

          <p className="mt-4 text-lg leading-8 text-white/75">
            He holds a Bachelor of Science in Biology from Stony Brook
            University and has led work in validation, quality systems, and
            regulatory compliance, including FDA and EU MDR environments.
          </p>

          <p className="mt-4 text-lg leading-8 text-white/75">
            This background shapes {BRAND.name} into more than a generic AI
            tool. It is designed to support real-world decision-making with
            clarity, structure, and practical insight.
          </p>

          <p className="mt-4 text-lg leading-8 text-white/75">
            {BRAND.name} was also built with the support and encouragement of
            family and friends, whose belief in the vision helped shape a
            product focused on usefulness, clarity, and trust.
          </p>
        </section>

        <section className="mt-12 grid gap-8 rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl md:grid-cols-[220px_1fr]">
          <div
            aria-label="Levi Holland initials"
            className="flex aspect-square items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-5xl font-semibold text-white shadow-inner"
          >
            LH
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
              Founder
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Built by Levi Holland
            </h2>

            <p className="mt-2 text-sm text-white/60">
              AI Engineer • Scientist • 25+ Years in Regulated Industries
            </p>

            <p className="mt-4 text-base leading-7 text-white/70">
              I created {BRAND.name} to make AI more practical, useful, and
              approachable for people who need help thinking through real
              problems, not just generating generic answers.
            </p>

            <p className="mt-4 text-base leading-7 text-white/70">
              My background in science, validation, quality systems, and
              regulated industries shaped the way {BRAND.name} is built: with
              structure, clarity, trust, and real-world usefulness at the center.
            </p>

            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-sm font-medium text-white">Levi Holland</p>
              <p className="mt-1 text-sm text-white/50">
                Founder, {BRAND.name}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-blue-400/20 bg-blue-500/10 p-8">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Why {BRAND.name} is different
          </h2>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#020817]/60 p-5">
              <h3 className="font-semibold text-white">Built for clarity</h3>
              <p className="mt-3 text-sm leading-6 text-white/65">
                Clear, useful responses that help users move from questions to
                actionable next steps.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#020817]/60 p-5">
              <h3 className="font-semibold text-white">
                Real industry foundation
              </h3>
              <p className="mt-3 text-sm leading-6 text-white/65">
                Shaped by decades of scientific, validation, quality-system, and
                regulated-industry experience.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#020817]/60 p-5">
              <h3 className="font-semibold text-white">
                Practical by design
              </h3>
              <p className="mt-3 text-sm leading-6 text-white/65">
                Focused on everyday work, research, planning, productivity, and
                decision support without unnecessary complexity.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            What {BRAND.name} stands for
          </h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              "Practical AI support for real tasks",
              "Clear answers and better decisions",
              "A user experience built for trust and simplicity",
              "Real-world insight shaped by scientific and industry experience",
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/10 bg-[#020817]/60 p-5"
              >
                <p className="text-sm leading-6 text-white/75">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 max-w-3xl">
          <p className="text-lg leading-8 text-white/75">
            The mission is simple: help individuals and businesses think more
            clearly, solve problems faster, and make better decisions with AI
            that feels useful, grounded, and practical.
          </p>

          <p className="mt-4 text-lg leading-8 text-white/75">
            {BRAND.name} is designed for real-world use across work, research,
            planning, productivity, and everyday tasks — not just generic chat.
          </p>
        </section>

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-blue-400/20 bg-blue-500/10 p-8">
            <h2 className="text-2xl font-semibold text-white">
              Company Information
            </h2>

            <dl className="mt-6 space-y-5 text-sm">
              <div>
                <dt className="text-white/45">Business</dt>
                <dd className="mt-1 font-medium text-white">
                  {BRAND.legalName}
                </dd>
              </div>

              <div>
                <dt className="text-white/45">Founder</dt>
                <dd className="mt-1 font-medium text-white">Levi Holland</dd>
                <dd className="mt-1 text-white/60">
                  AI Engineer • Scientist
                </dd>
              </div>

              <div>
                <dt className="text-white/45">Support</dt>
                <dd className="mt-1">
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="font-medium text-blue-300 underline-offset-4 hover:underline"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Mailing Address
            </h2>

            <address className="mt-6 not-italic text-sm leading-7 text-white/70">
              1101 Hillcrest Pkwy
              <br />
              Ste L PMB 1041
              <br />
              Dublin, GA 31021
              <br />
              United States
            </address>
          </div>
        </section>
      </div>
    </main>
  );
}