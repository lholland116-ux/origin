"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";

const MIN_PASSWORD_LENGTH = 8;

export default function AccountPage() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error" | null>(
    null
  );

  const isPasswordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    !loading &&
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

  useEffect(() => {
    let isMounted = true;

    async function checkUser() {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (error || !user) {
          router.replace("/login");
          return;
        }

        setPageLoading(false);
      } catch {
        if (!isMounted) return;
        router.replace("/login");
      }
    }

    void checkUser();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

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

    setLoading(true);

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
      setLoading(false);
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
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Account
            </p>
            <h1 className="text-2xl font-semibold">Change password</h1>
            <p className="text-sm text-zinc-400">
              Update your password below.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-500"
          >
            Back to chat
          </button>
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
            {loading ? "Saving..." : "Change password"}
          </button>
        </form>

        {message && (
          <p
            className={`mt-4 text-sm ${
              messageType === "success" ? "text-green-400" : "text-red-400"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </main>
  );
}