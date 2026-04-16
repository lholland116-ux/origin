"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/branding";

const MIN_PASSWORD_LENGTH = 8;

type AuthMode = "signin" | "signup";
type FeedbackType = "success" | "error" | null;

function getFeedbackClassName(messageType: FeedbackType): string {
  if (messageType === "success") {
    return "text-green-400";
  }

  if (messageType === "error") {
    return "text-red-400";
  }

  return "text-zinc-400";
}

export default function LoginClient() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<FeedbackType>(null);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const canSubmit =
    normalizedEmail.length > 0 &&
    password.length >= (mode === "signup" ? MIN_PASSWORD_LENGTH : 1) &&
    !loading &&
    !resetLoading;

  useEffect(() => {
    if (searchParams.get("reset") === "success") {
      setMessage("Password reset successful. Please sign in.");
      setMessageType("success");
    }
  }, [searchParams]);

  function setFeedback(nextMessage: string | null, nextType: FeedbackType) {
    setMessage(nextMessage);
    setMessageType(nextType);
  }

  function clearFeedback() {
    setFeedback(null, null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setLoading(true);
    clearFeedback();

    try {
      if (mode === "signup") {
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          );
        }

        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });

        if (error) {
          throw error;
        }

        setFeedback(
          "Account created. Check your email if confirmation is enabled.",
          "success"
        );
        setPassword("");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        throw error;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Authentication failed.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!normalizedEmail) {
      setFeedback(
        "Enter your email first, then click Forgot password.",
        "error"
      );
      return;
    }

    if (loading || resetLoading) {
      return;
    }

    setResetLoading(true);
    clearFeedback();

    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim() || window.location.origin;

      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${appUrl}/reset-password`,
        }
      );

      if (error) {
        throw error;
      }

      setFeedback(
        "Password reset email sent. Check your inbox and spam folder.",
        "success"
      );
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Failed to send reset email.",
        "error"
      );
    } finally {
      setResetLoading(false);
    }
  }

  function toggleMode() {
    setMode((prev) => (prev === "signin" ? "signup" : "signin"));
    setPassword("");
    setShowPassword(false);
    clearFeedback();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            {BRAND.name}
          </p>

          <h1 className="text-2xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>

          <p className="text-sm text-zinc-400">
            Access your AI workspace with chat history, image analysis, and web
            search.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (message) {
                clearFeedback();
              }
            }}
            className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none transition focus:border-zinc-500"
            autoComplete="email"
            inputMode="email"
            required
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (message) {
                  clearFeedback();
                }
              }}
              className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 pr-12 outline-none transition focus:border-zinc-500"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
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

          {mode === "signup" && (
            <p className="text-xs text-zinc-500">
              Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}

          {mode === "signin" && (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={resetLoading || loading}
              className="text-sm text-zinc-400 underline disabled:opacity-50"
            >
              {resetLoading ? "Sending reset email..." : "Forgot password?"}
            </button>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-2xl bg-white px-4 py-3 font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "signin"
                ? "Sign in"
                : "Sign up"}
          </button>
        </form>

        {message && (
          <p className={`mt-4 text-sm ${getFeedbackClassName(messageType)}`}>
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={toggleMode}
          disabled={loading || resetLoading}
          className="mt-4 text-sm text-zinc-400 underline disabled:opacity-50"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}