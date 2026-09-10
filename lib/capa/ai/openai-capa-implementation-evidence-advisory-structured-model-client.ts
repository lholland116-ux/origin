import type OpenAI from "openai";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_JSON_SCHEMA, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE, type CapaImplementationEvidenceAdvisoryStructuredModelClient } from "./capa-implementation-evidence-advisory-model-generator";

export class OpenAICapaImplementationEvidenceAdvisoryStructuredModelClientError extends Error { constructor() { super("The governed S80 implementation-evidence advisory model operation failed."); this.name = "OpenAICapaImplementationEvidenceAdvisoryStructuredModelClientError"; } }
export class OpenAICapaImplementationEvidenceAdvisoryStructuredModelClient implements CapaImplementationEvidenceAdvisoryStructuredModelClient {
  private readonly model: string;
  constructor(private readonly client: Pick<OpenAI, "responses">, options: { readonly model: string }) { if (options.model.trim().length === 0) throw new OpenAICapaImplementationEvidenceAdvisoryStructuredModelClientError(); this.model = options.model.trim(); }
  async generateStructured(input: Parameters<CapaImplementationEvidenceAdvisoryStructuredModelClient["generateStructured"]>[0]): Promise<{ readonly output_text: string }> {
    if (input.model_profile_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.profile_version || input.output_schema_name !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.output_schema_name || input.maximum_output_characters !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.maximum_output_characters || input.store !== false) throw new OpenAICapaImplementationEvidenceAdvisoryStructuredModelClientError();
    try { const result = await this.client.responses.create({ model: this.model, input: input.prompt, store: false, text: { format: { type: "json_schema", name: input.output_schema_name, schema: input.output_schema, strict: true } } }); const output = result.output_text; if (typeof output !== "string" || output.length === 0 || output.length > CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_MODEL_PROFILE.maximum_output_characters) throw new Error(); return { output_text: output }; } catch { throw new OpenAICapaImplementationEvidenceAdvisoryStructuredModelClientError(); }
  }
}
export function createOpenAICapaImplementationEvidenceAdvisoryStructuredModelClient(client: Pick<OpenAI, "responses">, options: { readonly model: string }): CapaImplementationEvidenceAdvisoryStructuredModelClient { return new OpenAICapaImplementationEvidenceAdvisoryStructuredModelClient(client, options); }
