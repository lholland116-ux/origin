"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import {
  createBrowserSupabaseClient,
} from "@/lib/supabase/client";

import {
  hasTimestampedTotpAuthenticationMethod,
  normalizedTotpCode,
  verifiedTotpFactorOptions,
  type SupabaseVerifiedTotpFactorOption,
} from "@/lib/security/supabase-totp-step-up-ui";

export interface FreshTotpStepUpProps {
  readonly open: boolean;

  readonly title?:
    string;

  readonly description?:
    string;

  readonly onCancel:
    () => void;

  /**
   * UX signal only.
   *
   * The caller must never treat this callback as authorization. A subsequent
   * CAPA request must still be independently authorized by the server.
   */
  readonly onVerified:
    () => void;
}

type StepUpMessage =
  | {
      readonly type:
        "error" | "info";
      readonly text:
        string;
    }
  | null;

export default function FreshTotpStepUp({
  open,
  title =
    "Confirm your identity",
  description =
    "Enter a current code from your authenticator app before continuing with this controlled CAPA action.",
  onCancel,
  onVerified,
}: FreshTotpStepUpProps) {
  const supabase =
    useMemo(
      () =>
        createBrowserSupabaseClient(),
      [],
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    verifying,
    setVerifying,
  ] = useState(false);

  const [
    factors,
    setFactors,
  ] =
    useState<
      readonly SupabaseVerifiedTotpFactorOption[]
    >([]);

  const [
    selectedFactorId,
    setSelectedFactorId,
  ] = useState("");

  const [
    code,
    setCode,
  ] = useState("");

  const [
    message,
    setMessage,
  ] =
    useState<StepUpMessage>(null);

  useEffect(() => {
    if (!open) {
      setCode("");
      setMessage(null);
      setFactors([]);
      setSelectedFactorId("");
      setLoading(false);
      setVerifying(false);
      return;
    }

    let mounted = true;

    async function loadFactors() {
      setLoading(true);
      setMessage(null);
      setCode("");

      try {
        const {
          data: {
            user,
          },
          error:
            userError,
        } =
          await supabase.auth
            .getUser();

        if (
          userError !== null ||
          user === null
        ) {
          throw new Error(
            "Authenticated user is unavailable.",
          );
        }

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
            "MFA factors are unavailable.",
          );
        }

        const available =
          verifiedTotpFactorOptions(
            data.all,
          );

        if (!mounted) {
          return;
        }

        setFactors(
          available,
        );

        if (
          available.length === 0
        ) {
          setSelectedFactorId("");
          setMessage({
            type: "info",
            text:
              "A verified authenticator is required before this controlled action can continue.",
          });
          return;
        }

        setSelectedFactorId(
          available[0].factor_id,
        );
      } catch {
        if (mounted) {
          setMessage({
            type: "error",
            text:
              "Unable to prepare the authenticator challenge. Please try again.",
          });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadFactors();

    return () => {
      mounted = false;
    };
  }, [
    open,
    supabase,
  ]);

  async function submitStepUp(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      verifying ||
      selectedFactorId.length === 0
    ) {
      return;
    }

    const normalizedCode =
      normalizedTotpCode(
        code,
      );

    if (
      normalizedCode === null
    ) {
      setMessage({
        type: "error",
        text:
          "Enter the current six-digit authenticator code.",
      });

      return;
    }

    setVerifying(true);
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
              selectedFactorId,
          });

      if (
        challengeError !== null ||
        challenge === null
      ) {
        throw new Error(
          "MFA challenge could not be created.",
        );
      }

      const {
        error:
          verifyError,
      } =
        await supabase.auth.mfa
          .verify({
            factorId:
              selectedFactorId,

            challengeId:
              challenge.id,

            code:
              normalizedCode,
          });

      /*
       * Minimize the lifetime of the user-entered authenticator code in
       * component state regardless of verification result.
       */
      setCode("");

      if (
        verifyError !== null
      ) {
        throw new Error(
          "MFA verification failed.",
        );
      }

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
          "aal2" ||
        !hasTimestampedTotpAuthenticationMethod(
          assuranceResult
            .data
            .currentAuthenticationMethods,
        )
      ) {
        throw new Error(
          "Fresh TOTP assurance could not be confirmed.",
        );
      }

      if (
        factorResult.error !== null ||
        factorResult.data === null
      ) {
        throw new Error(
          "MFA factor state could not be confirmed.",
        );
      }

      const currentFactors =
        verifiedTotpFactorOptions(
          factorResult.data.all,
        );

      if (
        !currentFactors.some(
          (factor) =>
            factor.factor_id ===
            selectedFactorId,
        )
      ) {
        throw new Error(
          "Selected MFA factor is no longer verified.",
        );
      }

      /*
       * This callback is deliberately only a client UX signal. The next
       * controlled CAPA API request must independently verify trusted
       * server-side JWT AAL/AMR recency.
       */
      onVerified();
    } catch {
      setCode("");

      setMessage({
        type: "error",
        text:
          "The authenticator challenge could not be completed. Enter a new current code and try again.",
      });
    } finally {
      setVerifying(false);
    }
  }

  if (!open) {
    return null;
  }

  const canSubmit =
    !loading &&
    !verifying &&
    selectedFactorId.length > 0 &&
    normalizedTotpCode(
      code,
    ) !== null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4"
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget &&
          !verifying
        ) {
          onCancel();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fresh-totp-step-up-heading"
        className="w-full max-w-xl rounded-3xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl sm:p-7"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
          Step-up authentication required
        </p>

        <h2
          id="fresh-totp-step-up-heading"
          className="mt-2 text-2xl font-semibold"
        >
          {title}
        </h2>

        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {description}
        </p>

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm leading-6 text-zinc-400">
          Completing this challenge confirms recent possession of your
          authenticator. The CAPA server will still independently verify
          authentication evidence before allowing the controlled action.
        </div>

        {message !== null ? (
          <div
            role={
              message.type ===
              "error"
                ? "alert"
                : "status"
            }
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
              message.type ===
              "error"
                ? "border-red-400/25 bg-red-500/10 text-red-200"
                : "border-blue-400/25 bg-blue-500/10 text-blue-200"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        {loading ? (
          <p className="mt-5 text-sm text-zinc-400">
            Preparing authenticator challenge...
          </p>
        ) : factors.length === 0 ? (
          <div className="mt-5">
            <Link
              href="/account"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              Set up authenticator
            </Link>
          </div>
        ) : (
          <form
            onSubmit={
              submitStepUp
            }
            className="mt-5 space-y-4"
          >
            {factors.length > 1 ? (
              <div>
                <label
                  htmlFor="fresh-totp-factor"
                  className="mb-2 block text-sm font-medium text-zinc-300"
                >
                  Authenticator
                </label>

                <select
                  id="fresh-totp-factor"
                  value={
                    selectedFactorId
                  }
                  disabled={
                    verifying
                  }
                  onChange={(event) => {
                    setSelectedFactorId(
                      event.target.value,
                    );
                    setCode("");
                    setMessage(null);
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
                >
                  {factors.map(
                    (factor) => (
                      <option
                        key={
                          factor.factor_id
                        }
                        value={
                          factor.factor_id
                        }
                      >
                        {
                          factor.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="fresh-totp-code"
                className="mb-2 block text-sm font-medium text-zinc-300"
              >
                Current authenticator code
              </label>

              <input
                id="fresh-totp-code"
                value={code}
                disabled={
                  verifying
                }
                onChange={(event) => {
                  setCode(
                    event.target.value,
                  );
                  setMessage(null);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                maxLength={6}
                placeholder="Enter 6-digit code"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={
                  verifying
                }
                onClick={
                  onCancel
                }
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={
                  !canSubmit
                }
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {verifying
                  ? "Verifying..."
                  : "Verify and continue"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
