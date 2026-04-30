"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/branding";

const MIN_PASSWORD_LENGTH = 8;

type Plan = "free" | "pro";

type ProfileRow = {
  plan: Plan | string | null;
  subscription_status: string | null;
  current_period_end: string | null;
};

function AccountContent() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const success = searchParams.get("success");

  const [plan, setPlan] = useState<Plan>("free");
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(
    null
  );
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);

  const [billingLoading, setBillingLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<
    "success" | "error" | "info" | null
  >(null);

  const isPro = plan === "pro";

  const isPasswordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = password === confirmPassword;

  const canSubmit =
    !passwordLoading &&
    password &&
    confirmPassword &&
    isPasswordLongEnough &&
    passwordsMatch;

  const passwordHint = useMemo(() => {
    if (!password && !confirmPassword) return null;
    if (!isPasswordLongEnough) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (!passwordsMatch) {
      return "Passwords do not match.";
    }
    return "Password looks good.";
  }, [password, confirmPassword, isPasswordLongEnough, passwordsMatch]);

  const renewalText = useMemo(() => {
    if (!currentPeriodEnd) return null;

    const date = new Date(currentPeriodEnd);
    if (Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }, [currentPeriodEnd]);

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!mounted) return;

        if (error || !user) {
          router.replace(BRAND.routes.login);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("plan, subscription_status, current_period_end")
          .eq("id", user.id)
          .maybeSingle<ProfileRow>();

        setPlan(profile?.plan === "pro" ? "pro" : "free");
        setSubscriptionStatus(profile?.subscription_status ?? null);
        setCurrentPeriodEnd(profile?.current_period_end ?? null);

        setPageLoading(false);
      } catch (err) {
        console.error("Account load error:", err);
        router.replace(BRAND.routes.login);
      }
    }

    loadAccount();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (success) {
      setMessage("🎉 You're now on Pro. Early user pricing applied.");
      setMessageType("success");
    }
  }, [success]);

  async function handleManageBilling() {
    setBillingLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();

      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal.");
      }

      window.location.href = data.url;
    } catch (err) {
      setMessage("Unable to open billing portal.");
      setMessageType("error");
      setBillingLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (!isPasswordLongEnough) {
      setMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      setMessageType("error");
      return;
    }

    if (!passwordsMatch) {
      setMessage("Passwords do not match.");
      setMessageType("error");
      return;
    }

    setPasswordLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) throw error;

      setPassword("");
      setConfirmPassword("");

      setMessage("Password updated successfully.");
      setMessageType("success");
    } catch (err) {
      setMessage("Failed to update password.");
      setMessageType("error");
    } finally {
      setPasswordLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading account...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="text-sm text-zinc-400">
            Manage your plan, billing, and password.
          </p>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold">
            {isPro ? "Pro Plan" : "Free Plan"}
          </h2>

          {isPro && (
            <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              You are on early user pricing.
            </div>
          )}

          {renewalText && (
            <p className="mt-2 text-sm text-zinc-400">
              Renews on {renewalText}
            </p>
          )}

          <div className="mt-4">
            {isPro ? (
              <button
                onClick={handleManageBilling}
                disabled={billingLoading}
                className="rounded-xl bg-blue-500 px-4 py-2"
              >
                {billingLoading ? "Opening..." : "Manage Billing"}
              </button>
            ) : (
              <button
                onClick={() => router.push("/pricing")}
                className="rounded-xl bg-white px-4 py-2 text-black"
              >
                Upgrade to Pro
              </button>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold">Change Password</h2>

          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 px-3 py-2"
            />

            <input
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-800 px-3 py-2"
            />

            {passwordHint && (
              <p className="text-sm text-yellow-400">{passwordHint}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-xl bg-white px-4 py-2 text-black"
            >
              {passwordLoading ? "Saving..." : "Update Password"}
            </button>
          </form>
        </section>

        {message && (
          <div
            className={`rounded-xl px-4 py-2 text-sm ${
              messageType === "success"
                ? "bg-green-500/10 text-green-300"
                : "bg-red-500/10 text-red-300"
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </main>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="p-6 text-white">Loading...</div>}>
      <AccountContent />
    </Suspense>
  );
}