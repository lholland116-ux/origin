import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  fileContextResultSchema,
  type FileContextResult,
} from "@/lib/agent-runtime/application-contracts";
import { MAX_DOCUMENT_CONTEXT_CHARS } from "@/lib/documents/context-limits";

export const MAX_FILE_CONTEXT_DOCUMENTS = 10;

type FileContextRow = Readonly<{
  id: string;
  user_id: string;
  conversation_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number | string;
  extraction_status: string;
  extracted_text: string | null;
}>;

export type FileContextServiceInput = Readonly<{
  userId: string;
  conversationId: string;
  documentIds: readonly string[];
}>;

export type FileContextServiceDependencies = Readonly<{
  loadDocuments: (input: FileContextServiceInput) => Promise<readonly FileContextRow[]>;
}>;

export type FileContextPreparationErrorCode =
  | "invalid_reference"
  | "document_unavailable"
  | "context_too_large"
  | "temporary_lookup_failure"
  | "lookup_failed";

const ERROR_MESSAGES: Readonly<Record<FileContextPreparationErrorCode, string>> = {
  invalid_reference: "The attached document reference is invalid.",
  document_unavailable: "One or more attached documents are unavailable.",
  context_too_large: "Attached document content exceeds the supported context size. Please remove a document or use a shorter file.",
  temporary_lookup_failure: "Document context is temporarily unavailable.",
  lookup_failed: "Failed to load document context.",
};

export class FileContextPreparationError extends Error {
  constructor(readonly code: FileContextPreparationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "FileContextPreparationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadOwnedReadyDocuments(input: FileContextServiceInput): Promise<readonly FileContextRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id,user_id,conversation_id,file_name,mime_type,size_bytes,extraction_status,extracted_text")
    .eq("user_id", input.userId)
    .in("id", [...input.documentIds])
    .eq("extraction_status", "ready");

  if (error) {
    const lookupStatus = (error as unknown as { readonly status?: unknown }).status;
    if (lookupStatus === 0 || lookupStatus === 503) {
      throw new FileContextPreparationError("temporary_lookup_failure");
    }
    throw new Error("Document lookup failed.");
  }
  return (data ?? []) as unknown as FileContextRow[];
}

const defaultDependencies: FileContextServiceDependencies = {
  loadDocuments: loadOwnedReadyDocuments,
};

export function createFileContextService(dependencies: FileContextServiceDependencies = defaultDependencies) {
  return async function prepareFileContext(input: FileContextServiceInput): Promise<FileContextResult> {
    if (!UUID_PATTERN.test(input.userId) || !UUID_PATTERN.test(input.conversationId)
      || input.documentIds.length < 1 || input.documentIds.length > MAX_FILE_CONTEXT_DOCUMENTS
      || input.documentIds.some((id) => !UUID_PATTERN.test(id))
      || new Set(input.documentIds).size !== input.documentIds.length) {
      throw new FileContextPreparationError("invalid_reference");
    }

    let rows: readonly FileContextRow[];
    try {
      rows = await dependencies.loadDocuments(input);
    } catch (error) {
      if (error instanceof FileContextPreparationError && error.code === "temporary_lookup_failure") throw error;
      throw new FileContextPreparationError("lookup_failed");
    }

    if (rows.length !== input.documentIds.length) {
      throw new FileContextPreparationError("document_unavailable");
    }

    const expectedIds = new Set(input.documentIds);
    const documents = rows.map((row) => {
      const sizeBytes = typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes);
      if (!expectedIds.has(row.id) || row.user_id !== input.userId
        || row.conversation_id !== input.conversationId
        || row.extraction_status !== "ready"
        || typeof row.file_name !== "string" || !row.file_name.trim()
        || typeof row.mime_type !== "string" || !row.mime_type.trim()
        || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
        || typeof row.extracted_text !== "string" || !row.extracted_text.trim()) {
        throw new FileContextPreparationError("document_unavailable");
      }
      return {
        documentId: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes,
        extractedText: row.extracted_text,
      };
    });

    const totalCharacters = documents.reduce((total, document) => total + document.extractedText.length, 0);
    if (totalCharacters > MAX_DOCUMENT_CONTEXT_CHARS) {
      throw new FileContextPreparationError("context_too_large");
    }

    const parsed = fileContextResultSchema.safeParse({
      kind: "file_context",
      userId: input.userId,
      conversationId: input.conversationId,
      documents,
    });
    if (!parsed.success) {
      throw new FileContextPreparationError("document_unavailable");
    }
    return parsed.data;
  };
}

export const prepareFileContext = createFileContextService();
