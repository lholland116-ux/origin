import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { DurableExecutionRun } from "@/lib/agent-runtime/execution-store";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { createDocumentGenerationArtifactReconciler } from "@/lib/agent-runtime/document-generation-reconciliation";
import type { GeneratedDocumentPersistenceRecord } from "@/lib/documents/generated-document-contracts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const USER_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const ASSISTANT_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
const EXECUTION_KEY = "77777777-7777-4777-8777-777777777777";
const ARTIFACT_ID = "88888888-8888-4888-8888-888888888888";
const STEP_ID = "step-3";
const AUTHORIZATION_SECRET = "local-owner-secret";
const authorizationToken = (runId: string) => createHmac("sha256", AUTHORIZATION_SECRET)
  .update(`owner_approved_document_reconciliation:${runId}`, "utf8")
  .digest("hex");
const AUTHORIZATION = { kind: "owner_approved_document_reconciliation" as const, token: authorizationToken(RUN_ID) };

function snapshotFor(status: "running" | "succeeded") {
  const run = createExecutionRunLifecycle();
  const step1 = createExecutionStepLifecycle();
  const step2 = createExecutionStepLifecycle();
  const step3 = createExecutionStepLifecycle();
  run.start();
  step1.start(); step1.succeed();
  step2.start(); step2.succeed();
  step3.start();
  if (status === "succeeded") {
    step3.succeed();
    run.succeed();
  }
  return {
    version: 1 as const,
    runtimeVersion: 1 as const,
    snapshot: {
      run: run.getPersistedSnapshot(),
      steps: {
        "step-1": step1.getPersistedSnapshot(),
        "step-2": step2.getPersistedSnapshot(),
        [STEP_ID]: step3.getPersistedSnapshot(),
      },
    },
  };
}

function run(overrides: Partial<DurableExecutionRun> = {}): DurableExecutionRun {
  return {
    id: RUN_ID,
    userId: USER_ID,
    runtimeVersion: 1,
    handoffVersion: 1,
    idempotencyKey: "idempotency-key",
    requestFingerprint: "a".repeat(64),
    acceptedRequestId: REQUEST_ID,
    acceptanceFingerprint: "b".repeat(64),
    executionPlan: {
      version: 1,
      steps: [
        { id: "step-1", capability: "file_analysis", dependsOn: [], inputs: [] },
        { id: "step-2", capability: "standard", dependsOn: ["step-1"], inputs: [] },
        { id: STEP_ID, capability: "document_generation", dependsOn: ["step-2"], inputs: [] },
      ],
      orderedStepIds: ["step-1", "step-2", STEP_ID],
      plannerSource: "deterministic",
      governance: { maxSteps: 3, capabilityIds: ["file_analysis", "standard", "document_generation"], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: true, handoffVersion: 1 },
    },
    runtimeContext: {
      conversationId: CONVERSATION_ID,
      requestMessageBinding: { requestId: REQUEST_ID, userId: USER_ID, conversationId: CONVERSATION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID },
      attachments: [], resourceReferences: [],
    },
    status: "running",
    controlState: "active",
    controlRevision: 0,
    snapshotSchemaVersion: 1,
    snapshotRevision: 6,
    snapshot: snapshotFor("running"),
    createdAt: "2026-10-12T12:00:00.000Z",
    startedAt: "2026-10-12T12:00:01.000Z",
    steps: [
      { runId: RUN_ID, userId: USER_ID, stepId: "step-1", capabilityId: "file_analysis", dependencyIds: [], attempt: 1, executionKey: "99999999-9999-4999-8999-999999999999", status: "succeeded", result: { kind: "text", value: "file context" }, startedAt: "2026-10-12T12:00:02.000Z", completedAt: "2026-10-12T12:00:03.000Z" },
      { runId: RUN_ID, userId: USER_ID, stepId: "step-2", capabilityId: "standard", dependencyIds: ["step-1"], attempt: 1, executionKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "succeeded", result: { kind: "text", value: "standard result" }, startedAt: "2026-10-12T12:00:04.000Z", completedAt: "2026-10-12T12:00:05.000Z" },
      { runId: RUN_ID, userId: USER_ID, stepId: STEP_ID, capabilityId: "document_generation", dependencyIds: ["step-2"], attempt: 1, executionKey: EXECUTION_KEY, status: "running", startedAt: "2026-10-12T12:00:06.000Z" },
    ],
    approvalCheckpoints: [],
    ...overrides,
  };
}

