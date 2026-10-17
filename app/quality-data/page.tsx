import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import QualityDataIngestionClient from "./QualityDataIngestionClient";

export const metadata: Metadata = {
  title: "Quality Data Import",
  description: "Validate and import organization-scoped manufacturing quality data.",
};

export default async function QualityDataPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error !== null || user === null) redirect("/login");

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 dark:bg-slate-950 sm:px-6 sm:py-12">
      <QualityDataIngestionClient />
    </main>
  );
}
