import { createElement, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import WorkflowProgressPanel from "@/components/chat/WorkflowProgressPanel";
import { getChatThemeById } from "@/lib/chat-themes";
import {
  isFinalizedWorkflowAssistantMessageVisible,
  readWorkflowTrackingRecords,
  removeWorkflowTrackingRecord,
  saveWorkflowTrackingRecord,
  selectWorkflowPanelRecords,
  WORKFLOW_PROGRESS_STORAGE_KEY,
  type WorkflowTrackingRecord,
} from "@/lib/agent-runtime/workflow-progress-client";
import { omitPendingAssistantMessages, createPendingAssistantMessageContent } from "@/lib/chat/request-message-visibility";
import {
  ASSISTANT_A,
  ASSISTANT_B,
  CONVERSATION_A,
  CONVERSATION_B,
  RUN_A,
  RUN_B,
  createSyntheticWorkflowApi,
  type Scenario,
} from "./synthetic-api";
import type { WorkflowProgressDto } from "@/lib/agent-runtime/workflow-http-api";
import "@/app/globals.css";

const api = createSyntheticWorkflowApi();
const CONVERSATIONS = [CONVERSATION_A, CONVERSATION_B] as const;
const RUNS: Readonly<Record<string, string>> = { [CONVERSATION_A]: RUN_A, [CONVERSATION_B]: RUN_B };
const ASSISTANTS: Readonly<Record<string, string>> = { [CONVERSATION_A]: ASSISTANT_A, [CONVERSATION_B]: ASSISTANT_B };
const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string }> = [
  { value: "accepted", label: "Accepted / pending assistant destination" },
  { value: "progress", label: "Workflow progress" },
  { value: "prepared", label: "Prepared controls" },
  { value: "approval", label: "Approval checkpoint (synthetic only)" },
  { value: "failed", label: "Failed workflow" },
  { value: "recovery", label: "Recovery required" },
  { value: "reauthenticate", label: "Status returns HTTP 401" },
  { value: "unavailable", label: "Status returns HTTP 404" },
  { value: "network-failure", label: "Status network failure" },
  { value: "completed", label: "Completed workflow" },
];

type SyntheticMessage = { id: string; role: "user" | "assistant"; content: string };
type Event = ReturnType<typeof api.getEvents>[number];

function trackingRecord(conversationId: string): WorkflowTrackingRecord {
  return { runId: RUNS[conversationId], conversationId, assistantMessageId: ASSISTANTS[conversationId] };
}

function initialMessages(conversationId: string): SyntheticMessage[] {
  return [
    { id: `${conversationId.slice(0, -1)}9`, role: "user", content: "Research public guidance and prepare a report." },
    { id: ASSISTANTS[conversationId], role: "assistant", content: createPendingAssistantMessageContent(`${conversationId.slice(0, -1)}8`, `${conversationId.slice(0, -1)}9`) },
  ];
}

