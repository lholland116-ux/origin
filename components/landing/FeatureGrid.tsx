import { features } from "@/lib/landing-content";

export default function FeatureGrid() {
  return (
    <section
      id="capabilities"
      aria-labelledby="features-heading"
      className="border-t border-slate-200 bg-slate-50 px-5 py-10 md:px-8 lg:px-12"
    >
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-800">
          General-purpose LVTChat - Available Now
        </p>

        <h2 id="features-heading" className="mt-3 text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
          Practical AI capabilities for work, research, and everyday tasks
        </h2>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {features.map((item) => (
          <article
            key={item.title}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="text-xl" aria-hidden="true">
              {item.icon}
            </div>

            <h3 className="mt-4 text-sm font-semibold text-slate-950">
              {item.title}
            </h3>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              {item.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
