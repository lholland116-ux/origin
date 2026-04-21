// app/pricing/page.tsx
import { BRAND } from "@/lib/branding";

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-semibold">
          Simple, transparent pricing
        </h1>
        <p className="mt-4 text-white/70">
          Start free. Upgrade when you need more power.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 p-6">
          <h2 className="text-xl font-semibold">Free</h2>
          <p className="mt-2 text-white/70">$0 / month</p>
          <ul className="mt-4 space-y-2 text-sm text-white/70">
            <li>• Basic AI chat</li>
            <li>• Daily usage limits</li>
          </ul>
        </div>

        <div className="rounded-2xl border border-blue-500/30 p-6">
          <h2 className="text-xl font-semibold">Pro (Coming Soon)</h2>
          <p className="mt-2 text-white/70">$— / month</p>
          <ul className="mt-4 space-y-2 text-sm text-white/70">
            <li>• Higher limits</li>
            <li>• Web search</li>
            <li>• File uploads</li>
          </ul>
        </div>
      </div>
    </main>
  );
}