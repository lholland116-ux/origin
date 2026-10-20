import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import QualityDataIntelligenceReportClient from "../../QualityDataIntelligenceReportClient";

export const metadata: Metadata = { title: "Quality Intelligence Report", description: "Review approved-version quality calculations and source provenance." };

export default async function QualityDataIntelligenceReportPage({ params }: { readonly params: Promise<{ readonly reportId: string }> }) {
  const { reportId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  return <QualityDataIntelligenceReportClient reportId={reportId} />;
}
