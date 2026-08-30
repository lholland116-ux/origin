"use client";

import {
  type FormEvent,
  useState,
} from "react";

import type {
  CapaScopeContent,
} from "@/lib/capa/domain/capa-scope";

import {
  buildCapaScopeReviewSubmission,
  EMPTY_CAPA_SCOPE_REVIEW_DRAFT,
  type CapaScopeReviewDraft,
} from "./capa-scope-review-draft";

export interface CapaScopeReviewPanelProps {
  readonly caseNumber:
    string;

  readonly busy:
    boolean;

  readonly onReview:
    (
      scope: CapaScopeContent,
      approvalRationale: string,
    ) => void;
}

export default function CapaScopeReviewPanel({
  caseNumber,
  busy,
  onReview,
}: CapaScopeReviewPanelProps) {
  const [
    draft,
    setDraft,
  ] =
    useState<CapaScopeReviewDraft>(
      EMPTY_CAPA_SCOPE_REVIEW_DRAFT,
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  function update(
    field:
      keyof CapaScopeReviewDraft,
    value: string,
  ) {
    if (busy) {
      return;
    }

    setDraft((current) => ({
      ...current,
      [field]:
        value,
    }));
    setError(null);
  }

  function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (busy) {
      return;
    }

    const built =
      buildCapaScopeReviewSubmission(
        draft,
      );

    if (!built.valid) {
      setError(
        built.message,
      );
      return;
    }

    setError(null);

    onReview(
      built.submission.scope,
      built.submission
        .approvalRationale,
    );
  }

  return (
    <section className="mt-8 rounded-3xl border border-blue-400/20 bg-blue-500/[0.04] p-5 sm:p-7">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">
          G-01 · Human scope review
        </p>

        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
          Review and accept CAPA scope
        </h2>

        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Complete the controlled scope record for{" "}
          <span className="font-medium text-zinc-200">
            {caseNumber}
          </span>
          . AI may support analysis, but the authorized human reviewer is responsible for the scope and G-01 decision.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="mt-7 space-y-7"
      >
        <FieldGroup
          title="Problem and scope dimensions"
          description="Describe the problem without asserting an unverified root cause or solution."
        >
          <TextArea
            label="Problem statement"
            value={
              draft.problemStatement
            }
            onChange={(value) =>
              update(
                "problemStatement",
                value,
              )
            }
            rows={4}
            required
          />

          <div className="grid gap-4 md:grid-cols-2">
            <TextInput
              label="What"
              value={draft.what}
              onChange={(value) =>
                update(
                  "what",
                  value,
                )
              }
            />

            <TextInput
              label="Where"
              value={draft.where}
              onChange={(value) =>
                update(
                  "where",
                  value,
                )
              }
            />

            <TextInput
              label="When"
              value={draft.when}
              onChange={(value) =>
                update(
                  "when",
                  value,
                )
              }
            />

            <TextInput
              label="Detection method"
              value={
                draft.detectionMethod
              }
              onChange={(value) =>
                update(
                  "detectionMethod",
                  value,
                )
              }
            />
          </div>

          <TextArea
            label="Extent dimension"
            value={
              draft.extentDimension
            }
            onChange={(value) =>
              update(
                "extentDimension",
                value,
              )
            }
            rows={2}
          />
        </FieldGroup>

        <FieldGroup
          title="Affected and included scope"
          description="Use one line per controlled scope item."
        >
          <TextArea
            label="Affected scope elements"
            helper="Format: product | Product A. Valid types: product, process, site, supplier, system, other."
            value={
              draft.affectedScopeRows
            }
            onChange={(value) =>
              update(
                "affectedScopeRows",
                value,
              )
            }
            rows={4}
            required
          />

          <TextArea
            label="Included scope"
            helper="One included item per line."
            value={
              draft.includedScope
            }
            onChange={(value) =>
              update(
                "includedScope",
                value,
              )
            }
            rows={4}
            required
          />

          <TextArea
            label="Explicit exclusions"
            helper="Optional. Format: subject | rationale."
            value={
              draft.exclusionRows
            }
            onChange={(value) =>
              update(
                "exclusionRows",
                value,
              )
            }
            rows={3}
          />
        </FieldGroup>

        <FieldGroup
          title="Known extent"
          description="Document what is presently known. Do not invent missing facts."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput
              label="Magnitude"
              value={
                draft.magnitude
              }
              onChange={(value) =>
                update(
                  "magnitude",
                  value,
                )
              }
            />

            <TextInput
              label="Frequency"
              value={
                draft.frequency
              }
              onChange={(value) =>
                update(
                  "frequency",
                  value,
                )
              }
            />

            <TextInput
              label="Trend"
              value={
                draft.trend
              }
              onChange={(value) =>
                update(
                  "trend",
                  value,
                )
              }
            />

            <TextInput
              label="Affected population"
              value={
                draft.affectedPopulation
              }
              onChange={(value) =>
                update(
                  "affectedPopulation",
                  value,
                )
              }
            />
          </div>
        </FieldGroup>

        <FieldGroup
          title="Priority, timing, and applicability"
          description="These are human-entered controlled decisions. LVTChat does not autonomously assign priority or CAPA applicability."
        >
          <TextInput
            label="Organization priority"
            value={
              draft.priority
            }
            onChange={(value) =>
              update(
                "priority",
                value,
              )
            }
            required
          />

          <TextArea
            label="Target dates"
            helper="One per line. Format: Completion target | 2026-09-30."
            value={
              draft.targetDateRows
            }
            onChange={(value) =>
              update(
                "targetDateRows",
                value,
              )
            }
            rows={3}
            required
          />

          <label className="block">
            <span className="text-sm font-medium text-zinc-200">
              CAPA applicability
            </span>

            <select
              value={
                draft
                  .applicabilityDecision
              }
              disabled={busy}
              onChange={(event) =>
                update(
                  "applicabilityDecision",
                  event.target.value,
                )
              }
              className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
            >
              <option value="">
                Select human decision
              </option>

              <option value="capa_applicable">
                CAPA applicable
              </option>

              <option value="capa_not_applicable">
                CAPA not applicable
              </option>

              <option value="pending">
                Pending — not ready for G-01
              </option>
            </select>
          </label>

          <TextArea
            label="Applicability rationale"
            value={
              draft
                .applicabilityRationale
            }
            onChange={(value) =>
              update(
                "applicabilityRationale",
                value,
              )
            }
            rows={3}
            required
          />
        </FieldGroup>

        <FieldGroup
          title="Source, evidence, gaps, and escalations"
          description="G-01 remains blocked while required scope gaps or escalations are unresolved."
        >
          <TextInput
            label="Source reference"
            value={
              draft.sourceReference
            }
            onChange={(value) =>
              update(
                "sourceReference",
                value,
              )
            }
            required
          />

          <TextArea
            label="Evidence references"
            helper="Optional. One evidence reference per line."
            value={
              draft.evidenceReferences
            }
            onChange={(value) =>
              update(
                "evidenceReferences",
                value,
              )
            }
            rows={3}
          />

          <TextArea
            label="Unresolved scope gaps"
            helper="One per line. This must be empty before G-01 can be accepted."
            value={
              draft.unresolvedScopeGaps
            }
            onChange={(value) =>
              update(
                "unresolvedScopeGaps",
                value,
              )
            }
            rows={3}
          />

          <TextArea
            label="Required escalations"
            helper="Optional. Format: process | reference | resolved | rationale. Open escalations block G-01."
            value={
              draft.escalationRows
            }
            onChange={(value) =>
              update(
                "escalationRows",
                value,
              )
            }
            rows={3}
          />
        </FieldGroup>

        <FieldGroup
          title="Human G-01 rationale"
          description="State why you believe the CAPA scope is sufficiently defined to advance to containment and impact/risk assessment."
        >
          <TextArea
            label="Scope-acceptance rationale"
            value={
              draft.approvalRationale
            }
            onChange={(value) =>
              update(
                "approvalRationale",
                value,
              )
            }
            rows={4}
            required
          />
        </FieldGroup>

        {error !== null ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200"
          >
            {error}
          </div>
        ) : null}

        <div className="flex justify-end border-t border-zinc-800 pt-5">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-wait disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {busy
              ? "Processing…"
              : "Review scope for acceptance"}
          </button>
        </div>
      </form>
    </section>
  );
}

