import CTASection from "@/components/landing/CTASection";
import FeatureGrid from "@/components/landing/FeatureGrid";
import Footer from "@/components/landing/Footer";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import TrustedSection from "@/components/landing/TrustedSection";
import UseCases from "@/components/landing/UseCases";
import MothersDayLaunchBanner from "@/components/MothersDayLaunchBanner";
import { BRAND } from "@/lib/branding";

export default function LandingPage() {
  return (
    <main
      id="top"
      className="relative min-h-screen overflow-hidden bg-[#020817] text-white"
      aria-label={`${BRAND.name} landing page`}
    >
      <BackgroundGlow />
      <LaunchCelebration />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
        <LaunchDayBanner />

        <section
          className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(4,10,25,0.98),rgba(3,8,20,0.98))] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_30px_80px_rgba(0,0,0,0.45)]"
          aria-label={`${BRAND.name} hero section`}
        >
          <Header />
          <Hero />
          <MothersDayLaunchBanner />
          <FeatureGrid />
        </section>

        <TrustedSection />
        <UseCases />
        <CTASection />
        <Footer />
      </div>
    </main>
  );
}

function LaunchDayBanner() {
  return (
    <section
      aria-label={`${BRAND.name} launch day announcement`}
      className="relative overflow-hidden rounded-[28px] border border-blue-400/30 bg-[linear-gradient(90deg,rgba(30,64,175,0.35),rgba(88,28,135,0.35),rgba(15,23,42,0.8))] px-5 py-5 text-center shadow-[0_0_70px_rgba(59,130,246,0.18)]"
    >
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-6 top-4 text-xl">🎉</div>
        <div className="absolute right-8 top-5 text-xl">🎉</div>
        <div className="absolute bottom-4 left-10 text-sm text-red-300">✦</div>
        <div className="absolute bottom-5 right-14 text-sm text-blue-300">
          ✦
        </div>
      </div>

      <div className="relative">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-blue-200">
          Official LVTChat Launch Day
        </p>

        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
          🎉 LVTChat is officially live! 🎉
        </h1>

        <p className="mx-auto mt-2 max-w-3xl text-sm leading-6 text-zinc-200 sm:text-base">
          Happy Mother&apos;s Day. Today is a huge day for LVT, and we&apos;re
          celebrating with early user pricing for the first customers who join
          us at the beginning.
        </p>
      </div>
    </section>
  );
}

function LaunchCelebration() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute left-[4%] top-[9%] text-2xl text-red-400 opacity-70">
        ✦
      </div>
      <div className="absolute left-[12%] top-[34%] text-sm text-blue-300 opacity-70">
        ◆
      </div>
      <div className="absolute right-[8%] top-[18%] text-xl text-white opacity-70">
        ✦
      </div>
      <div className="absolute right-[14%] top-[48%] text-sm text-red-300 opacity-70">
        ◆
      </div>
      <div className="absolute left-[48%] top-[7%] text-sm text-blue-200 opacity-70">
        ✦
      </div>
      <div className="absolute bottom-[18%] right-[5%] text-2xl text-blue-400 opacity-60">
        ✦
      </div>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute left-[-10%] top-[5%] h-[420px] w-[420px] rounded-full bg-blue-600/20 blur-3xl" />
      <div className="absolute right-[2%] top-[10%] h-[360px] w-[360px] rounded-full bg-violet-500/20 blur-3xl" />
      <div className="absolute bottom-[10%] left-[15%] h-[320px] w-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="absolute left-[3%] top-[28%] h-[260px] w-[260px] rounded-full bg-red-500/10 blur-3xl" />
      <div className="absolute right-[8%] bottom-[20%] h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-3xl" />
    </div>
  );
}