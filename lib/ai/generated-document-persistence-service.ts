import { randomUUID } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  downloadGeneratedDocument,
  findGeneratedDocumentById,
  removeGeneratedDocumentObjectByPath,
  uploadGeneratedDocumentArtifact,
} from "@/lib/documents/generated-document-server";
import {
  isValidGeneratedDocumentMetadata,
  MAX_GENERATED_DOCUMENT_BYTES,
  type GeneratedDocumentPersistenceRecord,
} from "@/lib/documents/generated-document-contracts";
import { getDocumentMimeType, isSupportedDocumentFormat } from "@/lib/documents/generation/mime";
import { isSafeFilename } from "@/lib/documents/generation/filenames";
import type { GeneratedArtifact } from "@/lib/documents/generation/contracts";
import {
  generatedDocumentReferenceSchema,
  type GeneratedDocumentReference,
} from "@/lib/agent-runtime/application-contracts";

type GeneratedDocumentPersistenceInput = Readonly<{
  userId: string;
  conversationId: string;
  generationRequestId: string;
  templateId: string;
  generatedOutput: GeneratedArtifact;
}>;

export type PersistGeneratedDocumentInput = GeneratedDocumentPersistenceInput & Readonly<{
  assistantMessageContent: string;
}>;

export type PersistGeneratedDocumentForExistingMessageInput = GeneratedDocumentPersistenceInput & Readonly<{
  assistantMessageId: string;
}>;

export type GeneratedDocumentPersistenceResult = Readonly<{
  reference: GeneratedDocumentReference;
  /** Transient bytes for the existing chat download response; never part of `reference`. */
  delivery: Readonly<Pick<GeneratedArtifact, "bytes" | "filename" | "mimeType" | "format">>;
}>;

export type GeneratedDocumentPersistenceDependencies = Readonly<{
  createId: () => string;
  upload: typeof uploadGeneratedDocumentArtifact;
  persistChat: (input: PersistGeneratedDocumentInput & {
    generatedDocumentId: string;
    storagePath: string;
  }) => Promise<unknown>;
  persistChatForExistingMessage: (input: PersistGeneratedDocumentForExistingMessageInput & {
    generatedDocumentId: string;
    storagePath: string;
  }) => Promise<unknown>;
  remove: typeof removeGeneratedDocumentObjectByPath;
  findById: typeof findGeneratedDocumentById;
  download: typeof downloadGeneratedDocument;
}>;

export type GeneratedDocumentPersistenceErrorCode =
  | "invalid_output"
  | "storage_failure"
  | "persistence_failure"
  | "existing_result_unavailable";

const ERROR_MESSAGES: Readonly<Record<GeneratedDocumentPersistenceErrorCode, string>> = {
  invalid_output: "The generated document is invalid.",
  storage_failure: "The generated document could not be stored.",
  persistence_failure: "The generated document could not be saved.",
  existing_result_unavailable: "The generated document could not be retrieved.",
};

export class GeneratedDocumentPersistenceError extends Error {
  constructor(readonly code: GeneratedDocumentPersistenceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "GeneratedDocumentPersistenceError";
  }
}

function referenceFromRecord(record: GeneratedDocumentPersistenceRecord): GeneratedDocumentReference {
  const parsed = generatedDocumentReferenceSchema.safeParse({
    kind: "generated_document",
    artifactId: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    filename: record.filename,
    format: record.format,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
  });
  if (!parsed.success) throw new GeneratedDocumentPersistenceError("persistence_failure");
  return parsed.data;
}

