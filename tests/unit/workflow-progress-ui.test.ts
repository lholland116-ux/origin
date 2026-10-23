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
  removeWorkflowTrackingRecord,
  removeWorkflowTrackingRecords,
  saveWorkflowTrackingRecord,
  selectWorkflowPanelRecords,
  shouldPrepareMultiStepWorkflow,
  isFinalizedWorkflowAssistantMessageVisible,
  isFinalizedWorkflowDeliveryVisible,
  createWorkflowProgressTimer,
  createWorkflowStatusRequestGeneration,
  synchronizeFinalizedWorkflowDelivery,
  upsertWorkflowTrackingRecords,
  workflowProgressRefreshDelay,
  workflowProgressControls,
  workflowStatusHttpFailure,
  validateWorkflowReturnRationale,
  WORKFLOW_FINAL_DELIVERY_SYNC_ATTEMPTS,
  WORKFLOW_FINAL_DELIVERY_SYNC_DELAY_MS,
  WORKFLOW_PROGRESS_MAX_REFRESH_MS,
  WORKFLOW_PROGRESS_REFRESH_MS,
  WORKFLOW_PROGRESS_STORAGE_KEY,
  WORKFLOW_PROGRESS_WAIT_REFRESH_MS,
} from "@/lib/agent-runtime/workflow-progress-client";
import { reconcileAcceptedWorkflowMessages } from "@/app/chat/ChatClient";
import { createPendingAssistantMessageContent, omitPendingAssistantMessages } from "@/lib/chat/request-message-visibility";

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

  it("keeps a single PDF request on chat while preserving the unsupported research-to-PDF workflow boundary", () => {
    expect(shouldPrepareMultiStepWorkflow({
      message: "Create a PDF summary of this conversation.",
      webSearchOverride: false,
      imageGeneration: false,
    })).toBe(false);

    expect(shouldPrepareMultiStepWorkflow({
      message: "Generate a PDF of current Atlanta news with three key bullets.",
      webSearchOverride: false,
      imageGeneration: false,
    })).toBe(true);
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
    expect(completed).toContain("final response and any available files are being synchronized to this conversation");
  });

  it("shows controls only for backend-supported states and validates return rationale", () => {
    expect(workflowProgressControls(status())).toEqual({ pause: true, resume: false, stop: true, approvalCheckpointId: null });
    expect(workflowProgressControls(status({ state: "paused", controlState: "paused" }))).toEqual({ pause: false, resume: true, stop: true, approvalCheckpointId: null });
    const checkpoint = "e4000000-0000-4000-8000-000000000007";
    expect(workflowProgressControls(status({
      state: "approval_required",
      approvalCheckpoints: [{ id: checkpoint, stepId: "review", state: "pending" }],
    }))).toEqual({ pause: false, resume: false, stop: true, approvalCheckpointId: checkpoint });
    expect(workflowProgressControls(status({
      state: "approval_required",
      controlState: "stop_requested",
      approvalCheckpoints: [{ id: checkpoint, stepId: "review", state: "pending" }],
    })).approvalCheckpointId).toBeNull();
    expect(workflowProgressControls(status({ state: "completed" }))).toEqual({ pause: false, resume: false, stop: false, approvalCheckpointId: null });
    expect(workflowProgressControls(status({ state: "executing", recoveryRequired: true }))).toEqual({ pause: false, resume: false, stop: true, approvalCheckpointId: null });
    expect(validateWorkflowReturnRationale("  ")).toContain("reason");
    expect(validateWorkflowReturnRationale("Please revise the sources.")).toBeNull();
    expect(validateWorkflowReturnRationale("x".repeat(1001))).toContain("1,000");
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

  it("keeps accepted workflows visible when pending assistant destinations are omitted", () => {
    const accepted = parseAcceptedWorkflowStart({
      accepted: true,
      acceptedRequest: { requestId: REQUEST, userMessageId: USER_MESSAGE, assistantMessageId: ASSISTANT_MESSAGE, idempotencyKey: IDEMPOTENCY },
      status: status(),
    }, CONVERSATION, IDEMPOTENCY);
    expect(accepted).not.toBeNull();
    if (!accepted) return;

    const tracking = {
      runId: accepted.status.runId,
      conversationId: accepted.status.conversationId,
      assistantMessageId: accepted.acceptedRequest.assistantMessageId,
    };
    const acceptedTracking = upsertWorkflowTrackingRecords([], tracking);
    expect(acceptedTracking).toEqual([tracking]);
    const conversationMessages = omitPendingAssistantMessages([
      { id: USER_MESSAGE, role: "user", content: "request" },
      { id: ASSISTANT_MESSAGE, role: "assistant", content: createPendingAssistantMessageContent(REQUEST, USER_MESSAGE) },
    ]);
    expect(conversationMessages.map((message) => message.id)).toEqual([USER_MESSAGE]);

    // This is the same selector ChatClient uses after acceptance refresh and on reload.
    expect(selectWorkflowPanelRecords(acceptedTracking, CONVERSATION, conversationMessages).conversationHosted)
      .toEqual([tracking]);
  });

  it("restores only the active conversation's panels and avoids duplicates when the assistant row is visible", () => {
    const first = { runId: RUN, conversationId: CONVERSATION, assistantMessageId: ASSISTANT_MESSAGE };
    const otherConversation = {
      ...first,
      runId: "e4000000-0000-4000-8000-000000000011",
      conversationId: "e4000000-0000-4000-8000-000000000012",
    };
    const storage = memoryStorage();
    expect(saveWorkflowTrackingRecord(storage, first)).toBe(true);
    expect(saveWorkflowTrackingRecord(storage, otherConversation)).toBe(true);

    const restored = readWorkflowTrackingRecords(storage, CONVERSATION);
    expect(selectWorkflowPanelRecords(restored, CONVERSATION, []).conversationHosted).toEqual([first]);
    expect(selectWorkflowPanelRecords([first, otherConversation], otherConversation.conversationId, []).conversationHosted)
      .toEqual([otherConversation]);
    expect(selectWorkflowPanelRecords([first, first], CONVERSATION, []).conversationHosted).toEqual([first]);
    expect(selectWorkflowPanelRecords([
      first,
      { ...first, assistantMessageId: "e4000000-0000-4000-8000-000000000013" },
    ], CONVERSATION, []).conversationHosted).toEqual([first]);

    const visible = [{ id: ASSISTANT_MESSAGE, role: "assistant", content: "Final answer" }];
    expect(selectWorkflowPanelRecords([first], CONVERSATION, visible)).toEqual({
      messageHosted: [first],
      conversationHosted: [],
    });
    expect(selectWorkflowPanelRecords([first], "not-a-conversation-id", []).conversationHosted).toEqual([]);
  });

  it("retires a completed panel only after the original finalized assistant message is visible", () => {
    const record = { runId: RUN, conversationId: CONVERSATION, assistantMessageId: ASSISTANT_MESSAGE };
    const pending = [{
      id: ASSISTANT_MESSAGE,
      role: "assistant",
      content: createPendingAssistantMessageContent(REQUEST, USER_MESSAGE),
    }];
    expect(isFinalizedWorkflowAssistantMessageVisible(record, pending)).toBe(false);

    const finalized = [{ id: ASSISTANT_MESSAGE, role: "assistant", content: "Final answer" }];
    expect(isFinalizedWorkflowAssistantMessageVisible(record, finalized)).toBe(true);
    const remaining = removeWorkflowTrackingRecords([record], record);
    expect(remaining).toEqual([]);
    expect(selectWorkflowPanelRecords(remaining, CONVERSATION, finalized)).toEqual({
      messageHosted: [],
      conversationHosted: [],
    });
    expect(finalized).toHaveLength(1);

    const storage = memoryStorage();
    expect(saveWorkflowTrackingRecord(storage, record)).toBe(true);
    expect(removeWorkflowTrackingRecord(storage, record)).toBe(true);
    expect(readWorkflowTrackingRecords(storage, CONVERSATION)).toEqual([]);
  });

  it("keeps a completed document workflow pending until its finalized message and attached document are hydrated", async () => {
    const record = { runId: RUN, conversationId: CONVERSATION, assistantMessageId: ASSISTANT_MESSAGE };
    const finalized = { id: ASSISTANT_MESSAGE, role: "assistant", content: "Your requested document is ready." };
    const wrongBinding = {
      ...finalized,
      generatedDocuments: [{ id: "e4000000-0000-4000-8000-000000000007", messageId: ASSISTANT_MESSAGE, conversationId: REQUEST }],
    };
    const delivered = {
      ...finalized,
      generatedDocuments: [{ id: "e4000000-0000-4000-8000-000000000007", messageId: ASSISTANT_MESSAGE, conversationId: CONVERSATION }],
    };

    expect(isFinalizedWorkflowDeliveryVisible(record, [finalized], true)).toBe(false);
    expect(isFinalizedWorkflowDeliveryVisible(record, [wrongBinding], true)).toBe(false);
    expect(isFinalizedWorkflowDeliveryVisible(record, [delivered], true)).toBe(true);

    const snapshots = [[], [finalized], [delivered]];
    const waitCalls: number[] = [];
    let lastApplied: typeof snapshots[number] = [];
    const synchronized = await synchronizeFinalizedWorkflowDelivery({
      refresh: async () => {
        lastApplied = snapshots.shift() ?? [];
        return isFinalizedWorkflowDeliveryVisible(record, lastApplied, true);
      },
      shouldContinue: () => true,
      wait: async (delay) => { waitCalls.push(delay); },
    });

    expect(synchronized).toBe(true);
    expect(waitCalls).toEqual([WORKFLOW_FINAL_DELIVERY_SYNC_DELAY_MS, WORKFLOW_FINAL_DELIVERY_SYNC_DELAY_MS]);
    expect(lastApplied.filter((message) => message.id === ASSISTANT_MESSAGE)).toHaveLength(1);
  });

  it("bounds completion-message refreshes and cancels them after a conversation switch", async () => {
    let attempts = 0;
    let waits = 0;
    const boundedResult = await synchronizeFinalizedWorkflowDelivery({
      refresh: async () => { attempts += 1; return false; },
      shouldContinue: () => true,
      wait: async () => { waits += 1; },
    });
    expect(boundedResult).toBe(false);
    expect(attempts).toBe(WORKFLOW_FINAL_DELIVERY_SYNC_ATTEMPTS);
    expect(waits).toBe(WORKFLOW_FINAL_DELIVERY_SYNC_ATTEMPTS - 1);

    attempts = 0;
    let active = true;
    const switchedResult = await synchronizeFinalizedWorkflowDelivery({
      refresh: async () => { attempts += 1; return false; },
      shouldContinue: () => active,
      wait: async () => { active = false; },
    });
    expect(switchedResult).toBe(false);
    expect(attempts).toBe(1);
  });

  it("rejects malformed tracking records and preserves ordinary message visibility", () => {
    const valid = { runId: RUN, conversationId: CONVERSATION, assistantMessageId: ASSISTANT_MESSAGE };
    const malformed = { ...valid, runId: "not-a-run-id" };
    expect(selectWorkflowPanelRecords([malformed, valid], CONVERSATION, []).conversationHosted).toEqual([valid]);

    const messages = omitPendingAssistantMessages([
      { id: USER_MESSAGE, role: "user", content: "ordinary user turn" },
      { id: ASSISTANT_MESSAGE, role: "assistant", content: "ordinary assistant turn" },
      { id: REQUEST, role: "assistant", content: createPendingAssistantMessageContent(REQUEST, USER_MESSAGE) },
    ]);
    expect(messages.map(({ content }) => content)).toEqual(["ordinary user turn", "ordinary assistant turn"]);
  });

  it("invalidates stale status responses and clears scheduled polling on cleanup", () => {
    const generation = createWorkflowStatusRequestGeneration();
    const stale = generation.begin();
    const latest = generation.begin();
    expect(generation.isCurrent(stale)).toBe(false);
    expect(generation.isCurrent(latest)).toBe(true);
    generation.invalidate();
    expect(generation.isCurrent(latest)).toBe(false);

    let nextId = 0;
    const activeTimers = new Set<number>();
    const timer = createWorkflowProgressTimer(
      (callback) => {
        void callback;
        const id = ++nextId;
        activeTimers.add(id);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      (handle) => { activeTimers.delete(handle as unknown as number); },
    );
    timer.schedule(() => undefined, WORKFLOW_PROGRESS_REFRESH_MS);
    expect(timer.isPending()).toBe(true);
    expect(activeTimers.size).toBe(1);
    timer.clear();
    expect(timer.isPending()).toBe(false);
    expect(activeTimers.size).toBe(0);
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
