"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;
const SUCCESS_REDIRECT_DELAY_MS = 1500;

export default function ResetPasswordPage() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasSessionRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function initializeRecovery() {
      setIsValidating(true);
      setError(null);

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (sessionError) {
          setIsReady(false);
          setError("Unable to validate this reset link. Please request a new one.");
          return;
        }

        if (!session) {
          setIsReady(false);
          setError("Invalid or expired reset link. Please request a new password reset email.");
          return;
        }

        hasSessionRef.current = true;
        setIsReady(true);
        setError(null);
      } catch {
        if (!mounted) return;
        setIsReady(false);
        setError("Unable to validate this reset link. Please try again.");
      } finally {
        if (mounted) {
          setIsValidating(false);
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        hasSessionRef.current = true;
        setIsReady(true);
        setError(null);
        setIsValidating(false);
      }
    });

    void initializeRecovery();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus(null);
    setError(null);

    if (!isReady || !hasSessionRef.current) {
      setError("This reset link is not ready. Please request a new password reset email.");
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

      setStatus("Your password has been updated successfully. Redirecting to sign in...");
      setPassword("");
      setConfirmPassword("");

      await supabase.auth.signOut();

      window.setTimeout(() => {
        router.push("/login?reset=success");
      }, SUCCESS_REDIRECT_DELAY_MS);
    } catch {
      setError("Unable to reset password right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <section className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl">
        <p className="text-xs uppercase tracking-[0.3em] text-blue-300">
          LVTChat
        </p>

        <h1 className="mt-3 text-2xl font-semibold">Reset password</h1>

        {isValidating && (
          <p className="mt-4 text-sm leading-6 text-white/60">
            Validating your reset link...
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm leading-6 text-red-200">
            {error}
          </div>
        )}

        {isReady && (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white/80">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-white/40 focus:border-blue-400"
                placeholder="Enter new password"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-white/80"
              >
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-white/40 focus:border-blue-400"
                placeholder="Confirm new password"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        {status && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm leading-6 text-emerald-200">
            {status}
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push("/login")}
          className="mt-5 text-sm text-blue-300 underline-offset-4 hover:underline"
        >
          Back to sign in
        </button>
      </section>
    </main>
  );
}