import type {
  CapaIntakeAdvisoryGenerationInput,
} from "./capa-intake-advisory-service";

import type {
  CapaAiRunId,
  CapaPromptPackageId,
  CapaRetrievedPassage,
  ControlledVersion,
  KnowledgeCollectionId,
  KnowledgePassageId,
  KnowledgeSourceId,
} from "./capa-prompt-contract";

import type {
  CapaPromptAssemblyRequest,
  CapaControlledPromptPackage,
} from "./capa-prompt-contract";

import type {
  CapaPromptConfiguration,
} from "./capa-prompt-configuration";

import {
  assembleCapaPrompt,
} from "./capa-prompt-assembler";

/**
 * M5G Change Set 5B
 *
 * Advisory-specific adapter between governed CAPA intake evidence and the
 * deterministic CAPA prompt assembler.
 *
 * Security properties:
 * - run identity is server-created;
 * - prompt package identity is server-created;
 * - browser input cannot select controlled prompt policy;
 * - retrieved evidence remains untrusted data;
 * - evidence is structurally narrowed before prompt assembly;
 * - prompt assembly remains delegated to the existing deterministic,
 *   fail-closed CAPA prompt assembler.
 */

export interface CapaIntakeAdvisoryPromptIdentityFactory {
  createPromptPackageId(): CapaPromptPackageId;
}

export interface CapaIntakeAdvisoryPromptClock {
  now(): Date;
}

export interface CapaIntakeAdvisoryControlledPromptRendererDependencies {
  readonly configuration:
    CapaPromptConfiguration;
  readonly identity_factory:
    CapaIntakeAdvisoryPromptIdentityFactory;
  readonly clock:
    CapaIntakeAdvisoryPromptClock;
}

export interface CapaIntakeAdvisoryControlledPromptRenderInput {
  readonly generation_input:
    CapaIntakeAdvisoryGenerationInput;
  readonly run_id: CapaAiRunId;
}

export interface CapaIntakeAdvisoryControlledPromptRenderResult {
  readonly prompt_package:
    CapaControlledPromptPackage;
  readonly rendered_prompt: string;
}

type EvidenceRecord =
  Readonly<Record<string, unknown>>;

function isRecord(
  value: unknown,
): value is EvidenceRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `CONTROLLED_CAPA_EVIDENCE_INVALID:${field}`,
    );
  }

  return value;
}

function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requiredString(value, field);
}

function locatorText(
  value: unknown,
): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "CONTROLLED_CAPA_EVIDENCE_INVALID:locators",
    );
  }

  const rendered = value.map(
    (locator, index) => {
      if (!isRecord(locator)) {
        throw new Error(
          `CONTROLLED_CAPA_EVIDENCE_INVALID:locators[${index}]`,
        );
      }

      const kind = requiredString(
        locator.kind,
        `locators[${index}].kind`,
      );

      const label = requiredString(
        locator.label,
        `locators[${index}].label`,
      );

      return `${kind}: ${label}`;
    },
  );

  return rendered.join("; ");
}

function sourceStatus(
  value: unknown,
): CapaRetrievedPassage["source_status"] {
  /*
   * Knowledge retrieval uses lifecycle terminology that is more specific than
   * the provider-neutral prompt contract. Only controlled usable source
   * states may enter the prompt package.
   */
  switch (value) {
    case "current_effective":
      return "approved";

    case "superseded":
      return "superseded";

    case "rejected":
      return "rejected";

    case "unavailable":
      return "unavailable";

    case "unverified":
      return "unverified";

    default:
      throw new Error(
        "CONTROLLED_CAPA_EVIDENCE_INVALID:source_status_at_use",
      );
  }
}

function retrievedPassage(
  value: unknown,
  expectedOrganizationId: string,
  assembledAt: string,
): CapaRetrievedPassage {
  if (!isRecord(value)) {
    throw new Error(
      "CONTROLLED_CAPA_EVIDENCE_INVALID:prompt_context",
    );
  }

  const organizationId =
    requiredString(
      value.organization_id,
      "organization_id",
    );

  if (
    organizationId !==
    expectedOrganizationId
  ) {
    throw new Error(
      "CONTROLLED_CAPA_EVIDENCE_SCOPE_MISMATCH",
    );
  }

  if (!isRecord(value.text)) {
    throw new Error(
      "CONTROLLED_CAPA_EVIDENCE_INVALID:text",
    );
  }

  if (
    value.text.trust !== "untrusted_data" ||
    value.text.provenance_type !==
      "retrieved_passage"
  ) {
    throw new Error(
      "CONTROLLED_CAPA_EVIDENCE_TRUST_INVALID",
    );
  }

  const content =
    requiredString(
      value.text.content,
      "text.content",
    );

  const issuer =
    optionalString(
      value.issuer,
      "issuer",
    );

  const jurisdiction =
    optionalString(
      value.jurisdiction,
      "jurisdiction",
    );

  return Object.freeze({
    organization_id:
      organizationId as never,

    collection_id:
      requiredString(
        value.collection_id,
        "collection_id",
      ) as KnowledgeCollectionId,

    source_id:
      requiredString(
        value.source_id,
        "source_id",
      ) as KnowledgeSourceId,

    source_version:
      requiredString(
        value.source_version_id,
        "source_version_id",
      ) as ControlledVersion,

    passage_id:
      requiredString(
        value.passage_id,
        "passage_id",
      ) as KnowledgePassageId,

    source_status:
      sourceStatus(
        value.source_status_at_use,
      ),

    source_type:
      requiredString(
        value.source_type,
        "source_type",
      ) as never,

    ...(issuer === undefined
      ? {}
      : { issuer }),

    ...(jurisdiction === undefined
      ? {}
      : { jurisdiction }),

    title:
      requiredString(
        value.title,
        "title",
      ),

    precise_locator:
      locatorText(value.locators),

    /*
     * 5A preserves retrieval-run provenance but does not expose the original
     * per-passage retrieval timestamp. Prompt assembly time is therefore the
     * controlled timestamp available at this adapter boundary.
     */
    retrieved_at:
      assembledAt as never,

    text: Object.freeze({
      trust: "untrusted_data",
      provenance_type:
        "retrieved_passage",
      content,
    }),
  });
}

