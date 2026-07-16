import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/branding";

const SUPPORT_EMAIL = BRAND.contact?.email || "support@lvtchat.com";

const FOUNDER_IMAGE_SRC = "/images/founder/levi-holland-portrait.png";

export const metadata: Metadata = {
  title: `About ${BRAND.name}`,
  description:
    "Learn about LVTChat, its mission, and founder Levi Holland. LVTChat provides practical AI support for work, research, business, and everyday tasks.",
};

const stats = [
  {
    label: "Years in regulated industries",
    value: "25+",
  },
  {
    label: "AI certifications",
    value: "30+",
  },
  {
    label: "AI build and study hours",
    value: "2,500+",
  },
] as const;

const differentiators = [
  {
    title: "Built for clarity",
    description:
      "Clear, useful responses that help users move from questions to practical next steps.",
  },
  {
    title: "Real industry foundation",
    description:
      "Shaped by decades of scientific, engineering, validation, quality-system, and regulated-industry experience.",
  },
  {
    title: "Practical by design",
    description:
      "Focused on work, research, planning, productivity, and decision support without unnecessary complexity.",
  },
] as const;

const principles = [
  "Practical AI support for real tasks",
  "Clear answers and better decisions",
  "A user experience built for trust and simplicity",
  "Real-world insight shaped by scientific and industry experience",
] as const;

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

          <div className="mt-6 space-y-4 text-lg leading-8 text-white/75">
            <p>
              {BRAND.name} is a practical AI platform designed to help
              individuals and businesses solve problems faster, think more
              clearly, and move forward with confidence.
            </p>

            <p>
              Available in 177 countries worldwide, {BRAND.name} supports
              writing, research, business planning, document analysis, web
              search, image analysis, and everyday decision-making.
            </p>

            <p>
              The platform was founded by Levi Holland, an AI Engineer and
              scientist with more than 25 years of experience across the
              pharmaceutical, biotechnology, cosmetic, and medical device
              industries.
            </p>

            <p>
              Levi holds a Bachelor of Science in Biology from Stony Brook
              University and has led work in validation, quality systems,
              engineering, and regulatory compliance, including FDA and EU MDR
              environments.
            </p>

            <p>
              He has completed more than 30 AI certifications through
              Vanderbilt University and IBM, with training in generative AI, AI
              agents, automation, data analysis, and the development of
              practical AI systems.
            </p>

            <p>
              This combination of scientific, engineering, regulatory, and AI
              experience shapes {BRAND.name} into more than a generic chatbot.
              It is built to provide structured, useful, and practical support
              for real-world needs.
            </p>

            <p>
              {BRAND.name} was also built with the support and encouragement of
              family and friends, whose belief in the vision helped shape a
              product focused on usefulness, clarity, and trust.
            </p>
          </div>
        </section>

        <section
          aria-label="Founder experience and qualifications"
          className="mt-12 grid gap-5 sm:grid-cols-3"
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center shadow-2xl"
            >
              <p className="text-3xl font-semibold tracking-tight text-white">
                {stat.value}
              </p>

              <p className="mt-2 text-sm text-white/60">{stat.label}</p>
            </div>
          ))}
        </section>

        <section className="mt-12 grid gap-8 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl sm:p-8 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl">
            <Image
              src={FOUNDER_IMAGE_SRC}
              alt="Levi Holland, Founder, AI Engineer, and Scientist at LVTChat"
              width={560}
              height={700}
              priority
              sizes="(min-width: 768px) 280px, calc(100vw - 80px)"
              className="aspect-[4/5] h-full w-full object-cover object-center"
            />
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
              Meet the Founder
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Levi Holland
            </h2>

            <p className="mt-2 text-lg font-medium text-blue-300">
              Founder, AI Engineer &amp; Scientist
            </p>

            <p className="mt-2 text-sm text-white/55">
              AI Systems Builder • 25+ Years in Regulated Industries
            </p>

            <div className="mt-6 space-y-4 text-base leading-7 text-white/70">
              <p>
                I created {BRAND.name} with one goal: to make artificial
                intelligence practical, trustworthy, and genuinely useful for
                everyday work, research, and business.
              </p>

              <p>
                After more than 25 years working in engineering, validation,
                quality systems, and regulatory compliance across the
                pharmaceutical, biotechnology, cosmetic, and medical device
                industries, I saw firsthand how important clear information and
                sound decision-making are when solving complex problems.
              </p>

              <p>
                As artificial intelligence evolved, I invested more than 2,500
                hours studying, building, and deploying AI systems while
                completing more than 30 AI certifications through IBM and
                Vanderbilt University. That experience became the foundation
                for {BRAND.name}.
              </p>

              <p>
                Rather than creating another generic AI chatbot, I wanted to
                build an assistant that helps people think more clearly, solve
                problems faster, and move forward with confidence.
              </p>

              <p>
                Whether someone is writing, researching, planning a business,
                analyzing documents, searching the web, or exploring a new
                idea, {BRAND.name} is designed to provide practical answers they
                can actually use.
              </p>
            </div>

            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-sm font-medium text-white">Levi Holland</p>

              <p className="mt-1 text-sm text-white/50">
                Founder, AI Engineer &amp; Scientist
              </p>

              <p className="mt-4 text-sm font-medium italic text-blue-300">
                “Practical AI you can actually use.”
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-blue-400/20 bg-blue-500/10 p-6 sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Why {BRAND.name} is different
          </h2>

          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {differentiators.map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-white/10 bg-[#020817]/60 p-5"
              >
                <h3 className="font-semibold text-white">{item.title}</h3>

                <p className="mt-3 text-sm leading-6 text-white/65">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl sm:p-8">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            What {BRAND.name} stands for
          </h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {principles.map((principle) => (
              <div
                key={principle}
                className="rounded-2xl border border-white/10 bg-[#020817]/60 p-5"
              >
                <p className="text-sm leading-6 text-white/75">{principle}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 max-w-3xl space-y-4 text-lg leading-8 text-white/75">
            <p>
              The mission is simple: help individuals and businesses think more
              clearly, solve problems faster, and make better decisions with AI
              that feels useful, grounded, and practical.
            </p>

            <p>
              {BRAND.name} is built for real-world use across work, research,
              planning, productivity, and everyday tasks—not just generic chat.
            </p>
          </div>
        </section>

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-blue-400/20 bg-blue-500/10 p-6 sm:p-8">
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
                  Founder • AI Engineer • Scientist
                </dd>
              </div>

              <div>
                <dt className="text-white/45">Availability</dt>

                <dd className="mt-1 font-medium text-white">
                  Available in 177 countries worldwide
                </dd>
              </div>

              <div>
                <dt className="text-white/45">Support</dt>

                <dd className="mt-1">
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="font-medium text-blue-300 underline-offset-4 transition hover:text-blue-200 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-300/60"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
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