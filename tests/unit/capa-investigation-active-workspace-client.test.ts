import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialLedgerDraft, createInitialRootCausePackageDraft, createLedgerItem } from "../../app/capa/capa-root-cause-draft";
import { createCapaInvestigationActiveWorkspaceAutosaveCoordinator, loadCapaInvestigationActiveWorkspace, parseCapaInvestigationActiveWorkspaceLoad, saveCapaInvestigationActiveWorkspace, type CapaInvestigationActiveWorkspaceProjection, type CapaInvestigationActiveWorkspaceSaveResult, type WorkspaceAutosaveSnapshot } from "../../app/capa/capa-investigation-active-workspace-client";

const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const CORRELATION = "40000000-0000-4000-8000-000000000001";
const ledger = createInitialLedgerDraft();
const rootCausePackage = createInitialRootCausePackageDraft();
const workspace = { draft_revision: 1, case_version_id: VERSION, record_version: 4, evidence_assumption_ledger: ledger, root_cause_package: rootCausePackage, updated_at: "2026-09-05T12:00:00.000Z" };
function snapshot(label: string): WorkspaceAutosaveSnapshot { const item = { ...createLedgerItem("verified_evidence", `LED-${label}`), statement: label }; return { evidence_assumption_ledger: { items: [item] }, root_cause_package: rootCausePackage }; }
function projection(value: WorkspaceAutosaveSnapshot, revision: number): CapaInvestigationActiveWorkspaceProjection { return { draft_revision: revision, case_version_id: VERSION, record_version: 4, evidence_assumption_ledger: value.evidence_assumption_ledger, root_cause_package: value.root_cause_package, updated_at: `2026-09-05T12:00:0${revision}.000Z` } as CapaInvestigationActiveWorkspaceProjection; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }
afterEach(() => { vi.useRealTimers(); });

