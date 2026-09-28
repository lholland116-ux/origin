import { features } from "@/lib/landing-content";

export default function FeatureGrid() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="border-t border-white/10 px-5 py-7 md:px-8 lg:px-10"
    >
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
          General-purpose LVTChat - Available Now
        </p>

        <h2 id="features-heading" className="mt-3 text-2xl font-semibold tracking-tight text-white md:text-3xl">
          Practical AI capabilities for work, research, and everyday tasks
        </h2>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {features.map((item) => (
          <article
            key={item.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur"
          >
            <div className="text-xl" aria-hidden="true">
              {item.icon}
            </div>

            <h3 className="mt-4 text-sm font-semibold text-white">
              {item.title}
            </h3>

            <p className="mt-2 text-sm leading-6 text-white/60">
              {item.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}