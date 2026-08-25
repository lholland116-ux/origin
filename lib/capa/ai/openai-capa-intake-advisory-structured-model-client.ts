import type OpenAI from "openai";

import {
  CAPA_INTAKE_ADVISORY_MODEL_PROFILE,
  type CapaIntakeAdvisoryStructuredModelClient,
} from "./capa-intake-advisory-model-generator";

export class OpenAICapaIntakeAdvisoryStructuredModelClientError
  extends Error {
  constructor() {
    super(
      "The governed CAPA structured model operation failed.",
    );

    this.name =
      "OpenAICapaIntakeAdvisoryStructuredModelClientError";
  }
}

export interface OpenAICapaIntakeAdvisoryStructuredModelClientOptions {
  readonly model: string;
}

function controlledModel(
  value: string,
): string {
  const model = value.trim();

  if (
    model.length === 0 ||
    model.length > 128
  ) {
    throw new OpenAICapaIntakeAdvisoryStructuredModelClientError();
  }

  return model;
}

function schemaObject(
  value: unknown,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new OpenAICapaIntakeAdvisoryStructuredModelClientError();
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    ) as Record<string, unknown>;
  } catch {
    throw new OpenAICapaIntakeAdvisoryStructuredModelClientError();
  }
}

/**
 * OpenAI Responses API adapter for the governed CAPA intake advisory model.
 *
 * Responsibilities are intentionally narrow:
 *
 * - use the server-controlled model supplied by runtime composition;
 * - send only the already-controlled assembled prompt;
 * - require strict JSON Schema Structured Outputs;
 * - prohibit provider-side response storage;
 * - reject empty or oversized provider output;
 * - return provider-neutral output text to the model generator.
 */
export class OpenAICapaIntakeAdvisoryStructuredModelClient
  implements CapaIntakeAdvisoryStructuredModelClient {
  private readonly model: string;

  constructor(
    private readonly client:
      Pick<OpenAI, "responses">,
    options:
      OpenAICapaIntakeAdvisoryStructuredModelClientOptions,
  ) {
    this.model =
      controlledModel(options.model);
  }

  async generateStructured(
    input:
      Parameters<
        CapaIntakeAdvisoryStructuredModelClient[
          "generateStructured"
        ]
      >[0],
  ): Promise<{
    readonly output_text: string;
  }> {
    if (
      input.model_profile_version !==
        CAPA_INTAKE_ADVISORY_MODEL_PROFILE
          .profile_version ||
      input.output_schema_name !==
        CAPA_INTAKE_ADVISORY_MODEL_PROFILE
          .output_schema_name ||
      input.maximum_output_characters !==
        CAPA_INTAKE_ADVISORY_MODEL_PROFILE
          .maximum_output_characters ||
      input.store !== false ||
      input.prompt.trim().length === 0
    ) {
      throw new OpenAICapaIntakeAdvisoryStructuredModelClientError();
    }

    const schema =
      schemaObject(
        input.output_schema,
      );

    let response;

    try {
      response =
        await this.client.responses.create({
          model: this.model,
          input: input.prompt,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name:
                input.output_schema_name,
              schema,
              strict: true,
            },
          },
        });
    } catch {
      throw new OpenAICapaIntakeAdvisoryStructuredModelClientError();
    }

    const outputText =
      response.output_text;

    if (
      typeof outputText !== "string" ||
      outputText.trim().length === 0 ||
      outputText.length >
        input.maximum_output_characters
    ) {
      throw new OpenAICapaIntakeAdvisoryStructuredModelClientError();
    }

    return Object.freeze({
      output_text: outputText,
    });
  }
}

export function createOpenAICapaIntakeAdvisoryStructuredModelClient(
  client: Pick<OpenAI, "responses">,
  options:
    OpenAICapaIntakeAdvisoryStructuredModelClientOptions,
): OpenAICapaIntakeAdvisoryStructuredModelClient {
  return new OpenAICapaIntakeAdvisoryStructuredModelClient(
    client,
    options,
  );
}