function defaultDependencies(): GeneratedDocumentPersistenceDependencies {
  return {
    createId: randomUUID,
    upload: uploadGeneratedDocumentArtifact,
    persistChat: async (input) => {
      const client = await createServerSupabaseClient();
      const rpcClient = client as unknown as {
        rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      };
      const { data, error } = await rpcClient.rpc("persist_generated_document_chat", {
        p_conversation_id: input.conversationId,
        p_generation_request_id: input.generationRequestId,
        p_generated_document_id: input.generatedDocumentId,
        p_storage_path: input.storagePath,
        p_filename: input.generatedOutput.filename,
        p_format: input.generatedOutput.format,
        p_mime_type: input.generatedOutput.mimeType.split(";", 1)[0] ?? input.generatedOutput.mimeType,
        p_size_bytes: input.generatedOutput.sizeBytes,
        p_template_id: input.templateId,
        p_content: input.assistantMessageContent,
      });
      if (error) throw new Error("Generated document persistence failed.");
      return data;
    },
    persistChatForExistingMessage: async (input) => {
      const client = await createServerSupabaseClient();
      const rpcClient = client as unknown as {
        rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      };
      const { data, error } = await rpcClient.rpc("persist_generated_document_for_existing_message", {
        p_conversation_id: input.conversationId,
        p_assistant_message_id: input.assistantMessageId,
        p_generation_request_id: input.generationRequestId,
        p_generated_document_id: input.generatedDocumentId,
        p_storage_path: input.storagePath,
        p_filename: input.generatedOutput.filename,
        p_format: input.generatedOutput.format,
        p_mime_type: input.generatedOutput.mimeType.split(";", 1)[0] ?? input.generatedOutput.mimeType,
        p_size_bytes: input.generatedOutput.sizeBytes,
        p_template_id: input.templateId,
      });
      if (error) throw new Error("Generated document persistence failed.");
      return data;
    },
    remove: removeGeneratedDocumentObjectByPath,
    findById: findGeneratedDocumentById,
    download: downloadGeneratedDocument,
  };
}

function validInput(input: GeneratedDocumentPersistenceInput): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const output = input.generatedOutput;
  const canonicalMime = isSupportedDocumentFormat(output.format)
    ? getDocumentMimeType(output.format).split(";", 1)[0] ?? ""
    : "";
  return uuidPattern.test(input.userId)
    && uuidPattern.test(input.conversationId)
    && uuidPattern.test(input.generationRequestId)
    && Boolean(input.templateId)
    && isSupportedDocumentFormat(output.format)
    && isSafeFilename(output.filename, output.format)
    && output.mimeType.split(";", 1)[0] === canonicalMime
    && output.bytes instanceof Uint8Array
    && output.bytes.byteLength > 0
    && output.bytes.byteLength <= MAX_GENERATED_DOCUMENT_BYTES
    && output.sizeBytes === output.bytes.byteLength
    && isValidGeneratedDocumentMetadata({
      id: "generated-document-validation",
      conversationId: input.conversationId,
      messageId: "generated-message-validation",
      filename: output.filename,
      format: output.format,
      mimeType: canonicalMime,
      sizeBytes: output.sizeBytes,
      createdAt: "2026-01-01T00:00:00.000Z",
      templateId: input.templateId,
    });
}

