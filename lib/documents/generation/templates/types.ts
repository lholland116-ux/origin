import type {
  DocumentGenerationRequest,
  DocumentFormat,
} from "../contracts";

export type TemplateOutputFormat = Exclude<DocumentFormat, "zip">;

export interface TemplateVariablesRecord {
  readonly [key: string]: TemplateInputValue;
}

export type TemplateInputValue =
  | string
  | number
  | boolean
  | null
  | readonly TemplateInputValue[]
  | TemplateVariablesRecord;

export type TemplateVariableKind =
  | "string"
  | "string[]"
  | "object[]"
  | "table";

export type TemplateVariableSpec = {
  readonly name: string;
  readonly kind: TemplateVariableKind;
  readonly description: string;
};

export type TemplateMetadata = {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly contentFamily: "report" | "presentation" | "document";
  readonly supportedFormats: readonly TemplateOutputFormat[];
  readonly requiredVariables: readonly TemplateVariableSpec[];
  readonly optionalVariables: readonly TemplateVariableSpec[];
};

export type TemplateRenderInput = {
  readonly templateId: string;
  readonly format: string;
  readonly variables: TemplateVariablesRecord;
};

export type DocumentTemplate = TemplateMetadata & {
  readonly render: (input: TemplateRenderInput) => DocumentGenerationRequest;
};

export type TemplateRegistry = {
  readonly get: (id: string) => DocumentTemplate | undefined;
  readonly list: () => readonly TemplateMetadata[];
};

export class TemplateValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join(" "));
    this.name = "TemplateValidationError";
    this.issues = issues;
  }
}
