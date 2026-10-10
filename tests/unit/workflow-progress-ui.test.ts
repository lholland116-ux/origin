import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorkflowProgressPanel from "@/components/chat/WorkflowProgressPanel";
import { getChatThemeById } from "@/lib/chat-themes";
import type { WorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";
import {
  isWorkflowFeatureDisabledResponse,
  isWorkflowProgressTerminal,
  parseAcceptedWorkflowStart,
  parseWorkflowStatusResponse,
  readWorkflowTrackingRecords,
  saveWorkflowTrackingRecord,
  shouldPrepareMultiStepWorkflow,
  workflowProgressRefreshDelay,
  workflowStatusHttpFailure,
  WORKFLOW_PROGRESS_MAX_REFRESH_MS,
  WORKFLOW_PROGRESS_REFRESH_MS,
  WORKFLOW_PROGRESS_STORAGE_KEY,
  WORKFLOW_PROGRESS_WAIT_REFRESH_MS,
} from "@/lib/agent-runtime/workflow-progress-client";
import { reconcileAcceptedWorkflowMessages } from "@/app/chat/ChatClient";

const RUN = "e4000000-0000-4000-8000-000000000001";
const CONVERSATION = "e4000000-0000-4000-8000-000000000002";
const USER_MESSAGE = "e4000000-0000-4000-8000-000000000003";
const ASSISTANT_MESSAGE = "e4000000-0000-4000-8000-000000000004";
const REQUEST = "e4000000-0000-4000-8000-000000000005";
const IDEMPOTENCY = "e4000000-0000-4000-8000-000000000006";

function status(overrides: Partial<WorkflowProgressDto> = {}): WorkflowProgressDto {
  return {
    schemaVersion: 1,
    runId: RUN,
    conversationId: CONVERSATION,
    state: "executing",
    controlState: "active",
    controlRevision: 0,
    createdAt: "2026-10-09T12:00:00.000Z",
    completedStepCount: 1,
    totalStepCount: 3,
    failurePresent: false,
    recoveryRequired: false,
    approvalCheckpoints: [],
    steps: [
      { id: "private-step-id", capabilityLabel: "Web search", state: "succeeded", approvalRequired: false },
      { id: "review", capabilityLabel: "Answer", state: "running", approvalRequired: false },
      { id: "report", capabilityLabel: "Document creation", state: "pending", approvalRequired: false },
    ],
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("workflow progress UI contract", () => {
  it("renders persisted status, current/completed/pending steps, and no invented percentage", () => {
    const markup = renderToStaticMarkup(createElement(WorkflowProgressPanel, {
      runId: RUN,
      conversationId: CONVERSATION,
      initialStatus: status(),
      theme: getChatThemeById("midnight-blue"),
    }));
    expect(markup).toContain("Workflow progress");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Current step: Answer");
    expect(markup).toContain("1 of 3 steps completed or skipped");
    expect(markup).toContain("Web search");
    expect(markup).toContain("Document creation");
    expect(markup).toContain("Pending");
    expect(markup).toContain('aria-label="Workflow steps"');
    expect(markup).not.toContain("%");
    expect(markup).not.toContain("private-step-id");
    expect(markup).toContain("min-w-0");
    expect(markup).toContain("sm:p-4");
  });

  it("labels human review and recovery states without exposing internal failure details", () => {
    const awaitingReview = renderToStaticMarkup(createElement(WorkflowProgressPanel, {
      runId: RUN,
      conversationId: CONVERSATION,
      initialStatus: status({
        state: "approval_required",
        failurePresent: true,
        recoveryRequired: true,
        steps: [{ id: "review", capabilityLabel: "Answer", state: "running", approvalRequired: true }],
        totalStepCount: 1,
        completedStepCount: 0,
      }),
      theme: getChatThemeById("light"),
    }));
    expect(awaitingReview).toContain("Waiting for human review");
    expect(awaitingReview).toContain("Human review required");
    expect(awaitingReview).toContain("Recovery is required");
    expect(awaitingReview).not.toContain("failureCode");

    const completed = renderToStaticMarkup(createElement(WorkflowProgressPanel, {
      runId: RUN,
      conversationId: CONVERSATION,
      initialStatus: status({
        state: "completed",
        completedStepCount: 1,
        totalStepCount: 1,
        steps: [{ id: "final", capabilityLabel: "Answer", state: "succeeded", approvalRequired: false }],
      }),
      theme: getChatThemeById("midnight-blue"),
    }));
    expect(completed).toContain("Completed");
    expect(completed).toContain("final response and any available files are attached to this assistant message");
  });

  it("starts only eligible Auto multi-step candidates and preserves explicit web/image modes", () => {
    const message = "Research current guidance and create a PDF report.";
    expect(shouldPrepareMultiStepWorkflow({ message, webSearchOverride: false, imageGeneration: false })).toBe(true);
    expect(shouldPrepareMultiStepWorkflow({ message: "Create a PDF report.", webSearchOverride: false, imageGeneration: false })).toBe(false);
    expect(shouldPrepareMultiStepWorkflow({ message, webSearchOverride: true, imageGeneration: false })).toBe(false);
    expect(shouldPrepareMultiStepWorkflow({ message, webSearchOverride: false, imageGeneration: true })).toBe(false);
  });

  it("falls back only for the explicit pre-acceptance feature-disabled response", () => {
    expect(isWorkflowFeatureDisabledResponse(404, { error: { code: "feature_disabled" } })).toBe(true);
    expect(isWorkflowFeatureDisabledResponse(404, { error: { code: "not_found" } })).toBe(false);
    expect(isWorkflowFeatureDisabledResponse(503, { error: { code: "feature_disabled" } })).toBe(false);
  });

  it("validates accepted identity and rejects status from a different run or conversation", () => {
    const accepted = parseAcceptedWorkflowStart({
      accepted: true,
      acceptedRequest: { requestId: REQUEST, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE, idempotencyKey: IDEMPOTENCY },
      status: status(),
    }, CONVERSATION, IDEMPOTENCY);
    expect(accepted?.acceptedRequest.assistantMessageId).toBe(ASSISTANT_MESSAGE);
    expect(parseAcceptedWorkflowStart({
      accepted: true,
      acceptedRequest: { requestId: REQUEST, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE, idempotencyKey: IDEMPOTENCY },
      status: status({ conversationId: "e4000000-0000-4000-8000-000000000099" }),
    }, CONVERSATION, IDEMPOTENCY)).toBeNull();
    expect(parseWorkflowStatusResponse({ status: status() }, RUN, CONVERSATION)?.runId).toBe(RUN);
    expect(parseWorkflowStatusResponse({ status: status({ conversationId: "e4000000-0000-4000-8000-000000000099" }) }, RUN, CONVERSATION)).toBeNull();
    expect(parseWorkflowStatusResponse({ status: status() }, "e4000000-0000-4000-8000-000000000099", CONVERSATION)).toBeNull();
  });

  it("recovers only lightweight run/message identifiers after refresh and deduplicates acceptance replays", () => {
    const storage = memoryStorage();
    const record = { runId: RUN, conversationId: CONVERSATION, assistantMessageId: ASSISTANT_MESSAGE };
    expect(saveWorkflowTrackingRecord(storage, record)).toBe(true);
    expect(saveWorkflowTrackingRecord(storage, record)).toBe(true);
    expect(readWorkflowTrackingRecords(storage, CONVERSATION)).toEqual([record]);
    expect(readWorkflowTrackingRecords(storage, "e4000000-0000-4000-8000-000000000099")).toEqual([]);
    expect(storage.getItem(WORKFLOW_PROGRESS_STORAGE_KEY)).not.toContain("private prompt");
  });

  it("reconciles accepted messages onto the server-bound assistant destination exactly once", () => {
    const messages = [
      { id: "optimistic-user", role: "user" as const, content: "request" },
      { id: "optimistic-assistant", role: "assistant" as const, content: "" },
      { id: ASSISTANT_MESSAGE, role: "assistant" as const, content: "already hydrated" },
    ];
    const reconciled = reconcileAcceptedWorkflowMessages(messages, "optimistic-user", "optimistic-assistant", {
      userMessageId: USER_MESSAGE,
      assistantMessageId: ASSISTANT_MESSAGE,
    });
    expect(reconciled.map(({ id }) => id)).toEqual([USER_MESSAGE, ASSISTANT_MESSAGE]);
    expect(reconciled[1]?.content).toBe("");
  });

  it("slows human-wait polling, backs off transient failures, and stops for terminal or recovery states", () => {
    expect(workflowProgressRefreshDelay(status(), 0)).toBe(WORKFLOW_PROGRESS_REFRESH_MS);
    expect(workflowProgressRefreshDelay(status({ state: "approval_required" }), 0)).toBe(WORKFLOW_PROGRESS_WAIT_REFRESH_MS);
    expect(workflowProgressRefreshDelay(status(), 4)).toBe(WORKFLOW_PROGRESS_MAX_REFRESH_MS);
    expect(isWorkflowProgressTerminal(status({ state: "completed" }))).toBe(true);
    expect(isWorkflowProgressTerminal(status({ state: "executing", recoveryRequired: true }))).toBe(true);
    expect(isWorkflowProgressTerminal(status())).toBe(false);
    expect(workflowStatusHttpFailure(401)).toBe("reauthenticate");
    expect(workflowStatusHttpFailure(404)).toBe("unavailable");
    expect(workflowStatusHttpFailure(503)).toBe("retry");
    expect(workflowStatusHttpFailure(200)).toBeNull();
  });
});
