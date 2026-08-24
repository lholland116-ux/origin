import type {
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RoleId,
  UserId,
} from "../domain/capa-types";

import type {
  CapaStateId,
} from "../domain/capa-state";

/**
 * Provider-neutral contract for controlled CAPA prompt assembly.
 *
 * Primary sources:
 * Document #7 — Agent Definition and Configuration Specification
 * Document #10 — Knowledge Base, Retrieval and Citation Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * BL-066
 * PAE-001 through PAE-008
 * KSEC-001 through KSEC-004
 * URS-AI-001 through URS-AI-012
 *
 * This module defines data only. It does not invoke a model, authorize an
 * operation, mutate workflow state, or persist an AI output.
 */

type BrandedAiValue<Name extends string> =
  string & {
    readonly __brand: Name;
  };

export type CapaAiRunId =
  BrandedAiValue<"CapaAiRunId">;

export type CapaAiOutputId =
  BrandedAiValue<"CapaAiOutputId">;

export type CapaAgentId =
  BrandedAiValue<"CapaAgentId">;

export type CapaPromptPackageId =
  BrandedAiValue<"CapaPromptPackageId">;

export type KnowledgeCollectionId =
  BrandedAiValue<"KnowledgeCollectionId">;

export type KnowledgeSourceId =
  BrandedAiValue<"KnowledgeSourceId">;

export type KnowledgePassageId =
  BrandedAiValue<"KnowledgePassageId">;

export type CapaToolId =
  BrandedAiValue<"CapaToolId">;

export type CapaToolInvocationId =
  BrandedAiValue<"CapaToolInvocationId">;

export type ControlledVersion =
  BrandedAiValue<"ControlledVersion">;

/** Exact, immutable order required by PAE-001 and PAE-007. */
export const CAPA_PROMPT_LAYER_ORDER = [
  "platform_system_policy",
  "product_policy",
  "agent_definition",
  "workflow_context",
  "authorization_context",
  "minimum_case_context",
  "retrieved_sources",
  "user_request",
  "tool_results",
  "output_contract",
] as const;

export type CapaPromptLayerName =
  (typeof CAPA_PROMPT_LAYER_ORDER)[number];

export const CAPA_PROMPT_TRUST_LEVELS = [
  "trusted_control",
  "trusted_server_context",
  "untrusted_data",
] as const;

export type CapaPromptTrustLevel =
  (typeof CAPA_PROMPT_TRUST_LEVELS)[number];

export const CAPA_AI_OUTPUT_STATUSES = [
  "completed_draft",
  "validation_failed",
  "service_failed",
] as const;

/** An AI output can never represent approval or final human authority. */
export type CapaAiOutputStatus =
  (typeof CAPA_AI_OUTPUT_STATUSES)[number];

export interface CapaPromptComponentVersions {
  readonly assembly_version: ControlledVersion;
  readonly platform_policy_version: ControlledVersion;
  readonly product_policy_version: ControlledVersion;
  readonly agent_version: ControlledVersion;
  readonly workflow_context_version: ControlledVersion;
  readonly authorization_context_version: ControlledVersion;
  readonly case_context_schema_version: ControlledVersion;
  readonly retrieval_policy_version: ControlledVersion;
  readonly tool_policy_version: ControlledVersion;
  readonly output_schema_version: ControlledVersion;
  readonly model_profile_version: ControlledVersion;
  readonly evaluation_suite_version: ControlledVersion;
}

export interface CapaPromptScope {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: CapaStateId;
}

export interface CapaPromptTrace {
  readonly run_id: CapaAiRunId;
  readonly prompt_package_id: CapaPromptPackageId;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly assembled_at: IsoDateTime;
}

export interface CapaAgentReference {
  readonly agent_id: CapaAgentId;
  readonly agent_version: ControlledVersion;
  readonly output_type: ControlledCode;
}

export interface CapaAuthorizedHumanContext {
  readonly user_id: UserId;
  readonly active_role_ids: readonly RoleId[];
  readonly relied_on_role_assignment_ids:
    readonly string[];
  readonly authorized_operation: ControlledCode;
  readonly authorization_policy_version:
    ControlledVersion;
}

