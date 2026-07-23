import CTASection from "@/components/landing/CTASection";
import FeatureGrid from "@/components/landing/FeatureGrid";
import Footer from "@/components/landing/Footer";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import OfficialDemo from "@/components/landing/OfficialDemo";
import TrustedSection from "@/components/landing/TrustedSection";
import UseCases from "@/components/landing/UseCases";
import { BRAND } from "@/lib/branding";

export default function LandingPage() {
  return (
    <main
      id="top"
      aria-label={`${BRAND.name} landing page`}
      className="relative min-h-screen overflow-hidden bg-[#020817] text-white"
    >
      <BackgroundGlow />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
        <section
          aria-label={`${BRAND.name} introduction`}
          className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(4,10,25,0.98),rgba(3,8,20,0.98))] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_30px_80px_rgba(0,0,0,0.45)]"
        >
          <Header />
          <Hero />
          <FeatureGrid />
        </section>

        <OfficialDemo />

        <TrustedSection />
        <UseCases />
        <CTASection />
        <Footer />
      </div>
    </main>
  );
}

function BackgroundGlow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <div className="absolute left-[-10%] top-[5%] h-[420px] w-[420px] rounded-full bg-blue-600/20 blur-3xl" />

      <div className="absolute right-[2%] top-[10%] h-[360px] w-[360px] rounded-full bg-violet-500/20 blur-3xl" />

      <div className="absolute bottom-[10%] left-[15%] h-[320px] w-[520px] rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="absolute left-[3%] top-[28%] h-[260px] w-[260px] rounded-full bg-red-500/10 blur-3xl" />

      <div className="absolute bottom-[20%] right-[8%] h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-3xl" />
    </div>
  );
}