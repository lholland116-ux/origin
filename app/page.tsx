import { redirect } from "next/navigation";
import LandingPage from "@/components/landing/LandingPage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AI Workflow Automation for Manufacturing Quality—and Beyond",
  description: "LVTChat is building human-reviewed workflows that help businesses analyze information, identify problems, generate reports, and move work forward. Practical general AI tools are available today.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const isMissingSession =
    error?.message?.toLowerCase().includes("auth session missing") ?? false;

  if (error && !isMissingSession) {
    console.error("Home page auth lookup failed:", error.message);
  }

  if (user) {
    redirect("/chat");
  }

  return <LandingPage />;
}
