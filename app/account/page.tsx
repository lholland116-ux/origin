"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

type MessageType = "success" | "error" | "info";

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
  const [pageLoading, setPageLoading] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<MessageType>("info");

  const isPro = plan === "pro";
  const isPasswordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = password === confirmPassword;

  const canSubmit =
    !passwordLoading &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    isPasswordLongEnough &&
    passwordsMatch;

  const passwordHint = useMemo(() => {
    if (!password && !confirmPassword) return null;

    if (!isPasswordLongEnough) {
      return {
        text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        className: "text-amber-300",
      };
    }

    if (!passwordsMatch) {
      return {
        text: "Passwords do not match.",
        className: "text-red-300",
      };
    }

    return {
      text: "Password looks good.",
      className: "text-emerald-300",
    };
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

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("plan, subscription_status, current_period_end")
          .eq("id", user.id)
          .maybeSingle<ProfileRow>();

        if (profileError) {
          console.error("Profile load error:", profileError);
        }

        if (!mounted) return;

        setPlan(profile?.plan === "pro" ? "pro" : "free");
        setSubscriptionStatus(profile?.subscription_status ?? null);
        setCurrentPeriodEnd(profile?.current_period_end ?? null);
        setPageLoading(false);
      } catch (err) {
        console.error("Account load error:", err);

        if (mounted) {
          setMessage("Unable to load your account. Please sign in again.");
          setMessageType("error");
          setPageLoading(false);
        }
      }
    }

    loadAccount();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  useEffect(() => {
    if (success) {
      setMessage("You're now on Pro. Early user pricing applied.");
      setMessageType("success");
    }
  }, [success]);

  async function handleManageBilling() {
    setBillingLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data: { url?: string; error?: string } = await res.json();

      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal.");
      }

      window.location.assign(data.url);
    } catch (err) {
      console.error("Billing portal error:", err);
      setMessage("Unable to open billing portal. Please try again.");
      setMessageType("error");
      setBillingLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
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
      setShowPassword(false);
      setShowConfirmPassword(false);

      setMessage("Password updated successfully.");
      setMessageType("success");
    } catch (err) {
      console.error("Password update error:", err);
      setMessage("Failed to update password. Please try again.");
      setMessageType("error");
    } finally {
      setPasswordLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-400">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-5 text-sm shadow-2xl">
          Loading account...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link
            href={BRAND.routes.app ?? "/chat"}
            className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            ← Back to Chat
          </Link>
        </div>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage your plan, billing, and password.
          </p>
        </section>

        {message && (
          <div
            role="status"
            className={`rounded-2xl border px-4 py-3 text-sm ${
              messageType === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : messageType === "error"
                  ? "border-red-500/20 bg-red-500/10 text-red-300"
                  : "border-blue-500/20 bg-blue-500/10 text-blue-300"
            }`}
          >
            {message}
          </div>
        )}

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">
              {isPro ? "Pro Plan" : "Free Plan"}
            </h2>

            {subscriptionStatus && (
              <p className="text-sm capitalize text-zinc-400">
                Status: {subscriptionStatus.replace(/_/g, " ")}
              </p>
            )}
          </div>

          {isPro && (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              You are on early user pricing.
            </div>
          )}

          {renewalText && (
            <p className="mt-3 text-sm text-zinc-400">
              Renews on {renewalText}
            </p>
          )}

          <div className="mt-5">
            {isPro ? (
              <button
                type="button"
                onClick={handleManageBilling}
                disabled={billingLoading}
                className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {billingLoading ? "Opening..." : "Manage Billing"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => router.push(BRAND.routes.pricing ?? "/pricing")}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                Upgrade to Pro
              </button>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <h2 className="text-xl font-semibold">Change Password</h2>

          <form onSubmit={handleChangePassword} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                New password
              </label>

              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 pr-11 text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-2 inline-flex items-center rounded-lg px-2 text-zinc-400 transition hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Confirm password
              </label>

              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 pr-11 text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  className="absolute inset-y-0 right-2 inline-flex items-center rounded-lg px-2 text-zinc-400 transition hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            {passwordHint && (
              <p className={`text-sm ${passwordHint.className}`}>
                {passwordHint.text}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {passwordLoading ? "Saving..." : "Update Password"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-400">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-5 text-sm shadow-2xl">
            Loading account...
          </div>
        </main>
      }
    >
      <AccountContent />
    </Suspense>
  );
}