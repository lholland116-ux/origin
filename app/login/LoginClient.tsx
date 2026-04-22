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
    return "rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-200";
  }

  if (messageType === "error") {
    return "rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200";
  }

  return "text-sm text-zinc-400";
}

const CARD_CLASS =
  "w-full max-w-md rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,22,48,0.92),rgba(7,13,30,0.95))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur";
const INPUT_CLASS =
  "w-full rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(7,13,28,0.94),rgba(4,8,20,0.98))] px-4 py-3 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-blue-400/40 focus:shadow-[0_0_0_1px_rgba(59,130,246,0.35),0_0_20px_rgba(59,130,246,0.15)]";
const PRIMARY_BUTTON_CLASS =
  "w-full rounded-2xl bg-[linear-gradient(90deg,#2563EB,#4F8CFF)] px-4 py-3 font-medium text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] transition hover:scale-[1.01] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50";
const TEXT_BUTTON_CLASS =
  "text-sm text-zinc-400 underline underline-offset-4 transition hover:text-zinc-200 disabled:opacity-50";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[6%] h-[360px] w-[360px] rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute right-[4%] top-[10%] h-[320px] w-[320px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute bottom-[8%] left-[18%] h-[240px] w-[380px] rounded-full bg-cyan-500/8 blur-3xl" />
      </div>

      <div className={CARD_CLASS}>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            {BRAND.name}
          </p>

          <h1 className="text-2xl font-semibold text-white">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>

          <p className="text-sm leading-6 text-zinc-400">
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
            className={INPUT_CLASS}
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
              className={`${INPUT_CLASS} pr-12`}
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
              className={TEXT_BUTTON_CLASS}
            >
              {resetLoading ? "Sending reset email..." : "Forgot password?"}
            </button>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className={PRIMARY_BUTTON_CLASS}
          >
            {loading
              ? "Please wait..."
              : mode === "signin"
                ? "Sign in"
                : "Sign up"}
          </button>
        </form>

        {message && (
          <p className={`mt-4 ${getFeedbackClassName(messageType)}`}>
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={toggleMode}
          disabled={loading || resetLoading}
          className={`mt-4 ${TEXT_BUTTON_CLASS}`}
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}