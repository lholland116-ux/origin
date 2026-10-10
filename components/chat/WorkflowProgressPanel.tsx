"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatTheme } from "@/lib/chat-themes";
import type { WorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";
import {
  isWorkflowProgressTerminal,
  parseWorkflowStatusResponse,
  workflowProgressRefreshDelay,
  workflowStatusHttpFailure,
} from "@/lib/agent-runtime/workflow-progress-client";

type WorkflowProgressPanelProps = Readonly<{
  runId: string;
  conversationId: string;
  initialStatus?: WorkflowProgressDto;
  theme: ChatTheme;
  onCompleted?: () => void;
}>;

const STATUS_LABELS: Readonly<Record<WorkflowProgressDto["state"], string>> = Object.freeze({
  prepared: "Prepared",
  executing: "In progress",
  pause_requested: "Pause requested",
  paused: "Paused",
  stop_requested: "Stop requested",
  stopped: "Stopped",
  returned: "Returned for changes",
  approval_required: "Waiting for human review",
  completed: "Completed",
  failed: "Failed",
});

const STEP_LABELS: Readonly<Record<WorkflowProgressDto["steps"][number]["state"], string>> = Object.freeze({
  pending: "Pending",
  running: "In progress",
  retry_pending: "Retry pending",
  succeeded: "Completed",
  failed: "Failed",
  skipped: "Skipped",
});

function currentStep(status: WorkflowProgressDto) {
  return status.steps.find((step) => step.approvalRequired)
    ?? status.steps.find((step) => step.state === "running")
    ?? status.steps.find((step) => step.state === "retry_pending")
    ?? status.steps.find((step) => step.state === "pending");
}

export default function WorkflowProgressPanel({
  runId,
  conversationId,
  initialStatus,
  theme,
  onCompleted,
}: WorkflowProgressPanelProps) {
  const [status, setStatus] = useState<WorkflowProgressDto | null>(initialStatus ?? null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const light = theme.id === "light";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;
    let current = initialStatus ?? null;
    let failures = 0;
    let completionNotified = false;

    const notifyCompletion = (next: WorkflowProgressDto) => {
      if (next.state === "completed" && !completionNotified) {
        completionNotified = true;
        onCompletedRef.current?.();
      }
    };

    const schedule = (delay: number) => {
      if (cancelled || (current && isWorkflowProgressTerminal(current))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, delay);
    };

    const refresh = async () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const controller = new AbortController();
      activeController = controller;
      try {
        const response = await fetch(`/api/v1/agent-workflows/${encodeURIComponent(runId)}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelled) return;
        const responseFailure = workflowStatusHttpFailure(response.status);
        if (responseFailure === "reauthenticate") {
          current = null;
          if (timer) clearTimeout(timer);
          setStatus(null);
          setRefreshMessage("Sign in again to check this workflow's status.");
          return;
        }
        if (responseFailure === "unavailable") {
          current = null;
          if (timer) clearTimeout(timer);
          setStatus(null);
          setRefreshMessage("Workflow status is unavailable for this conversation.");
          return;
        }
        if (responseFailure === "retry") throw new Error("status_unavailable");
        const payload: unknown = await response.json();
        const parsed = parseWorkflowStatusResponse(payload, runId, conversationId);
        if (!parsed) {
          current = null;
          if (timer) clearTimeout(timer);
          setStatus(null);
          setRefreshMessage("Workflow status is unavailable for this conversation.");
          return;
        }
        failures = 0;
        current = parsed;
        setStatus(parsed);
        setRefreshMessage("");
        notifyCompletion(parsed);
        if (isWorkflowProgressTerminal(parsed)) {
          if (timer) clearTimeout(timer);
        } else {
          schedule(workflowProgressRefreshDelay(parsed, failures));
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        setRefreshMessage("Status could not be refreshed. Retrying automatically.");
        schedule(workflowProgressRefreshDelay(current, failures));
      }
    };

    if (initialStatus) {
      notifyCompletion(initialStatus);
      if (!isWorkflowProgressTerminal(initialStatus)) {
        schedule(workflowProgressRefreshDelay(initialStatus, 0));
        void refresh();
      }
    } else {
      void refresh();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      activeController?.abort();
    };
  }, [runId, conversationId, initialStatus]);

  const active = status ? currentStep(status) : undefined;

  return (
    <section
      aria-label="Workflow progress"
      className={`mt-3 min-w-0 rounded-xl border p-3 sm:p-4 ${theme.panelBg} ${theme.panelBorder}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className={`text-sm font-semibold ${light ? "text-slate-900" : "text-white"}`}>
          Workflow progress
        </h3>
        {status ? (
          <span
            className={`rounded-full border border-blue-400/30 bg-blue-400/10 px-2.5 py-1 text-xs font-medium ${light ? "text-blue-700" : "text-blue-200"}`}
            aria-live="polite"
          >
            {STATUS_LABELS[status.state]}
          </span>
        ) : null}
      </div>

      {!status ? (
        <p className={`mt-2 text-sm ${theme.mutedText}`} aria-live="polite">
          {refreshMessage || "Loading workflow status…"}
        </p>
      ) : (
        <>
          <p className={`mt-2 text-sm ${theme.mutedText}`}>
            {status.completedStepCount} of {status.totalStepCount} steps completed or skipped.
          </p>
          {active ? (
            <p className={`mt-1 text-sm ${light ? "text-slate-700" : "text-zinc-200"}`}>
              Current step: {active.capabilityLabel}
              {active.approvalRequired ? " — waiting for human review" : ""}
            </p>
          ) : null}

          <ol aria-label="Workflow steps" className="mt-3 space-y-2">
            {status.steps.map((step, index) => (
              <li
                key={step.id}
                aria-current={active?.id === step.id ? "step" : undefined}
                className={`flex min-w-0 items-start justify-between gap-3 rounded-lg border px-3 py-2 ${
                  active?.id === step.id
                    ? "border-blue-400/40 bg-blue-400/[0.08]"
                    : "border-current/10"
                }`}
              >
                <span className={`min-w-0 break-words text-sm ${light ? "text-slate-800" : "text-zinc-100"}`}>
                  <span className="mr-1.5 text-xs opacity-60">Step {index + 1}</span>
                  {step.capabilityLabel}
                </span>
                <span className={`shrink-0 text-xs ${theme.mutedText}`}>
                  {step.approvalRequired ? "Human review required" : STEP_LABELS[step.state]}
                </span>
              </li>
            ))}
          </ol>

          {status.recoveryRequired ? (
            <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.08] p-3 text-sm text-amber-800 dark:text-amber-200" role="status">
              Recovery is required before this workflow can safely continue. No automatic restart was attempted.
            </p>
          ) : status.failurePresent ? (
            <p className="mt-3 text-sm text-amber-800 dark:text-amber-200" role="status">
              A workflow step reported a failure.
            </p>
          ) : null}

          {status.state === "completed" ? (
            <p className={`mt-3 text-sm ${theme.mutedText}`}>
              The final response and any available files are attached to this assistant message.
            </p>
          ) : null}

          {refreshMessage ? (
            <p className={`mt-3 text-xs ${theme.mutedText}`} role="status">{refreshMessage}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
