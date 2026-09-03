import type OpenAI from "openai";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
  type CapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "./capa-investigation-planning-advisory-model-profile";

export class OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError
  extends Error {
  constructor() {
    super("The governed CAPA structured model operation failed.");
    this.name =
      "OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError";
  }
}

export interface OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientOptions {
  readonly model: string;
}

function controlledModel(value: unknown): string {
  if (typeof value !== "string") {
    throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
  }

  const model = value.trim();
  if (model.length === 0 || model.length > 128) {
    throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
  }

  return model;
}

function controlledSchema(value: unknown):
  typeof CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      JSON.stringify(value) !==
        JSON.stringify(CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA)
    ) {
      throw new Error();
    }
  } catch {
    throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
  }

  return CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA;
}

/**
 * OpenAI Responses API transport for the governed S30 advisory operation.
 * It has no CAPA authorization, persistence, workflow, retrieval, or tool
 * responsibilities.
 */
export class OpenAICapaInvestigationPlanningAdvisoryStructuredModelClient
  implements CapaInvestigationPlanningAdvisoryStructuredModelClient {
  private readonly model: string;

  constructor(
    private readonly client: Pick<OpenAI, "responses">,
    options: OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientOptions,
  ) {
    this.model = controlledModel(options.model);
  }

  async generateStructured(
    input: Parameters<
      CapaInvestigationPlanningAdvisoryStructuredModelClient[
        "generateStructured"
      ]
    >[0],
  ): Promise<{ readonly output_text: string }> {
    if (
      typeof input.prompt !== "string" ||
      input.prompt.trim().length === 0 ||
      input.model_profile_version !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version ||
      input.output_schema_name !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name ||
      input.maximum_output_characters !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
          .maximum_output_characters ||
      input.store !== false
    ) {
      throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
    }

    const schema = controlledSchema(input.output_schema);

    let response: Awaited<ReturnType<OpenAI["responses"]["create"]>>;
    try {
      response = await this.client.responses.create({
        model: this.model,
        input: input.prompt,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: input.output_schema_name,
            schema,
            strict: true,
          },
        },
      });
    } catch {
      throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
    }

    let outputText: unknown;
    try {
      outputText = response.output_text;
    } catch {
      throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
    }

    if (
      typeof outputText !== "string" ||
      outputText.trim().length === 0 ||
      outputText.length >
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
          .maximum_output_characters
    ) {
      throw new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError();
    }

    return Object.freeze({ output_text: outputText });
  }
}

export function createOpenAICapaInvestigationPlanningAdvisoryStructuredModelClient(
  client: Pick<OpenAI, "responses">,
  options: OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientOptions,
): CapaInvestigationPlanningAdvisoryStructuredModelClient {
  return new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClient(
    client,
    options,
  );
}
