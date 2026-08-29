"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Eye,
  EyeOff,
} from "lucide-react";

import {
  createBrowserSupabaseClient,
} from "@/lib/supabase/client";

import {
  createSupabaseTotpQrDataUrl,
  summarizeSupabaseTotpFactors,
} from "@/lib/security/supabase-totp-enrollment-ui";

interface PendingTotpEnrollment {
  readonly factor_id: string;
  readonly qr_code: string;
  readonly secret: string;
}

type MfaMessage =
  | {
      readonly type:
        "success" | "error" | "info";
      readonly text: string;
    }
  | null;

export default function TotpMfaEnrollment() {
  const supabase =
    useMemo(
      () =>
        createBrowserSupabaseClient(),
      [],
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    hasVerifiedTotp,
    setHasVerifiedTotp,
  ] = useState(false);

  const [
    incompleteCount,
    setIncompleteCount,
  ] = useState(0);

  const [
    pending,
    setPending,
  ] =
    useState<
      PendingTotpEnrollment | null
    >(null);

  const [
    verificationCode,
    setVerificationCode,
  ] = useState("");

  const [
    showSecret,
    setShowSecret,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] =
    useState<MfaMessage>(null);

  const refreshFactors =
    useCallback(
      async () => {
        const {
          data,
          error,
        } =
          await supabase.auth.mfa
            .listFactors();

        if (
          error !== null ||
          data === null
        ) {
          throw new Error(
            "Unable to read MFA factors.",
          );
        }

        const summary =
          summarizeSupabaseTotpFactors(
            data.all,
          );

        setHasVerifiedTotp(
          summary
            .verified_factor_ids
            .length > 0,
        );

        setIncompleteCount(
          summary
            .unverified_factor_ids
            .length,
        );

        return summary;
      },
      [supabase],
    );

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const {
          data: {
            user,
          },
          error,
        } =
          await supabase.auth
            .getUser();

        if (
          error !== null ||
          user === null
        ) {
          if (mounted) {
            setMessage({
              type: "error",
              text:
                "Sign in again to manage two-factor authentication.",
            });
          }

          return;
        }

        await refreshFactors();
      } catch {
        if (mounted) {
          setMessage({
            type: "error",
            text:
              "Unable to load two-factor authentication settings.",
          });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [
    refreshFactors,
    supabase,
  ]);

  async function beginEnrollment() {
    setBusy(true);
    setMessage(null);

    try {
      const summary =
        await refreshFactors();

      if (
        summary
          .verified_factor_ids
          .length > 0
      ) {
        setHasVerifiedTotp(true);
        setMessage({
          type: "info",
          text:
            "An authenticator is already enabled for this account.",
        });

        return;
      }

      /*
       * Remove only incomplete TOTP enrollments before creating a new one.
       * Verified factors are never removed by this flow.
       */
      for (
        const factorId of
          summary
            .unverified_factor_ids
      ) {
        const {
          error,
        } =
          await supabase.auth.mfa
            .unenroll({
              factorId,
            });

        if (error !== null) {
          throw new Error(
            "Unable to remove an incomplete MFA enrollment.",
          );
        }
      }

      const {
        data,
        error,
      } =
        await supabase.auth.mfa
          .enroll({
            factorType:
              "totp",
            friendlyName:
              "LVTChat Authenticator",
            issuer:
              "LVTChat",
          });

      if (
        error !== null ||
        data === null
      ) {
        throw new Error(
          "Unable to begin TOTP enrollment.",
        );
      }

      setPending({
        factor_id:
          data.id,

        qr_code:
          data.totp.qr_code,

        secret:
          data.totp.secret,
      });

      setVerificationCode("");
      setShowSecret(false);
      setIncompleteCount(1);

      setMessage({
        type: "info",
        text:
          "Scan the QR code and verify the authenticator code to finish setup.",
      });
    } catch {
      setMessage({
        type: "error",
        text:
          "Unable to start authenticator setup. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrollment() {
    if (pending === null) {
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const {
        error,
      } =
        await supabase.auth.mfa
          .unenroll({
            factorId:
              pending.factor_id,
          });

      if (error !== null) {
        throw new Error(
          "Unable to cancel TOTP enrollment.",
        );
      }

      setPending(null);
      setVerificationCode("");
      setShowSecret(false);

      await refreshFactors();

      setMessage({
        type: "info",
        text:
          "Authenticator setup was cancelled.",
      });
    } catch {
      setMessage({
        type: "error",
        text:
          "Unable to cancel authenticator setup. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (pending === null) {
      return;
    }

    const code =
      verificationCode.trim();

    if (code.length === 0) {
      setMessage({
        type: "error",
        text:
          "Enter the current code from your authenticator app.",
      });

      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const {
        data:
          challenge,
        error:
          challengeError,
      } =
        await supabase.auth.mfa
          .challenge({
            factorId:
              pending.factor_id,
          });

      if (
        challengeError !== null ||
        challenge === null
      ) {
        throw new Error(
          "Unable to create MFA challenge.",
        );
      }

      const {
        error:
          verifyError,
      } =
        await supabase.auth.mfa
          .verify({
            factorId:
              pending.factor_id,

            challengeId:
              challenge.id,

            code,
          });

      if (
        verifyError !== null
      ) {
        throw new Error(
          "Unable to verify MFA code.",
        );
      }

      /*
       * Do not declare success solely because verify() returned without an
       * error. Confirm both the elevated session and the verified factor.
       */
      const [
        assuranceResult,
        factorResult,
      ] =
        await Promise.all([
          supabase.auth.mfa
            .getAuthenticatorAssuranceLevel(),

          supabase.auth.mfa
            .listFactors(),
        ]);

      if (
        assuranceResult.error !== null ||
        assuranceResult.data === null ||
        assuranceResult
          .data
          .currentLevel !==
          "aal2"
      ) {
        throw new Error(
          "MFA session assurance was not elevated.",
        );
      }

      if (
        factorResult.error !== null ||
        factorResult.data === null
      ) {
        throw new Error(
          "Verified MFA factor could not be confirmed.",
        );
      }

      const summary =
        summarizeSupabaseTotpFactors(
          factorResult.data.all,
        );

      if (
        !summary
          .verified_factor_ids
          .includes(
            pending.factor_id,
          )
      ) {
        throw new Error(
          "MFA factor verification could not be confirmed.",
        );
      }

      /*
       * Remove all enrollment secrets from React state immediately after
       * successful verification.
       */
      setPending(null);
      setVerificationCode("");
      setShowSecret(false);
      setHasVerifiedTotp(true);

      setIncompleteCount(
        summary
          .unverified_factor_ids
          .length,
      );

      setMessage({
        type: "success",
        text:
          "Authenticator enabled successfully.",
      });
    } catch {
      /*
       * Preserve the entered verification code only long enough for the user
       * to correct the attempt. No code or TOTP secret is logged.
       */
      setMessage({
        type: "error",
        text:
          "The authenticator code could not be verified. Check the current code and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const qrDataUrl =
    pending === null
      ? null
      : createSupabaseTotpQrDataUrl(
          pending.qr_code,
        );

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
      <h2 className="text-xl font-semibold">
        Two-Factor Authentication
      </h2>

      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Use an authenticator app to protect controlled CAPA approvals and
        other sensitive account actions.
      </p>

      {message !== null && (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-3 py-2 text-sm ${
            message.type ===
            "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : message.type ===
                  "error"
                ? "border-red-500/20 bg-red-500/10 text-red-300"
                : "border-blue-500/20 bg-blue-500/10 text-blue-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-zinc-400">
          Checking authenticator status...
        </p>
      ) : pending !== null &&
        qrDataUrl !== null ? (
        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4">
            <h3 className="font-medium text-zinc-100">
              1. Scan the QR code
            </h3>

            <p className="mt-1 text-sm text-zinc-400">
              Add this account to your authenticator app. The QR code and
              secret are shown only while setup is in progress.
            </p>

            <div className="mt-4 inline-flex rounded-2xl bg-white p-3">
              <img
                src={qrDataUrl}
                width={220}
                height={220}
                alt="QR code for LVTChat authenticator enrollment"
              />
            </div>

            <div className="mt-4">
              <label
                htmlFor="totp-secret"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Manual setup secret
              </label>

              <div className="relative">
                <input
                  id="totp-secret"
                  type={
                    showSecret
                      ? "text"
                      : "password"
                  }
                  readOnly
                  value={
                    pending.secret
                  }
                  autoComplete="off"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 pr-11 font-mono text-sm text-zinc-100 outline-none"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowSecret(
                      (value) =>
                        !value,
                    )
                  }
                  className="absolute inset-y-0 right-2 inline-flex items-center rounded-lg px-2 text-zinc-400 transition hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label={
                    showSecret
                      ? "Hide authenticator secret"
                      : "Show authenticator secret"
                  }
                >
                  {showSecret ? (
                    <EyeOff
                      size={18}
                    />
                  ) : (
                    <Eye
                      size={18}
                    />
                  )}
                </button>
              </div>
            </div>
          </div>

          <form
            onSubmit={
              verifyEnrollment
            }
            className="rounded-2xl border border-zinc-700 bg-zinc-950 p-4"
          >
            <h3 className="font-medium text-zinc-100">
              2. Verify the authenticator
            </h3>

            <label
              htmlFor="totp-verification-code"
              className="mb-2 mt-4 block text-sm font-medium text-zinc-300"
            >
              Current authenticator code
            </label>

            <input
              id="totp-verification-code"
              value={
                verificationCode
              }
              onChange={(event) =>
                setVerificationCode(
                  event.target.value,
                )
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              placeholder="Enter current code"
              disabled={busy}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
            />

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={
                  busy ||
                  verificationCode
                    .trim()
                    .length === 0
                }
                className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy
                  ? "Verifying..."
                  : "Verify authenticator"}
              </button>

              <button
                type="button"
                onClick={
                  cancelEnrollment
                }
                disabled={busy}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel setup
              </button>
            </div>
          </form>
        </div>
      ) : hasVerifiedTotp ? (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
          <p className="font-medium text-emerald-300">
            Authenticator enabled
          </p>

          <p className="mt-1 text-sm leading-6 text-emerald-200/80">
            Sensitive CAPA decisions may require a fresh authenticator
            challenge before they can be committed.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          {incompleteCount >
            0 && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              An incomplete authenticator setup was found. Restarting setup
              will remove incomplete TOTP factors before creating a new one.
            </div>
          )}

          <button
            type="button"
            onClick={
              beginEnrollment
            }
            disabled={busy}
            className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? "Starting..."
              : incompleteCount >
                  0
                ? "Restart authenticator setup"
                : "Set up authenticator"}
          </button>
        </div>
      )}
    </section>
  );
}
