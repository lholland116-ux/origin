import type OpenAI from "openai";

import {
  CAPA_CONTAINMENT_RISK_ADVISORY_JSON_SCHEMA,
  CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE,
  type CapaContainmentRiskAdvisoryStructuredModelClient,
} from "./capa-containment-risk-advisory-model-generator";

export class OpenAICapaContainmentRiskAdvisoryStructuredModelClientError
  extends Error {
  constructor() {
    super(
      "The governed CAPA structured model operation failed.",
    );

    this.name =
      "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError";
  }
}

export interface OpenAICapaContainmentRiskAdvisoryStructuredModelClientOptions {
  readonly model: string;
}

function controlledModel(
  value: string,
): string {
  if (typeof value !== "string") {
    throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
  }

  const model = value.trim();

  if (
    model.length === 0 ||
    model.length > 128
  ) {
    throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
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
    throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
  }

  try {
    const serialized = JSON.stringify(value);

    if (typeof serialized !== "string") {
      throw new Error();
    }

    const parsed: unknown = JSON.parse(serialized);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error();
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
  }
}

/**
 * OpenAI Responses API transport adapter for the governed S20 containment and
 * impact-risk advisory model. It has no CAPA authorization, persistence, or
 * workflow responsibilities; those remain enforced by upstream layers.
 */
export class OpenAICapaContainmentRiskAdvisoryStructuredModelClient
  implements CapaContainmentRiskAdvisoryStructuredModelClient {
  private readonly model: string;

  constructor(
    private readonly client:
      Pick<OpenAI, "responses">,
    options:
      OpenAICapaContainmentRiskAdvisoryStructuredModelClientOptions,
  ) {
    this.model = controlledModel(options.model);
  }

  async generateStructured(
    input:
      Parameters<
        CapaContainmentRiskAdvisoryStructuredModelClient[
          "generateStructured"
        ]
      >[0],
  ): Promise<{
    readonly output_text: string;
  }> {
    if (
      typeof input.prompt !== "string" ||
      input.model_profile_version !==
        CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE
          .profile_version ||
      input.output_schema_name !==
        CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE
          .output_schema_name ||
      input.maximum_output_characters !==
        CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE
          .maximum_output_characters ||
      input.store !== false ||
      input.prompt.trim().length === 0
    ) {
      throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
    }

    const schema = schemaObject(input.output_schema);

    let response;

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
      throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
    }

    let outputText: unknown;

    try {
      outputText = response.output_text;
    } catch {
      throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
    }

    if (
      typeof outputText !== "string" ||
      outputText.trim().length === 0 ||
      outputText.length > input.maximum_output_characters
    ) {
      throw new OpenAICapaContainmentRiskAdvisoryStructuredModelClientError();
    }

    return Object.freeze({
      output_text: outputText,
    });
  }
}

export function createOpenAICapaContainmentRiskAdvisoryStructuredModelClient(
  client: Pick<OpenAI, "responses">,
  options:
    OpenAICapaContainmentRiskAdvisoryStructuredModelClientOptions,
): CapaContainmentRiskAdvisoryStructuredModelClient {
  return new OpenAICapaContainmentRiskAdvisoryStructuredModelClient(
    client,
    options,
  );
}
