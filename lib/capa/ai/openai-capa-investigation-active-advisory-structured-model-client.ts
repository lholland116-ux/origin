import type OpenAI from "openai";

import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE,
  type CapaInvestigationActiveAdvisoryStructuredModelClient,
} from "./capa-investigation-active-advisory-model-profile";

export class OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError
  extends Error {
  constructor() {
    super("The governed CAPA structured model operation failed.");
    this.name =
      "OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError";
  }
}

export interface OpenAICapaInvestigationActiveAdvisoryStructuredModelClientOptions {
  readonly model: string;
}

function controlledModel(value: unknown): string {
  if (typeof value !== "string") {
    throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
  }

  const model = value.trim();
  if (model.length === 0 || model.length > 128) {
    throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
  }

  return model;
}

function controlledSchema(value: unknown):
  typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      JSON.stringify(value) !==
        JSON.stringify(CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA)
    ) {
      throw new Error();
    }
  } catch {
    throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
  }

  return CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA;
}

/** OpenAI transport only; it has no CAPA governance or persistence authority. */
export class OpenAICapaInvestigationActiveAdvisoryStructuredModelClient
  implements CapaInvestigationActiveAdvisoryStructuredModelClient {
  private readonly model: string;

  constructor(
    private readonly client: Pick<OpenAI, "responses">,
    options: OpenAICapaInvestigationActiveAdvisoryStructuredModelClientOptions,
  ) {
    this.model = controlledModel(options.model);
  }

  async generateStructured(
    input: Parameters<
      CapaInvestigationActiveAdvisoryStructuredModelClient[
        "generateStructured"
      ]
    >[0],
  ): Promise<{ readonly output_text: string }> {
    if (
      typeof input.prompt !== "string" ||
      input.prompt.trim().length === 0 ||
      input.model_profile_version !==
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version ||
      input.output_schema_name !==
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name ||
      input.maximum_output_characters !==
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE
          .maximum_output_characters ||
      input.store !== false
    ) {
      throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
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
      throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
    }

    let outputText: unknown;
    try {
      outputText = response.output_text;
    } catch {
      throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
    }

    if (
      typeof outputText !== "string" ||
      outputText.trim().length === 0 ||
      outputText.length >
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE
          .maximum_output_characters
    ) {
      throw new OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError();
    }

    return Object.freeze({ output_text: outputText });
  }
}

export function createOpenAICapaInvestigationActiveAdvisoryStructuredModelClient(
  client: Pick<OpenAI, "responses">,
  options: OpenAICapaInvestigationActiveAdvisoryStructuredModelClientOptions,
): CapaInvestigationActiveAdvisoryStructuredModelClient {
  return new OpenAICapaInvestigationActiveAdvisoryStructuredModelClient(
    client,
    options,
  );
}
