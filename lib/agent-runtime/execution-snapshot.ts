import { z } from "zod";
import {
  EXECUTION_RUNTIME_VERSION,
  EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  type ExecutionSnapshotEnvelope,
} from "@/lib/agent-runtime/execution-store";
import type { ExecutionRunStatus, ExecutionStepStatus } from "@/lib/agent-runtime/runtime-contracts";

const xstateSnapshotSchema = z.object({
  status: z.enum(["active", "done"]),
  value: z.string(),
  historyValue: z.record(z.string(), z.unknown()),
  context: z.record(z.string(), z.unknown()),
  children: z.record(z.string(), z.unknown()),
  output: z.unknown().optional(),
  error: z.unknown().optional(),
}).strict().superRefine((snapshot, context) => {
  if (Object.keys(snapshot.context).length > 0 || Object.keys(snapshot.children).length > 0) {
    context.addIssue({ code: "custom", message: "Execution lifecycle snapshots cannot contain collaborators or child actors." });
  }
});

const snapshotEnvelopeSchema = z.object({
  version: z.number().int(),
  runtimeVersion: z.number().int(),
  snapshot: z.object({
    run: xstateSnapshotSchema,
    steps: z.record(z.string(), xstateSnapshotSchema),
  }).strict(),
}).strict();

export class ExecutionSnapshotError extends Error {
  constructor(readonly code: "unsupported_snapshot_version" | "invalid_snapshot") {
    super(code === "unsupported_snapshot_version"
      ? "The stored execution snapshot version is not supported."
      : "The stored execution snapshot is invalid.");
    this.name = "ExecutionSnapshotError";
  }
}

export function validateExecutionSnapshot(
  input: unknown,
  expected: { readonly runStatus?: ExecutionRunStatus; readonly stepStatuses?: Readonly<Record<string, ExecutionStepStatus>> } = {},
): ExecutionSnapshotEnvelope {
  const outer = z.object({ version: z.unknown(), runtimeVersion: z.unknown() }).passthrough().safeParse(input);
  if (!outer.success || outer.data.version !== EXECUTION_SNAPSHOT_SCHEMA_VERSION
    || outer.data.runtimeVersion !== EXECUTION_RUNTIME_VERSION) {
    throw new ExecutionSnapshotError("unsupported_snapshot_version");
  }
  const parsed = snapshotEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new ExecutionSnapshotError("invalid_snapshot");
  const runSnapshot = parsed.data.snapshot.run;
  const runValue = runSnapshot.value;
  const terminalRun = runValue === "succeeded" || runValue === "failed";
  if ((expected.runStatus && runValue !== expected.runStatus)
    || runSnapshot.status !== (terminalRun ? "done" : "active")) {
    throw new ExecutionSnapshotError("invalid_snapshot");
  }
  const expectedSteps = expected.stepStatuses ?? {};
  if (Object.keys(parsed.data.snapshot.steps).length !== Object.keys(expectedSteps).length) {
    throw new ExecutionSnapshotError("invalid_snapshot");
  }
  for (const [stepId, status] of Object.entries(expectedSteps)) {
    const snapshot = parsed.data.snapshot.steps[stepId];
    const terminalStep = status === "succeeded" || status === "failed" || status === "skipped";
    if (!snapshot || snapshot.value !== status || snapshot.status !== (terminalStep ? "done" : "active")) {
      throw new ExecutionSnapshotError("invalid_snapshot");
    }
  }
  return parsed.data as ExecutionSnapshotEnvelope;
}
