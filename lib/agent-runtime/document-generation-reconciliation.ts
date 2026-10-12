import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  generatedDocumentReferenceSchema,
} from "@/lib/agent-runtime/application-contracts";
import type { DurableExecutionRun, ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import type { GeneratedDocumentPersistenceRecord } from "@/lib/documents/generated-document-contracts";
import {
  downloadGeneratedDocument,
  findGeneratedDocumentByRequest,
} from "@/lib/documents/generated-document-server";
import { validateGeneratedDocumentStoragePath } from "@/lib/documents/generated-document-storage";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { validateExecutionSnapshot } from "@/lib/agent-runtime/execution-snapshot";
import { validateExecutionStepResult } from "@/lib/agent-runtime/xstate-runtime-adapter";

if (typeof window !== "undefined") throw new Error("Document reconciliation is server-only");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECONCILIATION_BYTES = 10 * 1024 * 1024;
const AUTHORIZATION_PURPOSE = "owner_approved_document_reconciliation";

export type DocumentGenerationReconciliationAuthorization = Readonly<{
  /** This token is supplied only by a separately approved server operator. */
  readonly kind: "owner_approved_document_reconciliation";
  readonly token: string;
}>;

export type DocumentGenerationReconciliationResult = Readonly<{
  status: "reconciled" | "already_reconciled" | "disabled" | "not_found" | "not_eligible"
    | "artifact_invalid" | "conflict" | "stale_claim";
  /** Set by the server RPC adapter; omitted for pre-RPC validation results. */
  source?: "pre_rpc" | "rpc";
  snapshotRevision?: number;
}>;

type ReconciliationRepository = (input: Readonly<{
  runId: string;
  stepId: string;
  executionKey: string;
  expectedSnapshotRevision: number;
  snapshot: ExecutionSnapshotEnvelope;
  result: unknown;
  artifactSha256: string;
}>) => Promise<DocumentGenerationReconciliationResult>;

export type DocumentGenerationReconciliationDependencies = Readonly<{
  enabled: boolean;
  /** Deployment secret used to derive a run-scoped authorization token. */
  expectedAuthorizationSecret: string | undefined;
  loadAcceptedRun: (runId: string) => Promise<DurableExecutionRun | null>;
  findDocument?: typeof findGeneratedDocumentByRequest;
  downloadDocument?: typeof downloadGeneratedDocument;
  reconcile: ReconciliationRepository;
}>;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Derives the one-run authorization token without exposing the deployment secret to a caller. */
export function createDocumentGenerationReconciliationAuthorizationToken(
  secret: string | undefined,
  runId: string,
): string | null {
  if (!secret || !isUuid(runId)) return null;
  return createHmac("sha256", secret)
    .update(`${AUTHORIZATION_PURPOSE}:${runId}`, "utf8")
    .digest("hex");
}

function hasRunScopedAuthorization(token: string, secret: string | undefined, runId: string): boolean {
  const expected = createDocumentGenerationReconciliationAuthorizationToken(secret, runId);
  if (!expected) return false;
  const actual = Buffer.from(token, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

function buildSnapshot(run: DurableExecutionRun, stepId: string): ExecutionSnapshotEnvelope | null {
  try {
    const runActor = createExecutionRunLifecycle(run.snapshot.snapshot.run);
    const stepActors = new Map(run.steps.map((step) => [
      step.stepId,
      createExecutionStepLifecycle(run.snapshot.snapshot.steps[step.stepId]),
    ]));
    const target = stepActors.get(stepId);
    if (!target || target.status !== "running" || runActor.status !== "running") {
      for (const actor of stepActors.values()) actor.stop();
      runActor.stop();
      return null;
    }
    target.succeed();
    runActor.succeed();
    const snapshot: ExecutionSnapshotEnvelope = {
      version: 1,
      runtimeVersion: 1,
      snapshot: {
        run: runActor.getPersistedSnapshot(),
        steps: Object.fromEntries([...stepActors].map(([id, actor]) => [id, actor.getPersistedSnapshot()])),
      },
    };
    const statuses = Object.fromEntries(run.steps.map((step) => [
      step.stepId,
      step.stepId === stepId ? "succeeded" : step.status,
    ])) as Record<string, "succeeded">;
    const validated = validateExecutionSnapshot(snapshot, { runStatus: "succeeded", stepStatuses: statuses });
    for (const actor of stepActors.values()) actor.stop();
    runActor.stop();
    return validated;
  } catch {
    return null;
  }
}

function documentResult(record: GeneratedDocumentPersistenceRecord, binding: NonNullable<DurableExecutionRun["runtimeContext"]["requestMessageBinding"]>): unknown {
  const reference = generatedDocumentReferenceSchema.safeParse({
    kind: "generated_document",
    artifactId: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    filename: record.filename,
    format: record.format,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
  });
  if (!reference.success || reference.data.conversationId !== binding.conversationId
    || reference.data.messageId !== binding.assistantMessageId) return null;
  const result = { kind: "document", value: reference.data } as const;
  return validateExecutionStepResult(result, "document_generation") ? result : null;
}

async function validPdf(bytes: Uint8Array, expectedSize: number): Promise<boolean> {
  if (bytes.byteLength === 0 || bytes.byteLength !== expectedSize || bytes.byteLength > MAX_RECONCILIATION_BYTES) return false;
  // This cheap bounded check rejects non-PDF objects before invoking the parser.
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return false;
  try {
    await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Server-only, operator-gated reconciliation. The caller supplies only a run
 * id; the artifact is always derived from the immutable execution key and
 * accepted request binding stored on that run.
 */
export function createDocumentGenerationArtifactReconciler(
  dependencies: DocumentGenerationReconciliationDependencies,
) {
  const findDocument = dependencies.findDocument ?? findGeneratedDocumentByRequest;
  const downloadDocument = dependencies.downloadDocument ?? downloadGeneratedDocument;

  return async function reconcileDocumentGenerationArtifact(input: Readonly<{
    runId: string;
    authorization: DocumentGenerationReconciliationAuthorization;
  }>): Promise<DocumentGenerationReconciliationResult> {
    if (!dependencies.enabled || input.authorization.kind !== AUTHORIZATION_PURPOSE
      || !isUuid(input.runId)
      || !hasRunScopedAuthorization(input.authorization.token, dependencies.expectedAuthorizationSecret, input.runId)) {
      return { status: "disabled" };
    }

    const run = await dependencies.loadAcceptedRun(input.runId);
    if (!run) return { status: "not_found" };
    const binding = run.runtimeContext.requestMessageBinding;
    const target = run.steps.find((step) => step.capabilityId === "document_generation");
    if (!binding || !run.acceptedRequestId || binding.requestId !== run.acceptedRequestId || binding.userId !== run.userId
      || binding.conversationId !== run.runtimeContext.conversationId || !target) return { status: "not_eligible" };

    if (target.status === "succeeded" && run.status === "succeeded" && target.result
      && validateExecutionStepResult(target.result, "document_generation")) {
      const reference = generatedDocumentReferenceSchema.safeParse(target.result.value);
      if (reference.success && reference.data.conversationId === binding.conversationId
        && reference.data.messageId === binding.assistantMessageId) return { status: "already_reconciled" };
    }
    if (run.status !== "running" || run.controlState !== "active" || target.status !== "running"
      || target.attempt !== 1 || run.approvalCheckpoints.some((checkpoint) => checkpoint.status !== "approved")
      || run.executionPlan.orderedStepIds.at(-1) !== target.stepId
      || run.steps.some((step) => step.stepId !== target.stepId && step.status !== "succeeded")) {
      return { status: "not_eligible" };
    }

    let record: GeneratedDocumentPersistenceRecord | null;
    try {
      record = await findDocument({
        userId: run.userId,
        conversationId: binding.conversationId,
        generationRequestId: target.executionKey,
      });
    } catch {
      return { status: "artifact_invalid" };
    }
    if (!record || record.userId !== run.userId || record.conversationId !== binding.conversationId
      || record.messageId !== binding.assistantMessageId || record.generationRequestId !== target.executionKey
      || record.format !== "pdf" || record.mimeType !== "application/pdf"
      || !validateGeneratedDocumentStoragePath(record.storagePath, {
        userId: run.userId,
        conversationId: binding.conversationId,
        generatedDocumentId: record.id,
        filename: record.filename,
        format: record.format,
      })) return { status: "artifact_invalid" };

    let bytes: Uint8Array;
    try {
      bytes = await downloadDocument(record);
    } catch {
      return { status: "artifact_invalid" };
    }
    if (!await validPdf(bytes, record.sizeBytes)) return { status: "artifact_invalid" };
    const result = documentResult(record, binding);
    const snapshot = buildSnapshot(run, target.stepId);
    if (!result || !snapshot) return { status: "not_eligible" };
    const artifactSha256 = createHash("sha256").update(bytes).digest("hex");
    return dependencies.reconcile({
      runId: run.id,
      stepId: target.stepId,
      executionKey: target.executionKey,
      expectedSnapshotRevision: run.snapshotRevision,
      snapshot,
      result,
      artifactSha256,
    });
  };
}
