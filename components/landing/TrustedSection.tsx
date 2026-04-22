export default function TrustedSection() {
  return (
    <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(6,12,28,0.95),rgba(5,10,22,0.98))] px-6 py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
        Built on real-world experience
      </p>

      <h2 className="mt-4 text-3xl font-semibold text-white">
        Not just AI. Built with industry expertise.
      </h2>

      <p className="mx-auto mt-4 max-w-2xl text-sm text-white/65 leading-7">
        LVTChat is built by a scientist and AI engineer with decades of experience
        across pharmaceutical, biotechnology, cosmetic, and medical device industries,
        including regulatory and validation environments.
      </p>
    </section>
  );
}