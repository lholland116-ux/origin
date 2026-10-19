import { BRAND } from "@/lib/branding";
import { useCases } from "@/lib/landing-content";

export default function UseCases() {
  return (
    <section
      id="use-cases"
      aria-labelledby="use-cases-heading"
      className="rounded-[30px] border border-slate-200 bg-white px-5 py-10 shadow-sm md:px-8 lg:px-10"
    >
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-800">
          Real work and specialized workflows
        </p>

        <h2
          id="use-cases-heading"
          className="mt-4 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl"
        >
          Practical help for everyday work, quality, engineering, and regulatory workflows.
        </h2>

        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
          {BRAND.name} is useful today for general-purpose work and is expanding into purpose-built quality, engineering, and regulatory workflows.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {useCases.map((item) => (
          <article
            key={item.title}
            className="rounded-[26px] border border-slate-200 bg-slate-50 p-6"
          >
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-xl text-blue-800"
              aria-hidden="true"
            >
              {item.icon}
            </div>

            <h3 className="mt-5 text-lg font-semibold text-slate-950">
              {item.title}
            </h3>

            <p className="mt-3 text-sm leading-7 text-slate-600">
              {item.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