function createGeneratedDocumentPersistenceOperations(
  dependencies: GeneratedDocumentPersistenceDependencies = defaultDependencies(),
) {
  const persist = async function persistGeneratedDocumentWith(
    input: GeneratedDocumentPersistenceInput,
    persistChat: (
      input: GeneratedDocumentPersistenceInput & {
        generatedDocumentId: string;
        storagePath: string;
      },
    ) => Promise<unknown>,
  ): Promise<GeneratedDocumentPersistenceResult> {
    if (!validInput(input)) throw new GeneratedDocumentPersistenceError("invalid_output");

    const generatedDocumentId = dependencies.createId();
    const mimeType = input.generatedOutput.mimeType.split(";", 1)[0] ?? input.generatedOutput.mimeType;
    let storagePath = "";
    let persistenceCommitted = false;
    let replayDuplicate = false;
    try {
      storagePath = await dependencies.upload({
        userId: input.userId,
        conversationId: input.conversationId,
        generatedDocumentId,
        filename: input.generatedOutput.filename,
        format: input.generatedOutput.format,
        mimeType,
        bytes: input.generatedOutput.bytes,
      });

      const raw = await persistChat({
        ...input,
        generatedDocumentId,
        storagePath,
      });
      if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") {
        throw new GeneratedDocumentPersistenceError("persistence_failure");
      }
      const persisted = raw[0] as Record<string, unknown>;
      const messageId = typeof persisted.assistant_message_id === "string" ? persisted.assistant_message_id : "";
      const documentId = typeof persisted.generated_document_id === "string" ? persisted.generated_document_id : "";
      if (!messageId || !documentId) throw new GeneratedDocumentPersistenceError("persistence_failure");

      const wasExisting = persisted.was_existing === true;
      persistenceCommitted = true;
      if (wasExisting) {
        replayDuplicate = true;
        await dependencies.remove({
          userId: input.userId,
          conversationId: input.conversationId,
          generatedDocumentId,
          filename: input.generatedOutput.filename,
          format: input.generatedOutput.format,
          storagePath,
        });
        storagePath = "";
      }

      const record = await dependencies.findById({ userId: input.userId, generatedDocumentId: documentId });
      if (!record || record.userId !== input.userId || record.conversationId !== input.conversationId
        || record.messageId !== messageId) {
        throw new GeneratedDocumentPersistenceError(wasExisting ? "existing_result_unavailable" : "persistence_failure");
      }
      const reference = referenceFromRecord(record);
      const bytes = wasExisting ? await dependencies.download(record) : input.generatedOutput.bytes;
      return {
        reference,
        delivery: {
          bytes,
          filename: reference.filename,
          mimeType: reference.mimeType,
          format: reference.format,
        },
      };
    } catch (error) {
      if (storagePath && (!persistenceCommitted || replayDuplicate)) {
        try {
          await dependencies.remove({
            userId: input.userId,
            conversationId: input.conversationId,
            generatedDocumentId,
            filename: input.generatedOutput.filename,
            format: input.generatedOutput.format,
            storagePath,
          });
        } catch {
          // Preserve the original safe service error; cleanup remains best effort.
        }
      }
      if (error instanceof GeneratedDocumentPersistenceError) throw error;
      throw new GeneratedDocumentPersistenceError(
        persistenceCommitted ? "existing_result_unavailable" : storagePath ? "persistence_failure" : "storage_failure",
      );
    }
  };

  return {
    persistGeneratedDocument: (input: PersistGeneratedDocumentInput) =>
      persist(input, (persistInput) => dependencies.persistChat({
        ...persistInput,
        assistantMessageContent: input.assistantMessageContent,
      })),
    persistGeneratedDocumentForExistingMessage: async (
      input: PersistGeneratedDocumentForExistingMessageInput,
    ) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.assistantMessageId)) {
        throw new GeneratedDocumentPersistenceError("invalid_output");
      }
      return await persist(input, (persistInput) => dependencies.persistChatForExistingMessage({
        ...persistInput,
        assistantMessageId: input.assistantMessageId,
      }));
    },
  };
}

export function createGeneratedDocumentPersistenceService(
  dependencies: GeneratedDocumentPersistenceDependencies = defaultDependencies(),
) {
  return createGeneratedDocumentPersistenceOperations(dependencies).persistGeneratedDocument;
}

export function createGeneratedDocumentPersistenceServiceForExistingMessage(
  dependencies: GeneratedDocumentPersistenceDependencies = defaultDependencies(),
) {
  return createGeneratedDocumentPersistenceOperations(dependencies)
    .persistGeneratedDocumentForExistingMessage;
}

export const persistGeneratedDocument = createGeneratedDocumentPersistenceService();
export const persistGeneratedDocumentForExistingMessage =
  createGeneratedDocumentPersistenceServiceForExistingMessage();
