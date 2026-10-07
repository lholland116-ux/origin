import { z } from "zod";
import { MAX_DOCUMENT_CONTEXT_CHARS } from "@/lib/documents/context-limits";
import { isValidGeneratedDocumentMetadata } from "@/lib/documents/generated-document-contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(UUID_PATTERN);

/** Trusted identity and conversation binding required by Execution Engine V1. */
export const conversationExecutionContextSchema = z.object({
  authenticatedUserId: uuidSchema,
  conversationId: uuidSchema,
}).strict();

export type ConversationExecutionContext = z.infer<typeof conversationExecutionContextSchema>;

/** One authenticated, conversation-bound top-level request transaction. */
export const requestTransactionContextSchema = z.object({
  requestId: uuidSchema,
  userId: uuidSchema,
  conversationId: uuidSchema,
  userMessageId: uuidSchema.nullable(),
  assistantMessageId: uuidSchema.optional(),
}).strict();

export type RequestTransactionContext = z.infer<typeof requestTransactionContextSchema>;

/** Immutable, persisted message binding for one durable request execution. */
export const requestMessageBindingSchema = z.object({
  requestId: uuidSchema,
  userId: uuidSchema,
  conversationId: uuidSchema,
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema,
}).strict().refine((value) => value.userMessageId !== value.assistantMessageId, {
  message: "The request user and assistant messages must be distinct.",
  path: ["assistantMessageId"],
});

export type RequestMessageBinding = z.infer<typeof requestMessageBindingSchema>;

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

const operationTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
}).strict();

const operationMeasurementSchema = z.object({
  attemptKind: z.enum(["primary", "image_retry"]),
  model: z.string().min(1).max(100),
  outcome: z.enum(["success", "api_error", "cancelled", "incomplete"]),
  latencyMs: z.number().int().nonnegative().max(10_000_000),
  hadImage: z.boolean(),
  usage: operationTokenUsageSchema,
}).strict();

/** Bounded, persistence-free Standard completion data for transaction/runtime callers. */
export const standardOperationResultSchema = z.object({
  kind: z.literal("standard_operation"),
  requestId: uuidSchema,
  userId: uuidSchema,
  conversationId: uuidSchema,
  reply: z.string().max(200_000),
  model: z.string().min(1).max(100),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  measurements: z.array(operationMeasurementSchema).max(2),
}).strict();

export type StandardOperationResult = z.infer<typeof standardOperationResultSchema>;

const webSearchSourceSchema = z.object({
  title: z.string().min(1).max(255),
  url: z.string().min(1).max(2_048),
  snippet: z.string().max(4_000).optional(),
}).strict();

const timeWidgetSchema = z.object({
  type: z.literal("time"),
  location: z.string().min(1).max(100),
  timezone: z.string().min(1).max(100),
}).strict().nullable();

/** Provider-independent and bounded result passed from web_search to Standard. */
export const webSearchOperationResultSchema = z.object({
  kind: z.literal("web_search_operation"),
  requestId: uuidSchema,
  userId: uuidSchema,
  conversationId: uuidSchema,
  reply: z.string().max(100_000),
  sources: z.array(webSearchSourceSchema).max(5),
  sourceCount: z.number().int().nonnegative().max(10_000),
  widget: timeWidgetSchema,
  web: z.literal(true),
  webSearchCalls: z.number().int().nonnegative().max(100),
  model: z.string().min(1).max(100),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
  outcome: z.enum(["success", "api_error", "cancelled", "incomplete"]),
  latencyMs: z.number().int().nonnegative().max(10_000_000),
  usage: operationTokenUsageSchema,
}).strict();

export type WebSearchOperationResult = z.infer<typeof webSearchOperationResultSchema>;

export function webSearchResultMatchesRequestTransaction(
  value: unknown,
  context: RequestTransactionContext,
): value is WebSearchOperationResult {
  const parsed = webSearchOperationResultSchema.safeParse(value);
  return parsed.success
    && parsed.data.requestId === context.requestId
    && parsed.data.userId === context.userId
    && parsed.data.conversationId === context.conversationId;
}

export function fileContextMatchesRequestTransaction(
  value: unknown,
  context: RequestTransactionContext,
): value is FileContextResult {
  return fileContextMatchesExecutionContext(value, {
    authenticatedUserId: context.userId,
    conversationId: context.conversationId,
  });
}

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

export const generatedImageReferenceSchema = z.object({
  kind: z.literal("generated_image"),
  imageId: uuidSchema,
  conversationId: uuidSchema,
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema,
  mimeType: z.enum(["image/webp", "image/png", "image/jpeg"]),
  provider: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:@/-]+$/),
  model: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._:@/-]+$/),
}).strict();

export type GeneratedImageReference = z.infer<typeof generatedImageReferenceSchema>;
