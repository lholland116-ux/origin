import type { PlanStep } from "@/lib/ai/intelligence-plan";
import type {
  ExecutionControlEvent,
  ExecutionControlState,
  ExecutionRunStatus,
  ExecutionStepResult,
  ExecutionStepStatus,
  HumanApprovalCheckpoint,
} from "@/lib/agent-runtime/runtime-contracts";
import type { RuntimeAttachmentReference } from "@/lib/agent-runtime/capability-executor";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import type { UserReasoningMode } from "@/lib/ai/reasoning-mode";

export const EXECUTION_RUNTIME_VERSION = 1 as const;
export const EXECUTION_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_WORK_LEASE_POLICY = Object.freeze({
  defaultSeconds: 120,
  minimumSeconds: 30,
  maximumSeconds: 900,
  maximumDiscoveryBatch: 100,
} as const);

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
  readonly conversationId: string;
  /** Immutable for the lifetime of a durable run; legacy rows may omit it. */
  readonly requestMessageBinding?: RequestMessageBinding;
  readonly userInput?: string;
  readonly reasoningMode?: UserReasoningMode;
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
  readonly attempt: number;
  readonly executionKey: string;
  readonly status: ExecutionStepStatus;
  readonly nextRetryAt?: string;
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
  /** Present only for runs atomically associated with the acceptance ledger. */
  readonly acceptedRequestId?: string;
  /** Acceptance identity fingerprint; distinct from requestFingerprint (plan/runtime). */
  readonly acceptanceFingerprint?: string;
  readonly executionPlan: PersistedExecutionPlan;
  readonly runtimeContext: PersistedExecutionContext;
  readonly status: ExecutionRunStatus;
  readonly controlState: ExecutionControlState;
  readonly controlRevision: number;
  readonly failureCode?: string;
  readonly snapshotSchemaVersion: number;
  readonly snapshotRevision: number;
  readonly snapshot: ExecutionSnapshotEnvelope;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly steps: readonly DurableExecutionStep[];
  readonly approvalCheckpoints: readonly HumanApprovalCheckpoint[];
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
  readonly approvalCheckpoints?: readonly {
    readonly id: string;
    readonly stepId: string;
    readonly stepFingerprint: string;
  }[];
  readonly createdAt: string;
};

export type CreateDurableExecutionRunResult =
  | { readonly status: "created" | "existing"; readonly run: DurableExecutionRun }
  | { readonly status: "idempotency_conflict" };

export type AcceptedRequestExecutionIdentity = Readonly<{
  readonly requestId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}>;

export type ExecutionWorkClaim = Readonly<{
  readonly claimId: string;
  readonly fencingGeneration: number;
}>;

export type DiscoveredExecutionWork = Readonly<{
  readonly runId: string;
  readonly stepId: string;
  readonly kind: "runnable" | "recovery_required";
  readonly dueAt: string;
  readonly fencingGeneration: number;
}>;

export type ExecutionWorkClaimResult =
  | Readonly<{ status: "claimed"; claim: ExecutionWorkClaim; runId: string; stepId: string; snapshotRevision: number; leaseExpiresAt: string }>
  | Readonly<{ status: "busy" | "ineligible" | "recovery_required" | "stale_claim" | "not_found" }>;

export type ExecutionWorkLeaseResult =
  | Readonly<{ status: "renewed" | "released"; leaseExpiresAt?: string }>
  | Readonly<{ status: "stale_claim" | "ineligible" | "revision_conflict" | "not_found" | "unsafe_boundary" }>;

export type OrphanedAcceptedRequest = Readonly<{
  readonly requestId: string;
  readonly createdAt: string;
  readonly classification: "association_recovery_blocked";
}>;

export type AssociateAcceptedExecutionRunInput = Readonly<{
  readonly acceptance: AcceptedRequestExecutionIdentity;
  readonly run: CreateDurableExecutionRunInput;
}>;

export type AssociateAcceptedExecutionRunResult =
  | { readonly status: "created" | "existing"; readonly runId: string; readonly planFingerprint: string }
  | { readonly status: "conflict" };

