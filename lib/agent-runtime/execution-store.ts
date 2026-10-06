import type { PlanStep } from "@/lib/ai/intelligence-plan";
import type {
  ExecutionRunStatus,
  ExecutionStepResult,
  ExecutionStepStatus,
} from "@/lib/agent-runtime/runtime-contracts";
import type { RuntimeAttachmentReference } from "@/lib/agent-runtime/capability-executor";

export const EXECUTION_RUNTIME_VERSION = 1 as const;
export const EXECUTION_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type PersistedExecutionPlan = {
  readonly version: 1;
  readonly steps: readonly PlanStep[];
  readonly orderedStepIds: readonly string[];
  readonly plannerSource: "deterministic" | "model";
  readonly governance: {
    readonly maxSteps: number;
    readonly capabilityIds: readonly string[];
    readonly modelPlanningAllowed: boolean;
    readonly maxModelCalls: number;
    readonly maxRepairAttempts: number;
    readonly attachmentContextAllowed: boolean;
    readonly handoffVersion: number;
  };
  readonly attachmentContext?: { readonly imageCount: number; readonly fileCount: number };
};

export type PersistedExecutionContext = {
  readonly userInput?: string;
  readonly attachments: readonly RuntimeAttachmentReference[];
  readonly resourceReferences: readonly string[];
  readonly organizationId?: string;
};

export type ExecutionSnapshotEnvelope = {
  readonly version: 1;
  readonly runtimeVersion: 1;
  readonly snapshot: {
    readonly run: unknown;
    readonly steps: Readonly<Record<string, unknown>>;
  };
};

export type DurableExecutionStep = {
  readonly runId: string;
  readonly userId: string;
  readonly stepId: string;
  readonly capabilityId: string;
  readonly dependencyIds: readonly string[];
  readonly attempt: 1;
  readonly executionKey: string;
  readonly status: ExecutionStepStatus;
  readonly result?: ExecutionStepResult;
  readonly failureCode?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
};

export type DurableExecutionRun = {
  readonly id: string;
  readonly userId: string;
  readonly runtimeVersion: number;
  readonly handoffVersion: number;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly executionPlan: PersistedExecutionPlan;
  readonly runtimeContext: PersistedExecutionContext;
  readonly status: ExecutionRunStatus;
  readonly failureCode?: string;
  readonly snapshotSchemaVersion: number;
  readonly snapshotRevision: number;
  readonly snapshot: ExecutionSnapshotEnvelope;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly steps: readonly DurableExecutionStep[];
};

export type CreateDurableExecutionRunInput = {
  readonly id: string;
  readonly userId: string;
  readonly handoffVersion: number;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly executionPlan: PersistedExecutionPlan;
  readonly runtimeContext: PersistedExecutionContext;
  readonly snapshot: ExecutionSnapshotEnvelope;
  readonly steps: readonly {
    readonly stepId: string;
    readonly capabilityId: string;
    readonly dependencyIds: readonly string[];
    readonly executionKey: string;
  }[];
  readonly createdAt: string;
};

export type CreateDurableExecutionRunResult =
  | { readonly status: "created" | "existing"; readonly run: DurableExecutionRun }
  | { readonly status: "idempotency_conflict" };

export type DurableStepCheckpoint = {
  readonly stepId: string;
  readonly status: Exclude<ExecutionStepStatus, "pending" | "running">;
  readonly result?: ExecutionStepResult;
  readonly failureCode?: string;
  readonly completedAt: string;
};

export type ExecutionStoreWriteResult =
  | { readonly status: "saved"; readonly snapshotRevision: number }
  | { readonly status: "conflict" | "not_found" };

export type ClaimDurableStepResult =
  | { readonly status: "claimed"; readonly executionKey: string; readonly snapshotRevision: number }
  | { readonly status: "already_claimed"; readonly stepStatus: ExecutionStepStatus }
  | { readonly status: "conflict" | "not_found" };

/** LVTChat-owned persistence boundary; no Supabase/Postgres client types escape this interface. */
export interface ExecutionStore {
  createRun(input: CreateDurableExecutionRunInput): Promise<CreateDurableExecutionRunResult>;
  getRun(input: { readonly runId: string; readonly userId: string }): Promise<DurableExecutionRun | null>;
  saveRunState(input: {
    readonly runId: string;
    readonly userId: string;
    readonly expectedRevision: number;
    readonly status: ExecutionRunStatus;
    readonly snapshot: ExecutionSnapshotEnvelope;
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly failureCode?: string;
    readonly retainUserInput?: boolean;
  }): Promise<ExecutionStoreWriteResult>;
  claimStep(input: {
    readonly runId: string;
    readonly userId: string;
    readonly stepId: string;
    readonly expectedRevision: number;
    readonly snapshot: ExecutionSnapshotEnvelope;
    readonly startedAt: string;
  }): Promise<ClaimDurableStepResult>;
  checkpoint(input: {
    readonly runId: string;
    readonly userId: string;
    readonly expectedRevision: number;
    readonly runStatus: ExecutionRunStatus;
    readonly snapshot: ExecutionSnapshotEnvelope;
    readonly updates: readonly DurableStepCheckpoint[];
    readonly completedAt?: string;
    readonly failureCode?: string;
    readonly retainUserInput?: boolean;
  }): Promise<ExecutionStoreWriteResult>;
}
