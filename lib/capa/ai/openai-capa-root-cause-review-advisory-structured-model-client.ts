import type OpenAI from "openai";

import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE,
  type CapaRootCauseReviewAdvisoryStructuredModelClient,
} from "./capa-root-cause-review-advisory-model-generator";

export class OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError
  extends Error {
  constructor() {
    super("The governed CAPA structured model operation failed.");
    this.name =
      "OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError";
  }
}

export interface OpenAICapaRootCauseReviewAdvisoryStructuredModelClientOptions {
  readonly model: string;
}

function controlledModel(value: unknown): string {
  if (typeof value !== "string") {
    throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
  }

  const model = value.trim();
  if (model.length === 0 || model.length > 128) {
    throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
  }

  return model;
}

function controlledSchema(value: unknown):
  typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      JSON.stringify(value) !==
        JSON.stringify(CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA)
    ) {
      throw new Error();
    }
  } catch {
    throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
  }

  return CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA;
}

/** OpenAI transport only; it has no CAPA governance or persistence authority. */
export class OpenAICapaRootCauseReviewAdvisoryStructuredModelClient
  implements CapaRootCauseReviewAdvisoryStructuredModelClient {
  private readonly model: string;

  constructor(
    private readonly client: Pick<OpenAI, "responses">,
    options: OpenAICapaRootCauseReviewAdvisoryStructuredModelClientOptions,
  ) {
    this.model = controlledModel(options.model);
  }

  async generateStructured(
    input: Parameters<
      CapaRootCauseReviewAdvisoryStructuredModelClient[
        "generateStructured"
      ]
    >[0],
  ): Promise<{ readonly output_text: string }> {
    if (
      typeof input.prompt !== "string" ||
      input.prompt.trim().length === 0 ||
      input.model_profile_version !==
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version ||
      input.output_schema_name !==
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name ||
      input.maximum_output_characters !==
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE
          .maximum_output_characters ||
      input.store !== false
    ) {
      throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
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
      throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
    }

    let outputText: unknown;
    try {
      outputText = response.output_text;
    } catch {
      throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
    }

    if (
      typeof outputText !== "string" ||
      outputText.trim().length === 0 ||
      outputText.length >
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE
          .maximum_output_characters
    ) {
      throw new OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError();
    }

    return Object.freeze({ output_text: outputText });
  }
}

export function createOpenAICapaRootCauseReviewAdvisoryStructuredModelClient(
  client: Pick<OpenAI, "responses">,
  options: OpenAICapaRootCauseReviewAdvisoryStructuredModelClientOptions,
): CapaRootCauseReviewAdvisoryStructuredModelClient {
  return new OpenAICapaRootCauseReviewAdvisoryStructuredModelClient(
    client,
    options,
  );
}