export type LookupAcceptedExecutionRunResult =
  | { readonly status: "found"; readonly run: DurableExecutionRun }
  | { readonly status: "not_found" | "conflict" };

export type DurableStepCheckpoint = {
  readonly stepId: string;
  readonly status: Exclude<ExecutionStepStatus, "pending" | "running" | "retry_pending">;
  readonly result?: ExecutionStepResult;
  readonly failureCode?: string;
  readonly completedAt: string;
};

export type ExecutionStoreWriteResult =
  | { readonly status: "saved"; readonly snapshotRevision: number; readonly controlState?: ExecutionControlState; readonly controlRevision?: number }
  | { readonly status: "result_too_large" }
  | { readonly status: "conflict" | "not_found" };

export type ClaimDurableStepResult =
  | { readonly status: "claimed"; readonly executionKey: string; readonly snapshotRevision: number }
  | { readonly status: "approval_required"; readonly checkpoint: HumanApprovalCheckpoint }
  | { readonly status: "control_blocked"; readonly controlState: ExecutionControlState }
  | { readonly status: "already_claimed"; readonly stepStatus: ExecutionStepStatus }
  | { readonly status: "conflict" | "not_found" };

export type ScheduleDurableStepRetryResult =
  | { readonly status: "saved"; readonly snapshotRevision: number; readonly controlState?: ExecutionControlState; readonly controlRevision?: number }
  | { readonly status: "attempt_limit" }
  | { readonly status: "conflict" | "not_found" };

export type ClaimRetryableStepResult =
  | { readonly status: "claimed"; readonly executionKey: string; readonly attempt: number; readonly snapshotRevision: number }
  | { readonly status: "approval_required"; readonly checkpoint: HumanApprovalCheckpoint }
  | { readonly status: "control_blocked"; readonly controlState: ExecutionControlState }
  | { readonly status: "not_eligible"; readonly nextRetryAt: string }
  | { readonly status: "attempt_limit" }
  | { readonly status: "already_claimed"; readonly stepStatus: ExecutionStepStatus }
  | { readonly status: "conflict" | "not_found" };

export type ExecutionControlWriteResult =
  | { readonly status: "saved"; readonly controlState: "active"; readonly controlRevision: number }
  | { readonly status: "pause_requested" | "paused" | "stop_requested" | "stopped"; readonly controlState: "pause_requested" | "paused" | "stop_requested" | "stopped"; readonly controlRevision: number }
  | { readonly status: "already_applied"; readonly controlState: ExecutionControlState; readonly controlRevision: number }
  | { readonly status: "conflict" | "not_found" | "terminal" | "approval_pending" | "unsafe_boundary" };

export type HumanApprovalWriteResult =
  | { readonly status: "created" | "existing"; readonly checkpoint: HumanApprovalCheckpoint; readonly controlRevision: number }
  | { readonly status: "approved" | "returned"; readonly checkpoint: HumanApprovalCheckpoint; readonly controlState: ExecutionControlState; readonly controlRevision: number }
  | { readonly status: "already_decided"; readonly checkpoint: HumanApprovalCheckpoint; readonly controlState: ExecutionControlState; readonly controlRevision: number }
  | { readonly status: "conflict" | "not_found" | "terminal" | "unsafe_boundary" | "invalid_checkpoint" };

export type CreateHumanApprovalCheckpointInput = {
  readonly runId: string;
  readonly userId: string;
  readonly expectedControlRevision: number;
  readonly checkpointId: string;
  readonly stepId: string;
  readonly planFingerprint: string;
  readonly stepFingerprint: string;
  readonly source: "runtime_policy" | "owner_request";
};

export type DecideHumanApprovalInput = {
  readonly runId: string;
  readonly userId: string;
  readonly expectedControlRevision: number;
  readonly checkpointId: string;
  readonly decision: "approve" | "return";
  readonly rationale?: string;
  readonly decidedAt: string;
};

