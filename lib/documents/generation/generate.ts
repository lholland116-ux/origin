import type {
  DocumentGenerationRequest,
  DocumentFormat,
  GeneratedArtifact,
  ZipPackageRequest,
} from "./contracts";
import { DocumentGenerationValidationError } from "./validation";
import { generateDocxArtifact } from "./generators/docx";
import { generateMarkdownArtifact } from "./generators/markdown";
import { generatePdfArtifact } from "./generators/pdf";
import { generatePptxArtifact } from "./generators/pptx";
import { generateTextArtifact } from "./generators/text";
import { generateXlsxArtifact } from "./generators/xlsx";
import { generateZipArtifact } from "./generators/zip";
import { renderTemplate } from "./templates/render";
import type { TemplateOutputFormat, TemplateVariablesRecord } from "./templates/types";

export type TemplateGenerationInput = {
  readonly templateId: string;
  readonly format: TemplateOutputFormat;
  readonly variables: TemplateVariablesRecord;
};

export type TemplatePackageInput = {
  readonly templateId: string;
  readonly formats: readonly TemplateOutputFormat[];
  readonly variables: TemplateVariablesRecord;
  readonly filename?: string;
};

export async function generateDocumentArtifact(
  request: DocumentGenerationRequest | ZipPackageRequest,
): Promise<GeneratedArtifact> {
  switch (request.format) {
    case "txt":
      return generateTextArtifact(request);
    case "md":
      return generateMarkdownArtifact(request);
    case "docx":
      return generateDocxArtifact(
        request as Parameters<typeof generateDocxArtifact>[0],
      );
    case "pdf":
      return generatePdfArtifact(
        request as Parameters<typeof generatePdfArtifact>[0],
      );
    case "xlsx":
      return generateXlsxArtifact(
        request as Parameters<typeof generateXlsxArtifact>[0],
      );
    case "pptx":
      return generatePptxArtifact(
        request as Parameters<typeof generatePptxArtifact>[0],
      );
    case "zip":
      return generateZipArtifact(request);
    default:
      throw new DocumentGenerationValidationError([
        `Unsupported document format: ${(request as { format: string }).format}.`,
      ]);
  }
}

function withRequestedFilename(
  variables: TemplateVariablesRecord,
  filename: string | undefined,
): TemplateVariablesRecord {
  if (filename === undefined || variables.filename !== undefined) {
    return variables;
  }

  return { ...variables, filename };
}

export async function generateTemplateArtifact(
  input: TemplateGenerationInput,
): Promise<GeneratedArtifact> {
  const request = renderTemplate({
    templateId: input.templateId,
    format: input.format,
    variables: input.variables,
  });

  return generateDocumentArtifact(request);
}

export async function generateTemplatePackage(
  input: TemplatePackageInput,
): Promise<GeneratedArtifact> {
  if (input.formats.length === 0) {
    throw new DocumentGenerationValidationError([
      "At least one output format is required.",
    ]);
  }

  const variables = withRequestedFilename(input.variables, input.filename);
  const artifacts = await Promise.all(
    input.formats.map((format) =>
      generateTemplateArtifact({
        templateId: input.templateId,
        format,
        variables,
      }),
    ),
  );

  const firstFilename = artifacts[0]?.filename.replace(/\.[^.]+$/, "") ?? "lvtchat-document";
  const packageRequest: ZipPackageRequest = {
    format: "zip",
    filename: input.filename ?? `${firstFilename}.zip`,
    entries: artifacts,
  };

  return generateDocumentArtifact(packageRequest);
}

export async function generateTemplateOutput(input: {
  readonly templateId: string;
  readonly formats: readonly TemplateOutputFormat[];
  readonly variables: TemplateVariablesRecord;
  readonly packageAsZip: boolean;
  readonly filename?: string;
}): Promise<GeneratedArtifact> {
  if (input.packageAsZip || input.formats.length > 1) {
    return generateTemplatePackage(input);
  }

  const format = input.formats[0];
  if (!format) {
    throw new DocumentGenerationValidationError([
      "At least one output format is required.",
    ]);
  }

  return generateTemplateArtifact({
    templateId: input.templateId,
    format,
    variables: withRequestedFilename(input.variables, input.filename),
  });
}

export function isTemplateOutputFormat(
  value: unknown,
): value is TemplateOutputFormat {
  return (
    value === "txt" ||
    value === "md" ||
    value === "docx" ||
    value === "pdf" ||
    value === "xlsx" ||
    value === "pptx"
  );
}

export function isDocumentFormat(value: unknown): value is DocumentFormat {
  return isTemplateOutputFormat(value) || value === "zip";
}
