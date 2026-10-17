import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";

import CapaIntakeClient from "./CapaIntakeClient";

export const metadata: Metadata = {
  title: "CAPA Assistant",
  description:
    "Create and review controlled corrective and preventive action records.",
};

/**
 * Authenticated entry point for the CAPA human-review interface.
 *
 * Authentication here protects page rendering. The CAPA API independently
 * verifies the Supabase user and session for every request.
 */
export default async function CapaPage() {
  const supabase =
    await createServerSupabaseClient();

  const {
    data: { user },
    error: authenticationError,
  } = await supabase.auth.getUser();

  if (
    authenticationError !== null ||
    user === null
  ) {
    redirect("/login");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#020817_0%,#020617_100%)] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute left-[8%] top-[8%] h-[320px] w-[320px] rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute right-[4%] top-[18%] h-[280px] w-[280px] rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <div className="mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6">
          <Link className="inline-flex rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800" href="/quality-data">
            Import manufacturing quality data
          </Link>
        </div>
        <CapaIntakeClient
          currentUserId={user.id}
          userEmail={user.email ?? ""}
        />
      </div>
    </main>
  );
}