interface FieldGroupProps {
  readonly title:
    string;

  readonly description:
    string;

  readonly children:
    React.ReactNode;
}

function FieldGroup({
  title,
  description,
  children,
}: FieldGroupProps) {
  return (
    <fieldset className="rounded-2xl border border-zinc-800 bg-zinc-950/55 p-4 sm:p-5">
      <legend className="px-2 text-base font-semibold text-zinc-100">
        {title}
      </legend>

      <p className="mb-5 text-sm leading-6 text-zinc-500">
        {description}
      </p>

      <div className="space-y-4">
        {children}
      </div>
    </fieldset>
  );
}

interface TextInputProps {
  readonly label:
    string;

  readonly value:
    string;

  readonly onChange:
    (value: string) => void;

  readonly required?:
    boolean;
}

function TextInput({
  label,
  value,
  onChange,
  required = false,
}: TextInputProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-200">
        {label}
      </span>

      <input
        type="text"
        value={value}
        required={required}
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
        className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />
    </label>
  );
}

interface TextAreaProps {
  readonly label:
    string;

  readonly helper?:
    string;

  readonly value:
    string;

  readonly onChange:
    (value: string) => void;

  readonly rows:
    number;

  readonly required?:
    boolean;
}

function TextArea({
  label,
  helper,
  value,
  onChange,
  rows,
  required = false,
}: TextAreaProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-200">
        {label}
      </span>

      {helper === undefined ? null : (
        <span className="mt-1 block text-xs leading-5 text-zinc-500">
          {helper}
        </span>
      )}

      <textarea
        value={value}
        rows={rows}
        required={required}
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
        className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />
    </label>
  );
}
