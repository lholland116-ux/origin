"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;
const INVALID_LINK_TIMEOUT_MS = 12000; // ⬅️ increased for reliability
const SUCCESS_REDIRECT_DELAY_MS = 1500;

export default function ResetPasswordPage() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasHandledRecoveryRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function initializeRecovery() {
      try {
        const url = new URL(window.location.href);

        const hasCode = url.searchParams.has("code");
        const hasAccessToken = url.hash.includes("access_token");

        // 🔍 Check session
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session) {
          hasHandledRecoveryRef.current = true;
          setIsReady(true);
          setError(null);
          return;
        }

        // ⛔ Only mark invalid if NO recovery indicators at all
        if (!hasCode && !hasAccessToken) {
          setError("Invalid reset link.");
        }

        // Otherwise → wait for Supabase event
      } catch {
        if (!mounted) return;
        setError("Unable to validate this reset link.");
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        hasHandledRecoveryRef.current = true;
        setIsReady(true);
        setError(null);
      }
    });

    void initializeRecovery();

    const timer = window.setTimeout(() => {
      if (!mounted) return;

      if (!hasHandledRecoveryRef.current) {
        setError(
          "This reset link may be invalid or expired. Please request a new one."
        );
      }
    }, INVALID_LINK_TIMEOUT_MS);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setError(null);

    if (!isReady) {
      setError("This reset link is still being validated. Please wait.");
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setStatus("Your password has been updated successfully.");
      setPassword("");
      setConfirmPassword("");

      await supabase.auth.signOut();

      window.setTimeout(() => {
        router.push("/login?reset=success");
      }, SUCCESS_REDIRECT_DELAY_MS);
    } catch {
      setError("Unable to reset password right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold">Reset password</h1>

      {!isReady && !error && (
        <p className="mt-4 text-sm text-gray-600">
          Validating reset link... (this can take a few seconds)
        </p>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {isReady && (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md border px-4 py-2 disabled:opacity-50"
          >
            {isSubmitting ? "Updating..." : "Update password"}
          </button>
        </form>
      )}

      {status && <p className="mt-4 text-sm text-green-700">{status}</p>}
    </main>
  );
}