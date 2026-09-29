import { createAdminClient } from "@/lib/supabase/admin";
import {
  isValidGeneratedDocumentMetadata,
  MAX_GENERATED_DOCUMENT_BYTES,
  type GeneratedDocumentPersistenceRecord,
} from "./generated-document-contracts";
import {
  buildGeneratedDocumentStoragePath,
  validateGeneratedDocumentStoragePath,
} from "./generated-document-storage";
import { getDocumentMimeType } from "./generation/mime";
import type { DocumentFormat } from "./generation/contracts";

const DOCUMENT_BUCKET = "documents";
const SELECT_COLUMNS = "id,user_id,conversation_id,message_id,generation_request_id,storage_path,filename,format,mime_type,size_bytes,template_id,created_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GeneratedDocumentRow = Record<string, unknown>;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function rowToRecord(row: unknown): GeneratedDocumentPersistenceRecord | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as GeneratedDocumentRow;
  const record = {
    id: value.id,
    userId: value.user_id,
    conversationId: value.conversation_id,
    messageId: value.message_id,
    generationRequestId: value.generation_request_id,
    storagePath: value.storage_path,
    filename: value.filename,
    format: value.format,
    mimeType: value.mime_type,
    sizeBytes: value.size_bytes,
    templateId: value.template_id ?? null,
    createdAt: value.created_at,
  };

  if (
    !isUuid(record.id) ||
    !isUuid(record.userId) ||
    !isUuid(record.conversationId) ||
    !isUuid(record.messageId) ||
    !isUuid(record.generationRequestId) ||
    typeof record.storagePath !== "string" ||
    typeof record.filename !== "string" ||
    typeof record.format !== "string" ||
    typeof record.mimeType !== "string" ||
    typeof record.sizeBytes !== "number" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }

  const metadata = {
    id: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    filename: record.filename,
    format: record.format as DocumentFormat,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    templateId: record.templateId,
    createdAt: record.createdAt,
  };

  if (!isValidGeneratedDocumentMetadata(metadata)) return null;
  if (
    !validateGeneratedDocumentStoragePath(record.storagePath, {
      userId: record.userId,
      conversationId: record.conversationId,
      generatedDocumentId: record.id,
      filename: record.filename,
      format: metadata.format,
    })
  ) {
    return null;
  }

  return { ...metadata, userId: record.userId, generationRequestId: record.generationRequestId, storagePath: record.storagePath };
}

async function findOne(filters: Record<string, string>): Promise<GeneratedDocumentPersistenceRecord | null> {
  const admin = createAdminClient();
  let query = admin.from("generated_documents").select(SELECT_COLUMNS);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Generated document metadata lookup failed.");
  return data ? rowToRecord(data) : null;
}

export async function findGeneratedDocumentByRequest(params: {
  userId: string;
  conversationId: string;
  generationRequestId: string;
}): Promise<GeneratedDocumentPersistenceRecord | null> {
  return findOne({ user_id: params.userId, conversation_id: params.conversationId, generation_request_id: params.generationRequestId });
}

export async function findGeneratedDocumentById(params: {
  userId: string;
  generatedDocumentId: string;
}): Promise<GeneratedDocumentPersistenceRecord | null> {
  return findOne({ user_id: params.userId, id: params.generatedDocumentId });
}

export async function uploadGeneratedDocumentArtifact(params: {
  userId: string;
  conversationId: string;
  generatedDocumentId: string;
  filename: string;
  format: DocumentFormat;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<string> {
  const storagePath = buildGeneratedDocumentStoragePath(params);
  const canonicalMimeType = getDocumentMimeType(params.format).split(";", 1)[0] ?? "";
  if (
    params.mimeType !== canonicalMimeType ||
    params.bytes.byteLength === 0 ||
    params.bytes.byteLength > MAX_GENERATED_DOCUMENT_BYTES
  ) {
    throw new Error("Generated document artifact validation failed.");
  }

  const admin = createAdminClient();
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(
    storagePath,
    Buffer.from(params.bytes),
    { contentType: canonicalMimeType, cacheControl: "3600", upsert: false },
  );
  if (error) throw new Error("Generated document upload failed.");
  return storagePath;
}

export async function removeGeneratedDocumentObject(params: {
  record: Pick<GeneratedDocumentPersistenceRecord, "userId" | "conversationId" | "id" | "filename" | "format" | "storagePath">;
}): Promise<void> {
  if (!validateGeneratedDocumentStoragePath(params.record.storagePath, {
    userId: params.record.userId,
    conversationId: params.record.conversationId,
    generatedDocumentId: params.record.id,
    filename: params.record.filename,
    format: params.record.format,
  })) throw new Error("Generated document storage path validation failed.");
  const admin = createAdminClient();
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).remove([params.record.storagePath]);
  if (error) throw new Error("Generated document cleanup failed.");
}

export async function removeGeneratedDocumentObjectByPath(params: {
  userId: string;
  conversationId: string;
  generatedDocumentId: string;
  filename: string;
  format: DocumentFormat;
  storagePath: string;
}): Promise<void> {
  await removeGeneratedDocumentObject({ record: { ...params, id: params.generatedDocumentId } });
}

export async function downloadGeneratedDocument(record: Pick<GeneratedDocumentPersistenceRecord, "storagePath" | "sizeBytes">): Promise<Uint8Array> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).download(record.storagePath);
  if (error || !data) throw new Error("Generated document download failed.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== record.sizeBytes) throw new Error("Generated document size validation failed.");
  return bytes;
}
