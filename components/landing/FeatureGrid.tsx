import { BRAND } from "@/lib/branding";
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
          Powered by advanced AI. Built for real-world impact.
        </p>

        <h2 id="features-heading" className="sr-only">
          {BRAND.name} features
        </h2>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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