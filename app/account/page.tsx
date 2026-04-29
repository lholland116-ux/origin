"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/branding";

const MIN_PASSWORD_LENGTH = 8;

type Plan = "free" | "pro";

type ProfileRow = {
  plan: Plan | string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
};

export default function AccountPage() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();

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
  const [messageType, setMessageType] = useState<"success" | "error" | null>(
    null
  );

  const isPasswordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = password === confirmPassword;
  const isPro = plan === "pro";

  const canSubmit =
    !passwordLoading &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
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
    let isMounted = true;

    async function loadAccount() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (error || !user) {
          router.replace(BRAND.routes.login);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select(
            "plan, subscription_status, current_period_end, stripe_customer_id"
          )
          .eq("id", user.id)
          .single<ProfileRow>();

        if (profileError || !profile) {
          console.error("Account profile load error:", profileError);
          setPlan("free");
        } else {
          setPlan(profile.plan === "pro" ? "pro" : "free");
          setSubscriptionStatus(profile.subscription_status);
          setCurrentPeriodEnd(profile.current_period_end);
        }

        setPageLoading(false);
      } catch (error) {
        console.error("Account load error:", error);

        if (!isMounted) return;

        router.replace(BRAND.routes.login);
      }
    }

    void loadAccount();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  async function handleManageBilling() {
    setBillingLoading(true);
    setMessage(null);
    setMessageType(null);

    try {
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
      });

      const data = (await response.json()) as {
        url?: string;
        error?: string;
      };

      if (response.status === 401) {
        router.push(BRAND.routes.login);
        return;
      }

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Unable to open billing portal.");
      }

      window.location.href = data.url;
    } catch (error) {
      console.error("Billing portal error:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open billing portal."
      );
      setMessageType("error");
      setBillingLoading(false);
    }
  }

  async function handleChangePassword(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setMessage(null);
    setMessageType(null);

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
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      setPassword("");
      setConfirmPassword("");
      setMessage("Password changed successfully.");
      setMessageType("success");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to change password."
      );
      setMessageType("error");
    } finally {
      setPasswordLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <div className="text-sm text-zinc-400">Loading account settings...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Account
              </p>
              <h1 className="text-2xl font-semibold">Account settings</h1>
              <p className="text-sm text-zinc-400">
                Manage your plan, billing, and password.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push(BRAND.routes.app)}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-500"
            >
              Back to chat
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Subscription
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                {isPro ? `${BRAND.pricing.proPlanName} plan` : "Free plan"}
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                {isPro
                  ? "You have access to Pro features including web search and file uploads."
                  : "Upgrade to Pro to unlock web search, file uploads, and higher usage limits."}
              </p>

              {subscriptionStatus && (
                <p className="mt-3 text-sm text-zinc-500">
                  Status:{" "}
                  <span className="font-medium text-zinc-300">
                    {subscriptionStatus}
                  </span>
                </p>
              )}

              {isPro && renewalText && (
                <p className="mt-1 text-sm text-zinc-500">
                  Current period ends:{" "}
                  <span className="font-medium text-zinc-300">
                    {renewalText}
                  </span>
                </p>
              )}
            </div>

            <div className="w-full sm:w-auto">
              {isPro ? (
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={billingLoading}
                  className="w-full rounded-2xl border border-blue-500/40 bg-blue-500/10 px-5 py-3 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {billingLoading ? "Opening..." : "Manage billing"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push(BRAND.routes.pricing)}
                  className="w-full rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 sm:w-auto"
                >
                  Upgrade to Pro
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Security
            </p>
            <h2 className="text-xl font-semibold">Change password</h2>
            <p className="text-sm text-zinc-400">
              Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <form onSubmit={handleChangePassword} className="mt-6 space-y-4">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="New password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 pr-12 outline-none transition focus:border-zinc-500"
                autoComplete="new-password"
                required
              />

              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 transition hover:text-zinc-100"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 pr-12 outline-none transition focus:border-zinc-500"
                autoComplete="new-password"
                required
              />

              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 transition hover:text-zinc-100"
                aria-label={
                  showConfirmPassword ? "Hide password" : "Show password"
                }
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {passwordHint && (
              <p
                className={`text-sm ${
                  isPasswordLongEnough && passwordsMatch
                    ? "text-green-400"
                    : "text-yellow-400"
                }`}
              >
                {passwordHint}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-2xl bg-white px-4 py-3 font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {passwordLoading ? "Saving..." : "Change password"}
            </button>
          </form>
        </section>

        {message && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              messageType === "success"
                ? "border-green-500/30 bg-green-500/10 text-green-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </main>
  );
}