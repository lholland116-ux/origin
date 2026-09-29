export type DocumentFormat =
  | "txt"
  | "md"
  | "docx"
  | "pdf"
  | "xlsx"
  | "pptx"
  | "zip";

export type DocumentMetadata = Readonly<Record<string, string>>;
export type TemplateVariables = Readonly<
  Record<string, string | number | boolean | null>
>;

export type DocumentSection =
  | {
      readonly type: "heading";
      readonly level: 1 | 2 | 3;
      readonly text: string;
    }
  | {
      readonly type: "paragraph";
      readonly text: string;
    }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly items: readonly string[];
    }
  | {
      readonly type: "table";
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

export type WorkbookCell = string | number | boolean | null;

export type WorkbookSheet = {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly WorkbookCell[])[];
};

type BaseDocumentRequest = {
  readonly filename?: string;
  readonly title?: string;
  readonly metadata?: DocumentMetadata;
  readonly templateId?: string;
  readonly templateVariables?: TemplateVariables;
};

export type TextDocumentRequest = BaseDocumentRequest & {
  readonly format: "txt";
  readonly content: string;
};

export type MarkdownDocumentRequest = BaseDocumentRequest & {
  readonly format: "md";
  readonly content: string;
};

export type StructuredDocumentRequest = BaseDocumentRequest & {
  readonly format: "docx" | "pdf";
  readonly sections: readonly DocumentSection[];
};

export type WorkbookDocumentRequest = BaseDocumentRequest & {
  readonly format: "xlsx";
  readonly sheets: readonly WorkbookSheet[];
};

export type DocumentGenerationRequest =
  | TextDocumentRequest
  | MarkdownDocumentRequest
  | StructuredDocumentRequest
  | WorkbookDocumentRequest;

export type GeneratedArtifact = {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly sizeBytes: number;
  readonly format: Exclude<DocumentFormat, "zip">;
};

export type ZipPackageRequest = {
  readonly format: "zip";
  readonly filename?: string;
  readonly entries: readonly GeneratedArtifact[];
};
