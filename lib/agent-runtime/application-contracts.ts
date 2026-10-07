import { z } from "zod";
import { MAX_DOCUMENT_CONTEXT_CHARS } from "@/lib/documents/prepare-context";
import { isValidGeneratedDocumentMetadata } from "@/lib/documents/generated-document-contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(UUID_PATTERN);

/** Trusted identity and conversation binding required by Execution Engine V1. */
export const conversationExecutionContextSchema = z.object({
  authenticatedUserId: uuidSchema,
  conversationId: uuidSchema,
}).strict();

export type ConversationExecutionContext = z.infer<typeof conversationExecutionContextSchema>;

const fileContextDocumentSchema = z.object({
  documentId: uuidSchema,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  extractedText: z.string().max(MAX_DOCUMENT_CONTEXT_CHARS),
}).strict();

/**
 * file_analysis prepares owner-scoped, already-extracted document context for
 * Standard. It contains no uploaded bytes, storage path, or provider output.
 */
export const fileContextResultSchema = z.object({
  kind: z.literal("file_context"),
  userId: uuidSchema,
  conversationId: uuidSchema,
  documents: z.array(fileContextDocumentSchema).min(1).max(10),
}).strict().superRefine((value, context) => {
  const totalCharacters = value.documents.reduce((total, document) => total + document.extractedText.length, 0);
  if (totalCharacters > MAX_DOCUMENT_CONTEXT_CHARS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "File context exceeds the Standard document-context limit.",
      path: ["documents"],
    });
  }
});

export type FileContextResult = z.infer<typeof fileContextResultSchema>;

/** Ensures context produced for one trusted run is not consumed by another. */
export function fileContextMatchesExecutionContext(
  value: unknown,
  executionContext: ConversationExecutionContext,
): value is FileContextResult {
  const parsed = fileContextResultSchema.safeParse(value);
  return parsed.success
    && parsed.data.userId === executionContext.authenticatedUserId
    && parsed.data.conversationId === executionContext.conversationId;
}

const documentFormats = ["txt", "md", "docx", "pdf", "xlsx", "pptx", "zip"] as const;

/** Durable metadata only; bytes and private storage details stay out of runtime state. */
export const generatedDocumentReferenceSchema = z.object({
  kind: z.literal("generated_document"),
  artifactId: uuidSchema,
  conversationId: uuidSchema,
  messageId: uuidSchema,
  filename: z.string().min(1).max(255),
  format: z.enum(documentFormats),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  createdAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (!isValidGeneratedDocumentMetadata({
    id: value.artifactId,
    conversationId: value.conversationId,
    messageId: value.messageId,
    filename: value.filename,
    format: value.format,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
  })) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Generated document reference does not match persisted document metadata.",
    });
  }
});

export type GeneratedDocumentReference = z.infer<typeof generatedDocumentReferenceSchema>;
