"use client";

import { Download, FileText, RefreshCw, Trash2 } from "lucide-react";
import type { DocumentFormat } from "@/lib/documents/generation/contracts";
import { formatDocumentSize } from "@/lib/documents/download";
import type { ChatTheme } from "@/lib/chat-themes";

export type GeneratedDocumentCardData = {
  readonly id?: string;
  readonly filename: string;
  readonly format: DocumentFormat;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

type GeneratedDocumentCardProps = {
  readonly document: GeneratedDocumentCardData;
  readonly theme: ChatTheme;
  readonly onDownload: () => void;
  readonly onDelete?: () => void;
  readonly downloading?: boolean;
  readonly deleting?: boolean;
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
  onDelete,
  downloading = false,
  deleting = false,
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
        disabled={downloading || deleting}
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
      {generatedDocument.id && onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={downloading || deleting}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400/50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950/40"
          aria-label={deleting ? `Deleting ${generatedDocument.filename}` : `Delete ${generatedDocument.filename}`}
          aria-busy={deleting}
        >
          {deleting ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="sr-only">{deleting ? "Deleting" : "Delete"}</span>
        </button>
      ) : null}
    </div>
  );
}
