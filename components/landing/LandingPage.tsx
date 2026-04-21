import CTASection from "@/components/landing/CTASection";
import FeatureGrid from "@/components/landing/FeatureGrid";
import Footer from "@/components/landing/Footer";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import UseCases from "@/components/landing/UseCases";
import { BRAND } from "@/lib/branding";

export default function LandingPage() {
  return (
    <main
      id="top"
      className="relative min-h-screen overflow-hidden bg-[#020817] text-white"
      aria-label={`${BRAND.name} landing page`}
    >
      <BackgroundGlow />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
        <section
          className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(4,10,25,0.98),rgba(3,8,20,0.98))] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_30px_80px_rgba(0,0,0,0.45)]"
          aria-label={`${BRAND.name} hero section`}
        >
          <Header />
          <Hero />
          <FeatureGrid />
        </section>

        <UseCases />
        <CTASection />
        <Footer />
      </div>
    </main>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute left-[-10%] top-[5%] h-[420px] w-[420px] rounded-full bg-blue-600/20 blur-3xl" />
      <div className="absolute right-[2%] top-[10%] h-[360px] w-[360px] rounded-full bg-violet-500/20 blur-3xl" />
      <div className="absolute bottom-[10%] left-[15%] h-[320px] w-[520px] rounded-full bg-cyan-500/10 blur-3xl" />
    </div>
  );
}