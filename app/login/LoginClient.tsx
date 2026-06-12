"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { BRAND } from "@/lib/branding";

declare global {
  interface Window {
    gtag?: (
      command: string,
      eventName: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

const MIN_PASSWORD_LENGTH = 8;

type AuthMode = "signin" | "signup";
type FeedbackType = "success" | "error" | null;

const CARD_CLASS =
  "w-full max-w-md rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(12,22,48,0.92),rgba(7,13,30,0.95))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur";

const INPUT_CLASS =
  "w-full rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(7,13,28,0.94),rgba(4,8,20,0.98))] px-4 py-3 text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-blue-400/40 focus:shadow-[0_0_0_1px_rgba(59,130,246,0.35),0_0_20px_rgba(59,130,246,0.15)]";

const PRIMARY_BUTTON_CLASS =
  "w-full rounded-2xl bg-[linear-gradient(90deg,#2563EB,#4F8CFF)] px-4 py-3 font-medium text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] transition hover:scale-[1.01] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50";

const SECONDARY_BUTTON_CLASS =
  "flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white px-4 py-3 font-medium text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60";

const TEXT_BUTTON_CLASS =
  "text-sm text-zinc-400 underline underline-offset-4 transition hover:text-zinc-200 disabled:opacity-50";

function trackGaEvent(eventName: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  window.gtag?.("event", eventName, params);
}

function getFeedbackClassName(messageType: FeedbackType): string {
  if (messageType === "success") {
    return "rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-200";
  }

  if (messageType === "error") {
    return "rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200";
  }

  return "text-sm text-zinc-400";
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || window.location.origin;
}

export default function LoginClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<FeedbackType>(null);

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const redirectTo = searchParams.get("redirectTo") || BRAND.routes.app;

  const isBusy = loading || googleLoading || resetLoading;

  const canSubmit =
    normalizedEmail.length > 0 &&
    password.length >= (mode === "signup" ? MIN_PASSWORD_LENGTH : 1) &&
    !isBusy;

  useEffect(() => {
    if (searchParams.get("reset") === "success") {
      setFeedback("Password reset successful. Please sign in.", "success");
    }
  }, [searchParams]);

  function setFeedback(nextMessage: string | null, nextType: FeedbackType) {
    setMessage(nextMessage);
    setMessageType(nextType);
  }

  function clearFeedback() {
    setFeedback(null, null);
  }

  async function handleGoogleSignIn() {
    if (isBusy) return;

    setGoogleLoading(true);
    clearFeedback();

    try {
      trackGaEvent("login", {
        method: "google",
        auth_action: "oauth_started",
      });

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${getAppUrl()}/auth/callback?next=${encodeURIComponent(
            BRAND.routes.app
          )}`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Google sign-in failed. Please try again.",
        "error"
      );
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) return;

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
          options: {
            emailRedirectTo: `${getAppUrl()}${BRAND.routes.app}`,
          },
        });

        if (error) throw error;

        trackGaEvent("sign_up", {
          method: "email",
        });

        setFeedback(
          "Account created. Please check your email to confirm your account.",
          "success"
        );
        setPassword("");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) throw error;

      trackGaEvent("login", {
        method: "email",
      });

      router.replace(redirectTo);
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
      setFeedback("Enter your email first, then click Forgot password.", "error");
      return;
    }

    if (isBusy) return;

    setResetLoading(true);
    clearFeedback();

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${getAppUrl()}/reset-password`,
        }
      );

      if (error) throw error;

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
    setMode((previous) => (previous === "signin" ? "signup" : "signin"));
    setPassword("");
    setShowPassword(false);
    clearFeedback();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#020817] px-4 py-10 text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[6%] h-[360px] w-[360px] rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute right-[4%] top-[10%] h-[320px] w-[320px] rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute bottom-[8%] left-[18%] h-[240px] w-[380px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <section className={CARD_CLASS} aria-labelledby="login-heading">
        <div className="text-center">
          <Link
            href={BRAND.routes.home}
            className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-lg font-bold text-white shadow-lg shadow-blue-500/25"
            aria-label={`${BRAND.name} home`}
          >
            {BRAND.shortName}
          </Link>

          <p className="text-xs font-medium uppercase tracking-[0.2em] text-blue-300">
            {BRAND.name}
          </p>

          <h1 id="login-heading" className="mt-3 text-2xl font-semibold text-white">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>

          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Access your AI workspace with chat history, image analysis, file
            uploads, and web search.
          </p>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isBusy}
            className={SECONDARY_BUTTON_CLASS}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-xs font-bold text-blue-600">
              G
            </span>
            {googleLoading ? "Connecting to Google..." : "Continue with Google"}
          </button>
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-zinc-500">or use email</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (message) clearFeedback();
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
                if (message) clearFeedback();
              }}
              className={`${INPUT_CLASS} pr-12`}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />

            <button
              type="button"
              onClick={() => setShowPassword((previous) => !previous)}
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
              disabled={isBusy}
              className={TEXT_BUTTON_CLASS}
            >
              {resetLoading ? "Sending reset email..." : "Forgot password?"}
            </button>
          )}

          <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON_CLASS}>
            {loading
              ? "Please wait..."
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
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
          disabled={isBusy}
          className={`mt-4 ${TEXT_BUTTON_CLASS}`}
        >
          {mode === "signin"
            ? "Need an account? Create one"
            : "Already have an account? Sign in"}
        </button>

        <p className="mt-6 text-center text-xs leading-5 text-zinc-500">
          By using {BRAND.name}, you agree to the{" "}
          <Link href={BRAND.routes.privacy} className="underline hover:text-zinc-300">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href={BRAND.routes.terms} className="underline hover:text-zinc-300">
            Terms of Service
          </Link>
          .
        </p>
      </section>
    </main>
  );
}