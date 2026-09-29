"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import type { DocumentFormat } from "@/lib/documents/generation/contracts";
import { formatDocumentSize } from "@/lib/documents/download";
import type { ChatTheme } from "@/lib/chat-themes";

export type GeneratedDocumentCardData = {
  readonly filename: string;
  readonly format: DocumentFormat;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

type GeneratedDocumentCardProps = {
  readonly document: GeneratedDocumentCardData;
  readonly theme: ChatTheme;
  readonly onDownload: () => void;
  readonly downloading?: boolean;
};

const FORMAT_LABELS: Readonly<Record<DocumentFormat, string>> = {
  txt: "TXT",
  md: "Markdown",
  docx: "DOCX",
  pdf: "PDF",
  xlsx: "XLSX",
  pptx: "PPTX",
  zip: "ZIP",
};

export function getGeneratedDocumentFormatLabel(format: DocumentFormat): string {
  return FORMAT_LABELS[format];
}

export function GeneratedDocumentCard({
  document: generatedDocument,
  theme,
  onDownload,
  downloading = false,
}: GeneratedDocumentCardProps) {
  return (
    <div
      className={`mt-3 flex w-full max-w-md items-center gap-3 rounded-xl border px-3 py-3 ${theme.panelBg} ${theme.panelBorder}`}
      role="group"
      aria-label={`Generated ${getGeneratedDocumentFormatLabel(generatedDocument.format)} document`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${theme.badge}`}>
        <FileText className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${theme.titleText}`}>
          {generatedDocument.filename}
        </p>
        <p className={`mt-0.5 text-xs ${theme.mutedText}`}>
          {getGeneratedDocumentFormatLabel(generatedDocument.format)} · {formatDocumentSize(generatedDocument.sizeBytes)}
        </p>
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-60 ${theme.buttonSecondary}`}
        aria-label={`Download ${generatedDocument.filename}`}
      >
        {downloading ? (
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{downloading ? "Saving…" : "Download"}</span>
      </button>
    </div>
  );
}
