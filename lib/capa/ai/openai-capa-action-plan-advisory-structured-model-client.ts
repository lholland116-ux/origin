import type OpenAI from "openai";
import { CAPA_ACTION_PLAN_ADVISORY_JSON_SCHEMA, CAPA_ACTION_PLAN_ADVISORY_MODEL_PROFILE, type CapaActionPlanAdvisoryStructuredModelClient } from "./capa-action-plan-advisory-model-generator";

export class OpenAICapaActionPlanAdvisoryStructuredModelClientError extends Error { constructor() { super("The governed CAPA action-plan advisory model operation failed."); this.name = "OpenAICapaActionPlanAdvisoryStructuredModelClientError"; } }
export class OpenAICapaActionPlanAdvisoryStructuredModelClient implements CapaActionPlanAdvisoryStructuredModelClient {
  private readonly model: string;
  constructor(private readonly client: Pick<OpenAI, "responses">, options: { readonly model: string }) { if (options.model.trim().length === 0) throw new OpenAICapaActionPlanAdvisoryStructuredModelClientError(); this.model = options.model.trim(); }
  async generateStructured(input: Parameters<CapaActionPlanAdvisoryStructuredModelClient["generateStructured"]>[0]): Promise<{ readonly output_text: string }> {
    if (input.model_profile_version !== CAPA_ACTION_PLAN_ADVISORY_MODEL_PROFILE.profile_version || input.output_schema_name !== CAPA_ACTION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name || input.maximum_output_characters !== CAPA_ACTION_PLAN_ADVISORY_MODEL_PROFILE.maximum_output_characters || input.store !== false) throw new OpenAICapaActionPlanAdvisoryStructuredModelClientError();
    try { const response = await this.client.responses.create({ model: this.model, input: input.prompt, store: false, text: { format: { type: "json_schema", name: input.output_schema_name, schema: CAPA_ACTION_PLAN_ADVISORY_JSON_SCHEMA, strict: true } } }); const output = response.output_text; if (typeof output !== "string" || output.length === 0 || output.length > CAPA_ACTION_PLAN_ADVISORY_MODEL_PROFILE.maximum_output_characters) throw new Error(); return { output_text: output }; } catch { throw new OpenAICapaActionPlanAdvisoryStructuredModelClientError(); }
  }
}
export function createOpenAICapaActionPlanAdvisoryStructuredModelClient(client: Pick<OpenAI, "responses">, options: { readonly model: string }): CapaActionPlanAdvisoryStructuredModelClient { return new OpenAICapaActionPlanAdvisoryStructuredModelClient(client, options); }