describe("S40 investigation-active workspace browser client", () => {
  it("loads null without issuing a PUT and hydrates an existing safe projection", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(String(url).endsWith("workspace") ? { workspace: null, correlation_id: CORRELATION } : {}), { status: 200 }));
    await expect(loadCapaInvestigationActiveWorkspace(CASE, fetcher as typeof fetch)).resolves.toMatchObject({ status: "loaded", workspace: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const parsed = parseCapaInvestigationActiveWorkspaceLoad({ workspace, correlation_id: CORRELATION });
    expect(parsed).toMatchObject({ status: "loaded", workspace: { draft_revision: 1, case_version_id: VERSION, record_version: 4 } });
    expect((parsed as { workspace: typeof workspace }).workspace).not.toHaveProperty("organization_id");
  });

  it("sends only the safe PUT payload and rejects malformed responses", async () => {
    let sent: RequestInit | undefined;
    const result = await saveCapaInvestigationActiveWorkspace(CASE, { expected_draft_revision: null, evidence_assumption_ledger: ledger, root_cause_package: rootCausePackage }, async (_url, init) => { sent = init; return new Response(JSON.stringify({ workspace, correlation_id: CORRELATION }), { status: 200 }); });
    expect(result.status).toBe("saved");
    expect(JSON.parse(String(sent?.body))).toEqual({ expected_draft_revision: null, evidence_assumption_ledger: ledger, root_cause_package: rootCausePackage });
    expect(JSON.stringify(result)).not.toContain("organization_id");
    expect(parseCapaInvestigationActiveWorkspaceLoad({ workspace: { ...workspace, draft_revision: 0 }, correlation_id: CORRELATION })).toMatchObject({ status: "failed", code: "INVALID_WORKSPACE_RESPONSE" });
    const failed = await saveCapaInvestigationActiveWorkspace(CASE, { expected_draft_revision: 1, evidence_assumption_ledger: ledger, root_cause_package: rootCausePackage }, async () => new Response(JSON.stringify({ error: { code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", message: "raw database details" } }), { status: 409 }));
    expect(failed.status).toBe("failed");
    if (failed.status === "failed") expect(failed.message).toBe("The workspace changed before this save could be completed.");
  });

  it("progresses from null through server-returned revisions", async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const a = snapshot("A"); const b = snapshot("B"); const c = snapshot("C");
    const results = [projection(a, 1), projection(b, 2), projection(c, 3)];
    const calls: unknown[] = [];
    const save = vi.fn(async (value: unknown) => { calls.push(value); const result = results[calls.length - 1]!; return { status: "saved" as const, workspace: result, correlation_id: CORRELATION }; });
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 700, onStatus: (status) => statuses.push(status) });
    coordinator.setRevision(null);
    coordinator.queue(a);
    await vi.advanceTimersByTimeAsync(699);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect((calls[0] as { expected_draft_revision: number | null }).expected_draft_revision).toBeNull();
    coordinator.queue(b);
    await vi.advanceTimersByTimeAsync(700);
    expect(save).toHaveBeenCalledTimes(2);
    expect((calls[1] as { expected_draft_revision: number | null }).expected_draft_revision).toBe(1);
    expect((calls[1] as { evidence_assumption_ledger: unknown }).evidence_assumption_ledger).toEqual(b.evidence_assumption_ledger);
    coordinator.queue(c);
    await vi.advanceTimersByTimeAsync(700);
    expect(save).toHaveBeenCalledTimes(3);
    expect((calls[2] as { expected_draft_revision: number | null }).expected_draft_revision).toBe(2);
    expect(statuses).toContain("saving");
    expect(statuses.at(-1)).toBe("saved");
    coordinator.dispose();
  });

  it("keeps PUT single-flight while sending a pending edit after the prior server acknowledgement", async () => {
    vi.useFakeTimers();
    const a = snapshot("A"); const b = snapshot("B"); const first = deferred<CapaInvestigationActiveWorkspaceSaveResult>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ status: "saved" as const, workspace: projection(b, 2), correlation_id: CORRELATION });
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 1 });
    coordinator.queue(a); await vi.advanceTimersByTimeAsync(1);
    coordinator.queue(b);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ status: "saved", workspace: projection(a, 1), correlation_id: CORRELATION });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1]![0] as { readonly expected_draft_revision: number | null }).expected_draft_revision).toBe(1);
    expect((save.mock.calls[1]![0] as { readonly evidence_assumption_ledger: unknown }).evidence_assumption_ledger).toEqual(b.evidence_assumption_ledger);
    coordinator.dispose();
  });

  it("preserves the newest pending snapshot when an older save fails", async () => {
    vi.useFakeTimers();
    const a = snapshot("A"); const b = snapshot("B"); const first = deferred<CapaInvestigationActiveWorkspaceSaveResult>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ status: "saved" as const, workspace: projection(b, 1), correlation_id: CORRELATION });
    const statuses: string[] = [];
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 1, onStatus: (status) => statuses.push(status) });
    coordinator.queue(a);
    await vi.advanceTimersByTimeAsync(1);
    coordinator.queue(b);
    first.resolve({ status: "failed", code: null, message: "safe", correlation_id: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("failed");
    coordinator.retry();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1]![0] as { readonly evidence_assumption_ledger: unknown }).evidence_assumption_ledger).toEqual(b.evidence_assumption_ledger);
    expect((save.mock.calls[1]![0] as { readonly expected_draft_revision: number | null }).expected_draft_revision).toBeNull();
    coordinator.dispose();
  });

  it("exposes a retry when B's debounce expires while failed A remains unresolved", async () => {
    vi.useFakeTimers();
    const a = snapshot("A"); const b = snapshot("B"); const first = deferred<CapaInvestigationActiveWorkspaceSaveResult>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ status: "saved" as const, workspace: projection(b, 1), correlation_id: CORRELATION });
    const statuses: string[] = [];
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 10, onStatus: (status) => statuses.push(status) });
    coordinator.queue(a);
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    coordinator.queue(b);
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ status: "failed", code: null, message: "safe", correlation_id: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("failed");
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    coordinator.retry();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1]![0] as { readonly evidence_assumption_ledger: unknown }).evidence_assumption_ledger).toEqual(b.evidence_assumption_ledger);
    expect((save.mock.calls[1]![0] as { readonly expected_draft_revision: number | null }).expected_draft_revision).toBeNull();
    coordinator.dispose();
  });

  it("keeps newer invalid or AI-blocked state from being reported as saved", async () => {
    vi.useFakeTimers();
    for (const newerState of ["invalid", "blocked"] as const) {
      const first = deferred<CapaInvestigationActiveWorkspaceSaveResult>();
      const statuses: string[] = [];
      const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save: vi.fn(() => first.promise), debounceMs: 1, onStatus: (status) => statuses.push(status) });
      coordinator.queue(snapshot("A"));
      await vi.advanceTimersByTimeAsync(1);
      if (newerState === "invalid") coordinator.markInvalid(); else coordinator.markBlocked();
      first.resolve({ status: "saved", workspace: projection(snapshot("A"), 1), correlation_id: CORRELATION });
      await vi.advanceTimersByTimeAsync(0);
      expect(statuses.at(-1)).toBe(newerState === "invalid" ? "unsaved" : "blocked");
      coordinator.dispose();
    }
  });

  it("latches both controlled conflicts and does not retry them", async () => {
    vi.useFakeTimers();
    for (const code of ["WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", "WORKFLOW_MUTATION_DETECTED"]) {
      const save = vi.fn().mockResolvedValue({ status: "failed" as const, code, message: "safe", correlation_id: CORRELATION });
      const statuses: string[] = [];
      const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 1, onStatus: (status) => statuses.push(status) });
      coordinator.queue(snapshot("A"));
      await vi.advanceTimersByTimeAsync(1);
      expect(statuses.at(-1)).toBe("conflict");
      coordinator.retry(); coordinator.queue(snapshot("B"));
      await vi.advanceTimersByTimeAsync(10);
      expect(save).toHaveBeenCalledTimes(1);
      coordinator.dispose();
    }
  });

  it("preserves a latched conflict or AI block when a later invalid transition is reported", async () => {
    vi.useFakeTimers();
    const conflictSave = vi.fn().mockResolvedValue({ status: "failed" as const, code: "WORKFLOW_MUTATION_DETECTED", message: "safe", correlation_id: CORRELATION });
    const conflictStatuses: string[] = [];
    const conflictCoordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save: conflictSave, debounceMs: 1, onStatus: (status) => conflictStatuses.push(status) });
    conflictCoordinator.queue(snapshot("A")); await vi.advanceTimersByTimeAsync(1);
    conflictCoordinator.markInvalid();
    expect(conflictStatuses.at(-1)).toBe("conflict");
    conflictCoordinator.dispose();

    const blockedSave = vi.fn();
    const blockedStatuses: string[] = [];
    const blockedCoordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save: blockedSave, debounceMs: 1, onStatus: (status) => blockedStatuses.push(status) });
    blockedCoordinator.markBlocked(); blockedCoordinator.markInvalid();
    expect(blockedStatuses.at(-1)).toBe("blocked");
    blockedCoordinator.dispose();
  });

  it("does not automatically retry network failures and permits deliberate retry", async () => {
    vi.useFakeTimers();
    const save = vi.fn()
      .mockResolvedValueOnce({ status: "failed" as const, code: null, message: "safe", correlation_id: null })
      .mockResolvedValueOnce({ status: "saved" as const, workspace: projection(snapshot("A"), 1), correlation_id: CORRELATION });
    const statuses: string[] = [];
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 1, onStatus: (status) => statuses.push(status) });
    coordinator.queue(snapshot("A"));
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses.at(-1)).toBe("failed");
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    coordinator.retry(); await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("uses server acknowledgement rather than submitted local content", async () => {
    vi.useFakeTimers();
    const submitted = snapshot("LOCAL"); const acknowledged = snapshot("SERVER"); const saved: CapaInvestigationActiveWorkspaceProjection[] = [];
    const save = vi.fn()
      .mockResolvedValueOnce({ status: "saved" as const, workspace: projection(acknowledged, 7), correlation_id: CORRELATION })
      .mockResolvedValueOnce({ status: "saved" as const, workspace: projection(acknowledged, 8), correlation_id: CORRELATION });
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save, debounceMs: 1, onSaved: (value) => saved.push(value) });
    coordinator.queue(submitted); await vi.advanceTimersByTimeAsync(1);
    coordinator.queue(snapshot("NEXT")); await vi.advanceTimersByTimeAsync(1);
    expect(saved[0]!.evidence_assumption_ledger).toEqual(acknowledged.evidence_assumption_ledger);
    expect((save.mock.calls[1]![0] as { readonly expected_draft_revision: number | null }).expected_draft_revision).toBe(7);
    coordinator.dispose();
  });

  it("does not invoke callbacks after disposal while a save is pending", async () => {
    vi.useFakeTimers();
    const first = deferred<CapaInvestigationActiveWorkspaceSaveResult>(); const statuses: string[] = [];
    const coordinator = createCapaInvestigationActiveWorkspaceAutosaveCoordinator({ save: vi.fn(() => first.promise), debounceMs: 1, onStatus: (status) => statuses.push(status) });
    coordinator.queue(snapshot("A")); await vi.advanceTimersByTimeAsync(1);
    const before = statuses.length; coordinator.dispose();
    first.resolve({ status: "saved", workspace: projection(snapshot("A"), 1), correlation_id: CORRELATION });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toHaveLength(before);
  });
});
