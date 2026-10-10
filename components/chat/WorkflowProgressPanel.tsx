"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatTheme } from "@/lib/chat-themes";
import type { WorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";
import {
  isWorkflowProgressTerminal,
  parseWorkflowStatusResponse,
  workflowProgressRefreshDelay,
  workflowProgressControls,
  workflowStatusHttpFailure,
  validateWorkflowReturnRationale,
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
  const [actionMessage, setActionMessage] = useState("");
  const [awaitingAuthoritativeStatus, setAwaitingAuthoritativeStatus] = useState(false);
  const [returnRationale, setReturnRationale] = useState("");
  const [rationaleError, setRationaleError] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionLock = useRef(false);
  const refreshStatusRef = useRef<() => Promise<WorkflowProgressDto | null>>(async () => null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const light = theme.id === "light";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;
    let current = initialStatus ?? null;
    setStatus(current);
    setActionMessage("");
    setAwaitingAuthoritativeStatus(false);
    setRefreshMessage("");
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

    const refresh = async (): Promise<WorkflowProgressDto | null> => {
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
        if (cancelled) return null;
        const responseFailure = workflowStatusHttpFailure(response.status);
        if (responseFailure === "reauthenticate") {
          current = null;
          if (timer) clearTimeout(timer);
          setStatus(null);
          setRefreshMessage("Sign in again to check this workflow's status.");
          return null;
        }
        if (responseFailure === "unavailable") {
          current = null;
          if (timer) clearTimeout(timer);
          setStatus(null);
          setRefreshMessage("Workflow status is unavailable for this conversation.");
          return null;
        }
        if (responseFailure === "retry") throw new Error("status_unavailable");
        const payload: unknown = await response.json();
        const parsed = parseWorkflowStatusResponse(payload, runId, conversationId);
        if (!parsed) {
          current = null;
          if (timer) clearTimeout(timer);
          setStatus(null);
          setRefreshMessage("Workflow status is unavailable for this conversation.");
          return null;
        }
        failures = 0;
        current = parsed;
        setStatus(parsed);
        setAwaitingAuthoritativeStatus(false);
        setRefreshMessage("");
        notifyCompletion(parsed);
        if (isWorkflowProgressTerminal(parsed)) {
          if (timer) clearTimeout(timer);
        } else {
          schedule(workflowProgressRefreshDelay(parsed, failures));
        }
        return parsed;
      } catch {
        if (cancelled) return null;
        failures += 1;
        setRefreshMessage("Status could not be refreshed. Retrying automatically.");
        schedule(workflowProgressRefreshDelay(current, failures));
        return null;
      }
    };
    refreshStatusRef.current = refresh;

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
      refreshStatusRef.current = async () => null;
    };
  }, [runId, conversationId, initialStatus]);

  const performAction = async (action: "pause" | "resume" | "stop" | "approve" | "return", checkpointId?: string) => {
    if (!status || awaitingAuthoritativeStatus || actionLock.current) return;
    let rationale: string | undefined;
    if (action === "return") {
      const validationError = validateWorkflowReturnRationale(returnRationale);
      if (validationError) {
        setRationaleError(validationError);
        return;
      }
      rationale = returnRationale.trim();
      if (!window.confirm("Return this checkpoint for changes? The workflow will stop at this checkpoint.")) return;
    }
    if (action === "stop" && !window.confirm("Stop this workflow? It will not continue automatically.")) return;

    actionLock.current = true;
    setAwaitingAuthoritativeStatus(true);
    setPendingAction(action);
    setActionMessage("");
    setRationaleError("");
    try {
      const response = await fetch(action === "approve" || action === "return"
        ? `/api/v1/agent-workflows/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(checkpointId ?? "")}`
        : `/api/v1/agent-workflows/${encodeURIComponent(runId)}/controls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(action === "approve" || action === "return"
          ? { decision: action, expectedControlRevision: status.controlRevision, ...(rationale ? { rationale } : {}) }
          : { action, expectedControlRevision: status.controlRevision }),
      });
      let payload: unknown = null;
      try { payload = await response.json(); } catch { /* The authoritative status fetch below resolves the current view. */ }
      const updated = parseWorkflowStatusResponse(payload, runId, conversationId);
      if (response.ok && updated) {
        setStatus(updated);
        setAwaitingAuthoritativeStatus(false);
        setActionMessage(action === "pause" ? "Pause requested."
          : action === "resume" ? "Workflow resumed."
            : action === "stop" ? "Stop requested."
              : action === "approve" ? "Checkpoint approved."
                : "Checkpoint returned for changes.");
        if (action === "return") setReturnRationale("");
      } else {
        const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const errorValue = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
        const code = typeof errorValue.code === "string" ? errorValue.code : "";
        setActionMessage(code === "revision_conflict" ? "Workflow status changed. The latest status has been refreshed; review it before trying again."
          : code === "authorization_denied" ? "Current permissions do not allow this action."
            : code === "authorization_unavailable" ? "Current permissions could not be verified. Try again after status refresh."
              : code === "unsafe_boundary" ? "The workflow needs recovery before this action can continue."
                : code === "invalid_transition" ? "This action is no longer available for the current workflow state."
                  : response.ok ? "The action response could not be verified. The latest status has been refreshed."
                    : `The action was not completed (${response.status}). The latest status has been refreshed.`);
      }
    } catch {
      setActionMessage("The result could not be confirmed. The action was not retried; check the refreshed workflow status.");
    } finally {
      await refreshStatusRef.current();
      actionLock.current = false;
      setPendingAction(null);
    }
  };

  const active = status ? currentStep(status) : undefined;
  const controls = status ? workflowProgressControls(status) : null;

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

          {awaitingAuthoritativeStatus ? <p className={`mt-3 text-sm ${theme.mutedText}`} role="status" aria-live="polite">Controls are paused until the latest workflow status can be confirmed.</p> : null}

          {!awaitingAuthoritativeStatus && controls && (controls.pause || controls.resume || controls.stop || controls.approvalCheckpointId) ? (
            <div className="mt-4 min-w-0 space-y-3 border-t border-current/10 pt-3">
              <div className="flex min-w-0 flex-wrap gap-2">
                {controls.pause ? <button type="button" disabled={pendingAction !== null} onClick={() => void performAction("pause")} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.panelBorder} ${light ? "text-slate-800" : "text-zinc-100"}`}> {pendingAction === "pause" ? "Pausing…" : "Pause workflow"}</button> : null}
                {controls.resume ? <button type="button" disabled={pendingAction !== null} onClick={() => void performAction("resume")} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.panelBorder} ${light ? "text-slate-800" : "text-zinc-100"}`}>{pendingAction === "resume" ? "Resuming…" : "Resume workflow"}</button> : null}
                {controls.approvalCheckpointId ? <>
                  <button type="button" disabled={pendingAction !== null} onClick={() => void performAction("approve", controls.approvalCheckpointId ?? undefined)} className="min-h-10 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{pendingAction === "approve" ? "Approving…" : "Approve checkpoint"}</button>
                  <button type="button" disabled={pendingAction !== null} onClick={() => void performAction("return", controls.approvalCheckpointId ?? undefined)} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.panelBorder} ${light ? "text-slate-800" : "text-zinc-100"}`}>{pendingAction === "return" ? "Returning…" : "Return for changes"}</button>
                </> : null}
                {controls.stop ? <button type="button" disabled={pendingAction !== null} onClick={() => void performAction("stop")} className="min-h-10 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-red-200">{pendingAction === "stop" ? "Stopping…" : "Stop workflow"}</button> : null}
              </div>
              {controls.approvalCheckpointId ? (
                <div className="min-w-0">
                  <label htmlFor={`workflow-return-${runId}`} className={`mb-1 block text-sm font-medium ${light ? "text-slate-800" : "text-zinc-100"}`}>Reason for returning</label>
                  <textarea id={`workflow-return-${runId}`} value={returnRationale} onChange={(event) => { setReturnRationale(event.target.value); setRationaleError(""); }} maxLength={1000} rows={3} aria-invalid={Boolean(rationaleError)} aria-describedby={`workflow-return-help-${runId}`} disabled={pendingAction !== null} className={`w-full min-w-0 resize-y rounded-lg border bg-transparent px-3 py-2 text-sm disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.panelBorder} ${light ? "text-slate-900" : "text-white"}`} />
                  <p id={`workflow-return-help-${runId}`} className={`text-xs ${rationaleError ? "text-red-700 dark:text-red-300" : theme.mutedText}`} aria-live="polite">{rationaleError || `${returnRationale.trim().length}/1,000 characters. A reason is required to return this checkpoint.`}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {actionMessage ? <p className={`mt-3 text-sm ${theme.mutedText}`} role="status" aria-live="polite">{actionMessage}</p> : null}

          {refreshMessage ? (
            <p className={`mt-3 text-xs ${theme.mutedText}`} role="status">{refreshMessage}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
