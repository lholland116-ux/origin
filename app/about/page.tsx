import { BRAND } from "@/lib/branding";

export default function AboutPage() {
  const address = BRAND.contact.address;

  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto max-w-4xl">
        <section className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
            About
          </p>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            About {BRAND.name}
          </h1>

          <p className="mt-6 text-base leading-7 text-white/70 sm:text-lg">
            {BRAND.name} was built by {BRAND.creator}, {BRAND.creatorTitle.toLowerCase()},
            to deliver practical AI that people can actually use in real life.
          </p>

          <p className="mt-4 text-base leading-7 text-white/70 sm:text-lg">
            The mission is simple: help individuals and businesses think more
            clearly, solve problems faster, and make better decisions with AI
            that feels useful, grounded, and practical.
          </p>

          <p className="mt-4 text-base leading-7 text-white/70 sm:text-lg">
            {BRAND.name} is designed for real-world use across work, research,
            planning, productivity, and everyday tasks—not just generic chat.
          </p>
        </section>

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.95),rgba(5,10,22,0.98))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <h2 className="text-xl font-semibold text-white">What {BRAND.name} stands for</h2>

            <ul className="mt-4 space-y-3 text-sm leading-7 text-white/70">
              <li>• Practical AI support for real tasks</li>
              <li>• Clear answers and better decisions</li>
              <li>• A user experience built for trust and simplicity</li>
              <li>• Continuous improvement with real-world usefulness in mind</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.95),rgba(5,10,22,0.98))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <h2 className="text-xl font-semibold text-white">Company information</h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-white/70">
              <div>
                <p className="font-medium text-white">Business</p>
                <p>{BRAND.legalName}</p>
              </div>

              <div>
                <p className="font-medium text-white">Support</p>
                <p>{BRAND.contact.email}</p>
              </div>

              <div>
                <p className="font-medium text-white">Mailing address</p>
                <address className="not-italic">
                  <div>{address.line1}</div>
                  {address.line2 ? <div>{address.line2}</div> : null}
                  <div>
                    {address.city}, {address.state} {address.postalCode}
                  </div>
                  <div>{address.country}</div>
                </address>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}