function Harness() {
  const [conversationId, setConversationId] = useState<string>(() => {
    try {
      const stored = sessionStorage.getItem("lvtchat.synthetic.active-conversation");
      return stored === CONVERSATION_B ? CONVERSATION_B : CONVERSATION_A;
    } catch { return CONVERSATION_A; }
  });
  const [scenario, setScenario] = useState<Scenario>(() => conversationId === CONVERSATION_A ? "accepted" : "prepared");
  const [status, setStatus] = useState<WorkflowProgressDto>(() => api.getStatus(conversationId));
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, SyntheticMessage[]>>(() => ({
    [CONVERSATION_A]: initialMessages(CONVERSATION_A),
    [CONVERSATION_B]: initialMessages(CONVERSATION_B),
  }));
  const [records, setRecords] = useState<WorkflowTrackingRecord[]>(() => readWorkflowTrackingRecords(window.sessionStorage, conversationId));
  const [events, setEvents] = useState<readonly Event[]>(api.getEvents());
  const [requestCount, setRequestCount] = useState(0);
  const [themeId, setThemeId] = useState("midnight-blue");
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [messageRefreshCount, setMessageRefreshCount] = useState(0);
  const [visibleNotice, setVisibleNotice] = useState("Pending assistant content is hidden; the workflow remains conversation-hosted.");
  const theme = useMemo(() => getChatThemeById(themeId), [themeId]);
  const messages = messagesByConversation[conversationId] ?? [];
  const syntheticStatus = api.getStatus(conversationId);
  const visibleMessages = omitPendingAssistantMessages(messages);
  const selection = selectWorkflowPanelRecords(records, conversationId, visibleMessages);
  const panelRecords = [...selection.messageHosted, ...selection.conversationHosted];

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = api.fetch;
    const unsubscribe = api.subscribe(() => {
      setEvents([...api.getEvents()]);
      setRequestCount(api.getRequestCount());
    });
    try {
      if (sessionStorage.getItem(WORKFLOW_PROGRESS_STORAGE_KEY) === null) {
        for (const id of CONVERSATIONS) saveWorkflowTrackingRecord(sessionStorage, trackingRecord(id));
      }
      setRecords(readWorkflowTrackingRecords(sessionStorage, conversationId));
    } catch {
      setVisibleNotice("Session storage is unavailable; refresh restoration cannot be demonstrated in this browser context.");
    }
    return () => {
      unsubscribe();
      window.fetch = originalFetch;
    };
    // Install the synthetic fetch boundary once for this harness page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setRecords(readWorkflowTrackingRecords(sessionStorage, conversationId));
    try { sessionStorage.setItem("lvtchat.synthetic.active-conversation", conversationId); } catch { /* Visible notice covers unavailable storage. */ }
    setStatus(api.getStatus(conversationId));
    setScenario(conversationId === CONVERSATION_A ? "accepted" : "prepared");
    setMessagesByConversation((previous) => ({
      ...previous,
      [conversationId]: previous[conversationId] ?? initialMessages(conversationId),
    }));
  }, [conversationId]);

  const selectScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario);
    const next = api.setScenario(conversationId, nextScenario);
    setStatus(next);
    setVisibleNotice(nextScenario === "approval"
      ? "Approval-checkpoint controls are a synthetic UI demonstration; production checkpoint creation is not connected."
      : nextScenario === "accepted"
        ? "Pending assistant content is hidden; the workflow remains conversation-hosted."
        : `Loaded synthetic ${nextScenario} state; no workflow execution occurred.`);
    setRefreshSequence((value) => value + 1);
  };

  const refreshStatus = () => {
    setStatus(api.refresh(conversationId));
    setRefreshSequence((value) => value + 1);
  };

  const refreshMessages = () => {
    setMessagesByConversation((previous) => ({ ...previous, [conversationId]: [...(previous[conversationId] ?? [])] }));
    setMessageRefreshCount((value) => value + 1);
    setVisibleNotice("Conversation messages refreshed in memory; the same workflow panel host is selected.");
    setStatus(api.refresh(conversationId));
    setRefreshSequence((value) => value + 1);
  };

  const showFinalAssistantResponse = () => {
    const finalMessage: SyntheticMessage = {
      id: ASSISTANTS[conversationId],
      role: "assistant",
      content: "Synthetic final response: public guidance was summarized into a report outline.",
    };
    setMessagesByConversation((previous) => ({
      ...previous,
      [conversationId]: [...(previous[conversationId] ?? []).filter((item) => item.id !== finalMessage.id), finalMessage],
    }));
    const record = trackingRecord(conversationId);
    const latestMessages = [...(messagesByConversation[conversationId] ?? []).filter((item) => item.id !== finalMessage.id), finalMessage];
    if (isFinalizedWorkflowAssistantMessageVisible(record, latestMessages)) {
      removeWorkflowTrackingRecord(sessionStorage, record);
      setRecords(readWorkflowTrackingRecords(sessionStorage, conversationId));
      setVisibleNotice("The original assistant message ID now has visible final content; its workflow tracking record was cleaned up.");
    }
  };

  const restoreSessionTracking = () => {
    setRecords(readWorkflowTrackingRecords(sessionStorage, conversationId));
    setVisibleNotice("Tracking records restored from this tab's sessionStorage using the production reader.");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-3 py-5 text-slate-100 sm:px-6">
      <header className="rounded-xl border border-amber-400/60 bg-amber-950/70 p-4">
        <h1 className="text-xl font-bold">LVTChat Execution Engine — LOCAL SYNTHETIC UI TEST</h1>
        <p className="mt-2 text-sm font-semibold text-amber-100">Local synthetic data. No real AI execution.</p>
        <p className="mt-1 text-xs text-amber-100/90">No login, database, provider, or LVTChat backend is used by this harness.</p>
      </header>

      <section aria-label="Synthetic scenario controls" className="grid min-w-0 gap-3 rounded-xl border border-slate-700 bg-slate-900/90 p-3 sm:grid-cols-2 sm:p-4">
        <label className="grid min-w-0 gap-1 text-sm">Scenario
          <select aria-label="Scenario" value={scenario} onChange={(event) => selectScenario(event.target.value as Scenario)} className="min-h-11 min-w-0 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white">
            {SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">Synthetic conversation
          <select aria-label="Synthetic conversation" value={conversationId} onChange={(event) => setConversationId(event.target.value)} className="min-h-11 min-w-0 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white">
            <option value={CONVERSATION_A}>Conversation A</option>
            <option value={CONVERSATION_B}>Conversation B</option>
          </select>
        </label>
        <div className="flex min-w-0 flex-wrap gap-2 sm:col-span-2">
          <button type="button" onClick={refreshMessages} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Refresh conversation messages</button>
          <button type="button" onClick={() => { setStatus(api.advance(conversationId)); setRefreshSequence((value) => value + 1); }} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Advance synthetic progress</button>
          <button type="button" onClick={refreshStatus} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Simulate status refresh</button>
          <button type="button" onClick={showFinalAssistantResponse} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Show finalized assistant message</button>
          <button type="button" onClick={restoreSessionTracking} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Restore session tracking</button>
          <button type="button" onClick={() => { api.setNextControlConflict(); setVisibleNotice("Next control response is a synthetic stale-revision conflict."); }} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Simulate stale revision</button>
          <button type="button" onClick={() => { api.setNextActionAmbiguous(); setVisibleNotice("Next action applies in memory but its response is lost; no retry is made by the real panel."); }} className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Simulate ambiguous action result</button>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm">Theme
            <select aria-label="Theme" value={themeId} onChange={(event) => setThemeId(event.target.value)} className="min-w-0 bg-slate-950 text-white">
              <option value="midnight-blue">Dark</option><option value="light">Light</option>
            </select>
          </label>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.75fr)]">
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-900/80 p-3 sm:p-4">
          <h2 className="font-semibold">Synthetic conversation {conversationId === CONVERSATION_A ? "A" : "B"}</h2>
          <p className="mt-2 break-words rounded-lg bg-slate-800 p-3 text-sm">User: Research public guidance and prepare a report.</p>
          {visibleMessages.filter((message) => message.role === "assistant").map((message) => (
            <p key={message.id} className="mt-2 break-words rounded-lg bg-blue-950 p-3 text-sm" data-assistant-id={message.id}>Assistant: {message.content}</p>
          ))}
          {panelRecords.map((record) => (
            <WorkflowProgressPanel
              key={`${record.conversationId}:${record.runId}`}
              runId={record.runId}
              conversationId={record.conversationId}
              initialStatus={status}
              theme={theme}
            />
          ))}
          {!panelRecords.length ? <p className="mt-3 rounded-lg border border-slate-700 p-3 text-sm">No workflow panel is selected for this conversation.</p> : null}
        </div>

        <aside className="min-w-0 space-y-3">
          <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-900/80 p-3 sm:p-4">
            <h2 className="font-semibold">Synthetic test state</h2>
            <dl className="mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-words text-xs">
              <dt>Scenario</dt><dd>{scenario}</dd>
              <dt>Workflow state</dt><dd>{syntheticStatus.state}</dd>
              <dt>Control revision</dt><dd>{syntheticStatus.controlRevision}</dd>
              <dt>Run</dt><dd>{syntheticStatus.runId}</dd>
              <dt>Conversation</dt><dd>{syntheticStatus.conversationId}</dd>
              <dt>Visible assistant turns</dt><dd>{visibleMessages.filter((message) => message.role === "assistant").length}</dd>
              <dt>Panel count</dt><dd>{panelRecords.length}</dd>
              <dt>Message refreshes</dt><dd>{messageRefreshCount}</dd>
              <dt>Status refresh sequence</dt><dd>{refreshSequence}</dd>
              <dt>API requests</dt><dd>{requestCount}</dd>
            </dl>
            <p className="mt-3 text-sm" role="status" aria-live="polite">{visibleNotice}</p>
          </section>
          <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-900/80 p-3 sm:p-4">
            <h2 className="font-semibold">Synthetic API event log</h2>
            <p className="mt-1 text-xs text-slate-400">In-memory only. No credentials, cookies, or request headers are recorded.</p>
            <ol aria-label="Synthetic API event log" className="mt-2 max-h-64 min-w-0 space-y-1 overflow-auto text-xs">
              {events.slice().reverse().map((event, index) => <li key={`${event.at}-${index}`} className={`break-words rounded border p-2 ${event.kind === "blocked" ? "border-red-500/40 text-red-200" : "border-slate-700 text-slate-200"}`}><time>{event.at}</time> · {event.kind}: {event.message}</li>)}
              {!events.length ? <li className="text-slate-400">No requests yet.</li> : null}
            </ol>
          </section>
        </aside>
      </section>
      <footer className="break-words text-xs text-slate-400">Panel host selection and session tracking use the production ER-UI-CS1 helpers. Approval checkpoint UI is synthetic only; no production checkpoint creation or execution occurs.</footer>
    </main>
  );
}

function installFailClosedFetchBoundary(): () => void {
  const originalFetch = window.fetch;
  window.fetch = api.fetch;
  return () => { window.fetch = originalFetch; };
}

// Install before React effects and keep the saved restore function for teardown.
const restoreFetch = installFailClosedFetchBoundary();
window.addEventListener("pagehide", restoreFetch, { once: true });

createRoot(document.getElementById("root")!).render(createElement(Harness));
