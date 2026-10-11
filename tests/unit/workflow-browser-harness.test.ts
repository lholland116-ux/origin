import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_A,
  CONVERSATION_A,
  CONVERSATION_B,
  RUN_A,
  createSyntheticWorkflowApi,
} from "@/tests/browser-harness/src/synthetic-api";
import { parseWorkflowStatusResponse, selectWorkflowPanelRecords } from "@/lib/agent-runtime/workflow-progress-client";

const origin = "http://127.0.0.1:4173";

function installHarnessWindow() {
  vi.stubGlobal("window", {
    location: { origin },
    setTimeout: (callback: TimerHandler, delay?: number) => setTimeout(callback, delay),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("isolated workflow browser harness API", () => {
  it("returns only production-validator-approved status and rejects unknown targets without forwarding", async () => {
    installHarnessWindow();
    const api = createSyntheticWorkflowApi();
    const response = await api.fetch(`${origin}/api/v1/agent-workflows/${RUN_A}`);
    const payload = await response.json();
    expect(parseWorkflowStatusResponse(payload, RUN_A, CONVERSATION_A)?.runId).toBe(RUN_A);

    await expect(api.fetch("https://example.invalid/api/v1/agent-workflows/x")).rejects.toThrow("blocks all non-origin requests");
    await expect(api.fetch(`${origin}/api/chat`, { method: "POST", body: "{}" })).rejects.toThrow("no proxy or fallback");
    expect(api.getRequestCount()).toBe(1);
    expect(api.getEvents().some((event) => event.kind === "blocked")).toBe(true);
  });

  it("applies pause and resume through revision-bound synthetic requests", async () => {
    installHarnessWindow();
    const api = createSyntheticWorkflowApi();
    api.setScenario(CONVERSATION_B, "prepared");
    const before = api.getStatus(CONVERSATION_B);
    const pause = await api.fetch(`${origin}/api/v1/agent-workflows/${before.runId}/controls`, {
      method: "POST",
      body: JSON.stringify({ action: "pause", expectedControlRevision: before.controlRevision }),
    });
    expect(pause.status).toBe(200);
    expect(api.getStatus(CONVERSATION_B)).toMatchObject({ state: "paused", controlState: "paused", controlRevision: before.controlRevision + 1 });

    const paused = api.getStatus(CONVERSATION_B);
    const resume = await api.fetch(`${origin}/api/v1/agent-workflows/${paused.runId}/controls`, {
      method: "POST",
      body: JSON.stringify({ action: "resume", expectedControlRevision: paused.controlRevision }),
    });
    expect(resume.status).toBe(200);
    expect(api.getStatus(CONVERSATION_B)).toMatchObject({ state: "executing", controlState: "active", controlRevision: paused.controlRevision + 1 });
  });

  it("rejects stale revisions and records stop without claiming execution completion", async () => {
    installHarnessWindow();
    const api = createSyntheticWorkflowApi();
    api.setScenario(CONVERSATION_B, "prepared");
    const before = api.getStatus(CONVERSATION_B);
    api.setNextControlConflict();
    const conflict = await api.fetch(`${origin}/api/v1/agent-workflows/${before.runId}/controls`, {
      method: "POST",
      body: JSON.stringify({ action: "stop", expectedControlRevision: before.controlRevision }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("revision_conflict");
    expect(api.getStatus(CONVERSATION_B).controlRevision).toBe(before.controlRevision);

    const stop = await api.fetch(`${origin}/api/v1/agent-workflows/${before.runId}/controls`, {
      method: "POST",
      body: JSON.stringify({ action: "stop", expectedControlRevision: before.controlRevision }),
    });
    expect(stop.status).toBe(200);
    expect(api.getStatus(CONVERSATION_B)).toMatchObject({ state: "stop_requested", controlState: "stop_requested" });
  });

  it("simulates approval and rationale-bearing return against the real status DTO validator", async () => {
    installHarnessWindow();
    const api = createSyntheticWorkflowApi();
    api.setScenario(CONVERSATION_A, "approval");
    const current = api.getStatus(CONVERSATION_A);
    const approved = await api.fetch(`${origin}/api/v1/agent-workflows/${RUN_A}/approvals/${CHECKPOINT_A}`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", expectedControlRevision: current.controlRevision }),
    });
    expect(approved.status).toBe(200);
    expect(api.getStatus(CONVERSATION_A).approvalCheckpoints[0].state).toBe("approved");
    expect(parseWorkflowStatusResponse(await approved.json(), RUN_A, CONVERSATION_A)).not.toBeNull();

    api.setScenario(CONVERSATION_A, "approval");
    const waiting = api.getStatus(CONVERSATION_A);
    const returned = await api.fetch(`${origin}/api/v1/agent-workflows/${RUN_A}/approvals/${CHECKPOINT_A}`, {
      method: "POST",
      body: JSON.stringify({ decision: "return", expectedControlRevision: waiting.controlRevision, rationale: "Please clarify the cited sources." }),
    });
    expect(returned.status).toBe(200);
    expect(api.getStatus(CONVERSATION_A)).toMatchObject({ state: "returned", approvalCheckpoints: [{ state: "returned" }] });
  });

  it("keeps synthetic conversation status isolated and returns expected auth/not-found failures", async () => {
    installHarnessWindow();
    const api = createSyntheticWorkflowApi();
    api.setScenario(CONVERSATION_A, "reauthenticate");
    api.setScenario(CONVERSATION_B, "unavailable");
    expect((await api.fetch(`${origin}/api/v1/agent-workflows/${RUN_A}`)).status).toBe(401);
    expect((await api.fetch(`${origin}/api/v1/agent-workflows/${api.getStatus(CONVERSATION_B).runId}`)).status).toBe(404);
    expect(api.getEvents().filter((event) => event.kind === "request")).toHaveLength(2);
    expect(selectWorkflowPanelRecords([
      { runId: RUN_A, conversationId: CONVERSATION_A, assistantMessageId: "e5000000-0000-4000-8000-000000000021" },
    ], CONVERSATION_B, []).conversationHosted).toEqual([]);
  });

  it("models a lost response after one state change without issuing a retry", async () => {
    installHarnessWindow();
    const api = createSyntheticWorkflowApi();
    api.setScenario(CONVERSATION_B, "prepared");
    const before = api.getStatus(CONVERSATION_B);
    api.setNextActionAmbiguous();
    await expect(api.fetch(`${origin}/api/v1/agent-workflows/${before.runId}/controls`, {
      method: "POST",
      body: JSON.stringify({ action: "pause", expectedControlRevision: before.controlRevision }),
    })).rejects.toThrow("lost response");
    expect(api.getStatus(CONVERSATION_B).controlRevision).toBe(before.controlRevision + 1);
    expect(api.getRequestCount()).toBe(1);
  });
});
