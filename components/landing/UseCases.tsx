import { BRAND } from "@/lib/branding";
import { useCases } from "@/lib/landing-content";

export default function UseCases() {
  return (
    <section
      id="use-cases"
      aria-labelledby="use-cases-heading"
      className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(6,12,28,0.95),rgba(5,10,22,0.98))] px-5 py-10 shadow-[0_25px_70px_rgba(0,0,0,0.4)] md:px-8 lg:px-10"
    >
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
          Built for everyday impact
        </p>

        <h2
          id="use-cases-heading"
          className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl"
        >
          One AI assistant. Endless possibilities.
        </h2>

        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/60 sm:text-base">
          {BRAND.name} helps individuals, professionals, businesses, and
          developers solve problems faster with practical AI support.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {useCases.map((item) => (
          <article
            key={item.title}
            className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,36,0.95),rgba(7,13,28,0.95))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-xl text-blue-300"
              aria-hidden="true"
            >
              {item.icon}
            </div>

            <h3 className="mt-5 text-lg font-semibold text-white">
              {item.title}
            </h3>

            <p className="mt-3 text-sm leading-7 text-white/60">
              {item.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}