function renderPackage(
  promptPackage: CapaControlledPromptPackage,
): string {
  /*
   * The model receives only the already assembled package. JSON serialization
   * preserves layer order and explicit trust metadata while avoiding a second,
   * independent prompt-construction path.
   */
  return JSON.stringify({
    prompt_package_id:
      promptPackage.trace
        .prompt_package_id,
    run_id:
      promptPackage.trace.run_id,
    layers:
      promptPackage.layers,
  });
}

export class CapaIntakeAdvisoryControlledPromptRenderer {
  constructor(
    private readonly dependencies:
      CapaIntakeAdvisoryControlledPromptRendererDependencies,
  ) {}

  build(
    input:
      CapaIntakeAdvisoryControlledPromptRenderInput,
  ): CapaIntakeAdvisoryControlledPromptRenderResult {
    const now =
      this.dependencies.clock.now();

    if (
      !(now instanceof Date) ||
      Number.isNaN(now.getTime())
    ) {
      throw new Error(
        "CONTROLLED_CAPA_PROMPT_TIME_INVALID",
      );
    }

    const assembledAt =
      now.toISOString();

    const generation =
      input.generation_input;

    const passages =
      generation.evidence.prompt_context.map(
        (value) =>
          retrievedPassage(
            value,
            generation.context
              .organization_id,
            assembledAt,
          ),
      );

    const focus =
      generation.request.focus;

    const userRequest =
      focus === null
        ? `Requested CAPA advisory output: ${generation.request.requested_output}.`
        : `Requested CAPA advisory output: ${generation.request.requested_output}. Focus: ${focus}`;

    const request:
      CapaPromptAssemblyRequest = {
        scope: {
          organization_id:
            generation.context
              .organization_id,
          capa_case_id:
            generation.context
              .capa_case_id,
          case_version_id:
            generation.context
              .case_version_id,
          record_version:
            generation.context
              .record_version,
          workflow_state:
            generation.context
              .workflow_state,
        },

        trace: {
          run_id:
            input.run_id,
          prompt_package_id:
            this.dependencies
              .identity_factory
              .createPromptPackageId(),
          request_id:
            generation.request_id,
          correlation_id:
            generation.correlation_id,
          assembled_at:
            assembledAt as never,
        },

        agent: {
          agent_id:
            generation.agent
              .agent_id as never,
          agent_version:
            generation.agent
              .agent_version as never,
          output_type:
            generation.agent
              .output_schema_version as never,
        },

        authorization: {
          user_id:
            generation.context.user_id,
          active_role_ids:
            generation.context
              .active_role_ids,

          /*
           * The advisory context does not yet expose persisted role-assignment
           * identifiers. Do not fabricate them.
           */
          relied_on_role_assignment_ids:
            Object.freeze([]),

          authorized_operation:
            "draft_intake_analysis" as never,

          authorization_policy_version:
            this.dependencies
              .configuration
              .component_versions
              .authorization_context_version,
        },

        component_versions:
          this.dependencies
            .configuration
            .component_versions,

        minimum_case_context:
          generation.context
            .minimum_case_context,

        retrieved_passages:
          Object.freeze(passages),

        user_request:
          Object.freeze({
            trust: "untrusted_data",
            provenance_type:
              "user_request",
            content: userRequest,
          }),

        tool_results:
          Object.freeze([]),
      };

    const promptPackage =
      assembleCapaPrompt(
        this.dependencies.configuration,
        request,
      );

    return Object.freeze({
      prompt_package:
        promptPackage,
      rendered_prompt:
        renderPackage(promptPackage),
    });
  }

  /**
   * Production model-generator boundary.
   *
   * The generator receives only the serialized form of the already
   * assembled controlled prompt package. build() remains available for
   * validation and traceability tests.
   */
  render(
    input:
      CapaIntakeAdvisoryControlledPromptRenderInput,
  ): string {
    return this.build(input)
      .rendered_prompt;
  }
}

export function createCapaIntakeAdvisoryControlledPromptRenderer(
  dependencies:
    CapaIntakeAdvisoryControlledPromptRendererDependencies,
): CapaIntakeAdvisoryControlledPromptRenderer {
  return new CapaIntakeAdvisoryControlledPromptRenderer(
    dependencies,
  );
}