/**
 * A minimized server-selected case field. Field allowlisting is performed
 * by the assembler; callers cannot use this structure to request fields.
 */
export interface CapaMinimumCaseContextItem {
  readonly field_code: ControlledCode;
  readonly value: unknown;
  readonly source_object_id: string;
  readonly source_object_version_id: string;
}

/**
 * Delimited user or external content. Its contents are data only and must
 * never change policy, authorization, workflow, tools, filters or schema.
 */
export interface CapaUntrustedText {
  readonly trust: "untrusted_data";
  readonly content: string;
  readonly provenance_type:
    | "user_request"
    | "retrieved_passage"
    | "tool_result";
}

export type KnowledgeSourceStatus =
  | "approved"
  | "superseded"
  | "rejected"
  | "unavailable"
  | "unverified";

export interface CapaRetrievedPassage {
  readonly organization_id: OrganizationId;
  readonly collection_id: KnowledgeCollectionId;
  readonly source_id: KnowledgeSourceId;
  readonly source_version: ControlledVersion;
  readonly passage_id: KnowledgePassageId;
  readonly source_status: KnowledgeSourceStatus;
  readonly source_type: ControlledCode;
  readonly issuer?: string;
  readonly jurisdiction?: string;
  readonly title: string;
  readonly precise_locator: string;
  readonly retrieved_at: IsoDateTime;
  readonly text: CapaUntrustedText;
}

export type CapaToolResultStatus =
  | "succeeded"
  | "failed"
  | "blocked";

export interface CapaToolResult {
  readonly tool_id: CapaToolId;
  readonly tool_version: ControlledVersion;
  readonly invocation_id: CapaToolInvocationId;
  readonly status: CapaToolResultStatus;
  readonly result: CapaUntrustedText;
}

export interface CapaPromptLayer {
  readonly position: number;
  readonly name: CapaPromptLayerName;
  readonly trust: CapaPromptTrustLevel;
  readonly content: unknown;
  readonly content_version?: ControlledVersion;
}

/**
 * Exact ten-layer tuple. The assembler must produce this shape and order;
 * it must not silently omit or append layers.
 */
export type CapaPromptLayers = readonly [
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
  CapaPromptLayer,
];

export interface CapaPromptAssemblyRequest {
  readonly scope: CapaPromptScope;
  readonly trace: CapaPromptTrace;
  readonly agent: CapaAgentReference;
  readonly authorization: CapaAuthorizedHumanContext;
  readonly component_versions:
    CapaPromptComponentVersions;
  readonly minimum_case_context:
    readonly CapaMinimumCaseContextItem[];
  readonly retrieved_passages:
    readonly CapaRetrievedPassage[];
  readonly user_request: CapaUntrustedText;
  readonly tool_results: readonly CapaToolResult[];
}

export interface CapaControlledPromptPackage {
  readonly scope: CapaPromptScope;
  readonly trace: CapaPromptTrace;
  readonly agent: CapaAgentReference;
  readonly component_versions:
    CapaPromptComponentVersions;
  readonly layers: CapaPromptLayers;
  readonly reduction_applied: boolean;
  readonly reduction_record?: Readonly<
    Record<string, unknown>
  >;
}

export interface CapaAiOutputEnvelope<
  Proposal = Readonly<Record<string, unknown>>,
> {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly agent: CapaAgentReference;
  readonly scope: CapaPromptScope;
  readonly output_schema_version: ControlledVersion;
  readonly status: CapaAiOutputStatus;
  readonly proposal: Proposal | null;
  readonly evidence_links: readonly string[];
  readonly citations: readonly string[];
  readonly assumptions: readonly string[];
  readonly missing_information: readonly string[];
  readonly conflicts_and_alternatives:
    readonly string[];
  readonly uncertainty_and_limitations:
    readonly string[];
  readonly human_action_required: readonly string[];
  readonly warnings: readonly string[];
}