const record: GeneratedDocumentPersistenceRecord = {
  id: ARTIFACT_ID,
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  messageId: ASSISTANT_MESSAGE_ID,
  generationRequestId: EXECUTION_KEY,
  storagePath: `${USER_ID}/${CONVERSATION_ID}/generated/${ARTIFACT_ID}/report.pdf`,
  filename: "report.pdf",
  format: "pdf",
  mimeType: "application/pdf",
  sizeBytes: 0,
  templateId: "simple-document",
  createdAt: "2026-10-12T12:00:07.000Z",
};

async function validPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage();
  return document.save();
}

function dependencies(overrides: Partial<Parameters<typeof createDocumentGenerationArtifactReconciler>[0]> = {}) {
  const reconcile = vi.fn(async () => ({ status: "reconciled" as const, snapshotRevision: 7 }));
  const loadAcceptedRun = vi.fn(async () => run());
  return {
    enabled: true,
    expectedAuthorizationSecret: AUTHORIZATION_SECRET,
    loadAcceptedRun,
    findDocument: vi.fn(async () => record),
    downloadDocument: vi.fn(async () => validPdf()),
    reconcile,
    ...overrides,
  };
}

describe("governed document-generation artifact reconciliation", () => {
  it("validates the existing PDF and checkpoints through the injected fenced boundary", async () => {
    const bytes = await validPdf();
    const document = { ...record, sizeBytes: bytes.byteLength };
    const deps = dependencies({
      findDocument: vi.fn(async () => document),
      downloadDocument: vi.fn(async () => bytes),
    });
    const reconcile = createDocumentGenerationArtifactReconciler(deps);

    await expect(reconcile({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "reconciled", snapshotRevision: 7 });
    expect(deps.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID, stepId: STEP_ID, executionKey: EXECUTION_KEY, expectedSnapshotRevision: 6,
      result: { kind: "document", value: expect.objectContaining({ artifactId: ARTIFACT_ID, messageId: ASSISTANT_MESSAGE_ID }) },
      snapshot: expect.objectContaining({ snapshot: expect.objectContaining({ run: expect.objectContaining({ value: "succeeded" }) }) }),
      artifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it.each([
    ["2026-10-12T12:00:07.000Z", "2026-10-12T12:00:07.000Z"],
    ["2026-10-12T12:00:07.000+00:00", "2026-10-12T12:00:07.000Z"],
    ["2026-10-12T07:00:07.123456-05:00", "2026-10-12T12:00:07.123456Z"],
  ] as const)("accepts %s and constructs a canonical %s result timestamp", async (createdAt, canonicalCreatedAt) => {
    const bytes = await validPdf();
    const reconcile = vi.fn(async () => ({ status: "reconciled" as const, snapshotRevision: 7 }));
    const deps = dependencies({
      findDocument: vi.fn(async () => ({ ...record, sizeBytes: bytes.byteLength, createdAt })),
      downloadDocument: vi.fn(async () => bytes),
      reconcile,
    });
    const reconciler = createDocumentGenerationArtifactReconciler(deps);

    await expect(reconciler({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({
      status: "reconciled",
      snapshotRevision: 7,
    });
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      result: { kind: "document", value: expect.objectContaining({ createdAt: canonicalCreatedAt }) },
    }));
  });

  it.each([
    "not-a-timestamp",
    "2026-10-12",
    "2026-10-12T12:00:07+99:99",
  ])("rejects invalid document timestamp %s before reconciliation", async (createdAt) => {
    const bytes = await validPdf();
    const reconcile = vi.fn(async () => ({ status: "reconciled" as const, snapshotRevision: 7 }));
    const deps = dependencies({
      findDocument: vi.fn(async () => ({ ...record, sizeBytes: bytes.byteLength, createdAt })),
      downloadDocument: vi.fn(async () => bytes),
      reconcile,
    });
    const reconciler = createDocumentGenerationArtifactReconciler(deps);

    await expect(reconciler({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "not_eligible" });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("is idempotent after a completed reconciliation and never downloads again", async () => {
    const deps = dependencies({
      loadAcceptedRun: vi.fn(async () => run({
        status: "succeeded",
        completedAt: "2026-10-12T12:00:08.000Z",
        snapshot: snapshotFor("succeeded"),
        steps: run().steps.map((step) => step.stepId === STEP_ID
          ? { ...step, status: "succeeded" as const, result: { kind: "document" as const, value: { kind: "generated_document" as const, artifactId: ARTIFACT_ID, conversationId: CONVERSATION_ID, messageId: ASSISTANT_MESSAGE_ID, filename: "report.pdf", format: "pdf" as const, mimeType: "application/pdf", sizeBytes: 1, createdAt: "2026-10-12T12:00:07.000Z" } }, completedAt: "2026-10-12T12:00:08.000Z" }
          : step),
      })),
    });
    const reconcile = createDocumentGenerationArtifactReconciler(deps);
    await expect(reconcile({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "already_reconciled" });
    expect(deps.downloadDocument).not.toHaveBeenCalled();
  });

  it("leaves concurrent fencing decisions to the serialized repository boundary", async () => {
    const bytes = await validPdf();
    const reconcile = vi.fn()
      .mockResolvedValueOnce({ status: "reconciled" as const, snapshotRevision: 7 })
      .mockResolvedValueOnce({ status: "already_reconciled" as const, snapshotRevision: 7 });
    const reconciler = createDocumentGenerationArtifactReconciler(dependencies({
      findDocument: vi.fn(async () => ({ ...record, sizeBytes: bytes.byteLength })),
      downloadDocument: vi.fn(async () => bytes),
      reconcile,
    }));
    const results = await Promise.all([
      reconciler({ runId: RUN_ID, authorization: AUTHORIZATION }),
      reconciler({ runId: RUN_ID, authorization: AUTHORIZATION }),
    ]);
    expect(results).toEqual([
      { status: "reconciled", snapshotRevision: 7 },
      { status: "already_reconciled", snapshotRevision: 7 },
    ]);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("fails closed for disabled, invalid authorization, stale running state, wrong owner, corrupt PDFs, and conflicts", async () => {
    const disabled = createDocumentGenerationArtifactReconciler(dependencies({ enabled: false }));
    await expect(disabled({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "disabled" });

    const invalidAuth = createDocumentGenerationArtifactReconciler(dependencies());
    await expect(invalidAuth({ runId: RUN_ID, authorization: { ...AUTHORIZATION, token: "wrong" } })).resolves.toEqual({ status: "disabled" });
    await expect(invalidAuth({ runId: RUN_ID, authorization: { ...AUTHORIZATION, token: authorizationToken("99999999-9999-4999-8999-999999999999") } })).resolves.toEqual({ status: "disabled" });

    const stale = createDocumentGenerationArtifactReconciler(dependencies({ loadAcceptedRun: vi.fn(async () => run({ controlState: "paused" })) }));
    await expect(stale({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "not_eligible" });

    const wrongOwner = createDocumentGenerationArtifactReconciler(dependencies({
      findDocument: vi.fn(async () => ({ ...record, userId: "99999999-9999-4999-8999-999999999999" })),
    }));
    await expect(wrongOwner({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "artifact_invalid" });

    const corrupt = createDocumentGenerationArtifactReconciler(dependencies({
      findDocument: vi.fn(async () => ({ ...record, sizeBytes: 5 })),
      downloadDocument: vi.fn(async () => new Uint8Array([1, 2, 3, 4, 5])),
    }));
    await expect(corrupt({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "artifact_invalid" });

    const bytes = await validPdf();
    expect(await createDocumentGenerationArtifactReconciler({
      ...dependencies({
        findDocument: vi.fn(async () => ({ ...record, sizeBytes: bytes.byteLength })),
        downloadDocument: vi.fn(async () => bytes),
        reconcile: vi.fn(async () => ({ status: "conflict" as const })),
      }),
    })({ runId: RUN_ID, authorization: AUTHORIZATION })).toEqual({ status: "conflict" });

    const staleClaim = createDocumentGenerationArtifactReconciler({
      ...dependencies({
        findDocument: vi.fn(async () => ({ ...record, sizeBytes: bytes.byteLength })),
        downloadDocument: vi.fn(async () => bytes),
        reconcile: vi.fn(async () => ({ status: "stale_claim" as const })),
      }),
    });
    await expect(staleClaim({ runId: RUN_ID, authorization: AUTHORIZATION })).resolves.toEqual({ status: "stale_claim" });
  });
});
