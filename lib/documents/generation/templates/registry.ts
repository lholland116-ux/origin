import { comparisonReportTemplate } from "./comparison-report";
import { executiveSummaryTemplate } from "./executive-summary";
import { generalPresentationTemplate } from "./general-presentation";
import { generalReportTemplate } from "./general-report";
import { simpleDocumentTemplate } from "./simple-document";
import {
  TemplateValidationError,
  type DocumentTemplate,
  type TemplateMetadata,
  type TemplateRegistry,
} from "./types";

export function createTemplateRegistry(
  definitions: readonly DocumentTemplate[],
): TemplateRegistry {
  const byId = new Map<string, DocumentTemplate>();
  for (const definition of definitions) {
    if (!definition.id.trim()) {
      throw new TemplateValidationError(["Template IDs must be non-empty."]);
    }
    if (byId.has(definition.id)) {
      throw new TemplateValidationError([
        `Duplicate template ID: ${definition.id}.`,
      ]);
    }
    byId.set(definition.id, definition);
  }

  const metadata: readonly TemplateMetadata[] = definitions.map((definition) => ({
    id: definition.id,
    version: definition.version,
    name: definition.name,
    description: definition.description,
    contentFamily: definition.contentFamily,
    supportedFormats: definition.supportedFormats,
    requiredVariables: definition.requiredVariables,
    optionalVariables: definition.optionalVariables,
  }));

  return {
    get: (id) => byId.get(id),
    list: () => metadata,
  };
}

export const templateRegistry = createTemplateRegistry([
  generalReportTemplate,
  simpleDocumentTemplate,
  executiveSummaryTemplate,
  comparisonReportTemplate,
  generalPresentationTemplate,
]);

export function getTemplate(id: string): DocumentTemplate | undefined {
  return templateRegistry.get(id);
}

export function listTemplates(): readonly TemplateMetadata[] {
  return templateRegistry.list();
}