/** LVTChat-owned persistence boundary; no Supabase/Postgres client types escape this interface. */
export interface ExecutionStore {
  /** Bounded, content-free server discovery; this never claims or dispatches work. */
  discoverExecutionWork(input: { readonly limit?: number }): Promise<readonly DiscoveredExecutionWork[]>;
  /** Atomically claims an eligible accepted execution using a caller-generated idempotency identity. */
  claimExecutionWork(input: { readonly runId: string; readonly claimId: string; readonly leaseSeconds?: number }): Promise<ExecutionWorkClaimResult>;
  renewExecutionWorkClaim(input: { readonly runId: string; readonly claim: ExecutionWorkClaim; readonly leaseSeconds?: number }): Promise<ExecutionWorkLeaseResult>;
  releaseExecutionWorkClaim(input: { readonly runId: string; readonly claim: ExecutionWorkClaim; readonly expectedRevision: number }): Promise<ExecutionWorkLeaseResult>;
  /** Detection only: accepted requests without a validated plan are never replayed here. */
  listOrphanedAcceptedRequests(input: { readonly limit?: number }): Promise<readonly OrphanedAcceptedRequest[]>;
  createRun(input: CreateDurableExecutionRunInput): Promise<CreateDurableExecutionRunResult>;
  /** Atomically verifies immutable acceptance identity and creates/retrieves its sole run. */
  associateAcceptedRequest(input: AssociateAcceptedExecutionRunInput): Promise<AssociateAcceptedExecutionRunResult>;
  /** Owner-scoped, immutable acceptance lookup used before any replay replans. */
  lookupAcceptedRequestRun(input: AcceptedRequestExecutionIdentity): Promise<LookupAcceptedExecutionRunResult>;
  /** Server/worker-only lookup; owner is derived from the acceptance ledger, never supplied by the caller. */
  getAcceptedRunForFinalization(input: { readonly runId: string }): Promise<DurableExecutionRun | null>;
  getRun(input: { readonly runId: string; readonly userId: string }): Promise<DurableExecutionRun | null>;
  getControlEvents(input: { readonly runId: string; readonly userId: string }): Promise<readonly ExecutionControlEvent[]>;
  pauseRun(input: { readonly runId: string; readonly userId: string; readonly expectedControlRevision: number; readonly actorUserId: string; readonly createdAt: string }): Promise<ExecutionControlWriteResult>;
  resumeRun(input: { readonly runId: string; readonly userId: string; readonly expectedControlRevision: number; readonly actorUserId: string; readonly createdAt: string }): Promise<ExecutionControlWriteResult>;
  stopRun(input: { readonly runId: string; readonly userId: string; readonly expectedControlRevision: number; readonly actorUserId: string; readonly createdAt: string }): Promise<ExecutionControlWriteResult>;
  createApprovalCheckpoint(input: CreateHumanApprovalCheckpointInput & { readonly createdAt: string; readonly actorUserId?: string }): Promise<HumanApprovalWriteResult>;
  decideApprovalCheckpoint(input: DecideHumanApprovalInput & { readonly actorUserId: string }): Promise<HumanApprovalWriteResult>;
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
    readonly workClaim?: ExecutionWorkClaim;
  }): Promise<ExecutionStoreWriteResult>;
  claimStep(input: {
    readonly runId: string;
    readonly userId: string;
    readonly stepId: string;
    readonly expectedRevision: number;
    readonly snapshot: ExecutionSnapshotEnvelope;
    readonly startedAt: string;
    readonly workClaim?: ExecutionWorkClaim;
  }): Promise<ClaimDurableStepResult>;
  scheduleStepRetry(input: {
    readonly runId: string;
    readonly userId: string;
    readonly stepId: string;
    readonly expectedRevision: number;
    readonly snapshot: ExecutionSnapshotEnvelope;
    readonly nextRetryAt: string;
    readonly workClaim?: ExecutionWorkClaim;
  }): Promise<ScheduleDurableStepRetryResult>;
  claimRetryableStep(input: {
    readonly runId: string;
    readonly userId: string;
    readonly stepId: string;
    readonly expectedRevision: number;
    readonly snapshot: ExecutionSnapshotEnvelope;
    readonly workClaim?: ExecutionWorkClaim;
  }): Promise<ClaimRetryableStepResult>;
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
    readonly workClaim?: ExecutionWorkClaim;
  }): Promise<ExecutionStoreWriteResult>;
}
