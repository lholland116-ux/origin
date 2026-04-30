import { redirect } from "next/navigation";
import LandingPage from "@/components/landing/LandingPage";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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