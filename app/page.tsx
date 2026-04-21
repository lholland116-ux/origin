import { redirect } from "next/navigation";
import LandingPage from "@/components/landing/LandingPage";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const isExpectedSignedOutState =
    error?.message?.toLowerCase().includes("auth session missing");

  if (error && !isExpectedSignedOutState) {
    console.error(
      "Failed to get authenticated user on home page:",
      error.message
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  redirect("/chat");
}