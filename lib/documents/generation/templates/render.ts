import type { DocumentGenerationRequest } from "../contracts";
import { getTemplate } from "./registry";
import { TemplateValidationError, type TemplateOutputFormat, type TemplateRenderInput } from "./types"

export function renderTemplate(
  input: TemplateRenderInput,
): DocumentGenerationRequest {
  const template = getTemplate(input.templateId);
  if (!template) {
    throw new TemplateValidationError([
      `Unknown template ID: ${input.templateId}.`,
    ]);
  }
  if (!template.supportedFormats.includes(input.format as TemplateOutputFormat)) {
    throw new TemplateValidationError([
      `Format ${input.format} is not supported by template ${input.templateId}.`,
    ]);
  }
  return template.render(input);
}
