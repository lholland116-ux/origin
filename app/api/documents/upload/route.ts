import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_LIMITS,
  formatMaxFileSize,
  isAllowedDocumentExtension,
} from "@/lib/documents/config";
import { extractTextFromFile } from "@/lib/documents/extract-text";

type UploadedDocumentResponse = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: "processing" | "ready" | "failed";
  extraction_error: string | null;
  conversation_id: string | null;
};

const EXTRACTION_TIMEOUT_MS = 15_000;

const allowedMimeTypes = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

type AllowedMimeType = (typeof allowedMimeTypes)[number];

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return allowedMimeTypes.includes(mimeType as AllowedMimeType);
}

function inferMimeTypeFromExtension(fileName: string): string {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".txt")) return "text/plain";
  if (lowerName.endsWith(".md")) return "text/markdown";
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lowerName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  return "";
}

function getSafeMimeType(file: File): string {
  const mimeType = file.type?.trim() || "";

  if (mimeType && isAllowedMimeType(mimeType)) {
    return mimeType;
  }

  return inferMimeTypeFromExtension(file.name);
}

function normalizeExtractionError(error: unknown, mimeType: string): string {
  const message =
    error instanceof Error ? error.message : "Unknown extraction error.";

  if (mimeType === "application/pdf") {
    if (/timed out/i.test(message)) {
      return "PDF extraction timed out.";
    }

    if (/encrypted|password-protected/i.test(message)) {
      return "Encrypted or password-protected PDF is not supported.";
    }

    if (/no extractable text/i.test(message)) {
      return "PDF appears to contain no extractable text. It may be scanned or image-only.";
    }

    return `PDF extraction failed: ${message}`;
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    if (/timed out/i.test(message)) {
      return "Spreadsheet extraction timed out.";
    }

    if (/no extractable text/i.test(message)) {
      return "Spreadsheet appears to contain no extractable text.";
    }

    return `Spreadsheet extraction failed: ${message}`;
  }

  return message;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Extraction timed out.")), ms)
    ),
  ]);
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const admin = createAdminClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const formData = await req.formData();

    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    const conversationIdRaw = formData.get("conversationId");
    const conversationId =
      typeof conversationIdRaw === "string" && conversationIdRaw.trim()
        ? conversationIdRaw.trim()
        : null;

    if (!conversationId) {
      return jsonResponse({ error: "Missing conversationId." }, 400);
    }

    if (!files.length) {
      return jsonResponse({ error: "No files uploaded." }, 400);
    }

    if (files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
      return jsonResponse(
        {
          error: `You can upload up to ${DOCUMENT_LIMITS.maxFilesPerMessage} files per message.`,
        },
        400
      );
    }

    const uploadedDocuments: UploadedDocumentResponse[] = [];

    for (const file of files) {
      const fileName = file.name?.trim() || "Unnamed file";
      const safeMimeType = getSafeMimeType(file);

      if (file.size <= 0) {
        return jsonResponse({ error: `File is empty: ${fileName}` }, 400);
      }

      if (file.size > DOCUMENT_LIMITS.maxFileSizeBytes) {
        return jsonResponse(
          {
            error: `File exceeds ${formatMaxFileSize(
              DOCUMENT_LIMITS.maxFileSizeBytes
            )}: ${fileName}`,
          },
          400
        );
      }

      const hasAllowedMimeType = safeMimeType
        ? isAllowedMimeType(safeMimeType)
        : false;

      const hasAllowedExtension = isAllowedDocumentExtension(fileName);

      if (!hasAllowedMimeType && !hasAllowedExtension) {
        return jsonResponse(
          { error: `Unsupported file type: ${fileName}` },
          400
        );
      }

      const safeName = sanitizeFileName(fileName);
      const storagePath = `${user.id}/${conversationId}/${Date.now()}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, buffer, {
          contentType: safeMimeType || "application/octet-stream",
          upsert: false,
          cacheControl: "3600",
        });

      if (uploadError) {
        return jsonResponse(
          {
            error: `Storage upload failed for ${fileName}: ${uploadError.message}`,
          },
          500
        );
      }

      const { data: inserted, error: insertError } = await admin
        .from("documents")
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          file_name: fileName,
          mime_type: safeMimeType || "application/octet-stream",
          size_bytes: file.size,
          storage_path: storagePath,
          extraction_status: "processing",
          extraction_error: null,
        })
        .select(
          "id, file_name, mime_type, size_bytes, extraction_status, extraction_error, conversation_id"
        )
        .single();

      if (insertError || !inserted) {
        await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);

        return jsonResponse(
          { error: `Database insert failed for ${fileName}.` },
          500
        );
      }

      try {
        const extractedText = await withTimeout(
          extractTextFromFile(
            buffer,
            safeMimeType || "application/octet-stream"
          ),
          EXTRACTION_TIMEOUT_MS
        );

        if (!extractedText.trim()) {
          throw new Error("No extractable text found.");
        }

        const { error: updateError } = await admin
          .from("documents")
          .update({
            extracted_text: extractedText,
            extraction_status: "ready",
            extraction_error: null,
          })
          .eq("id", inserted.id)
          .eq("user_id", user.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        uploadedDocuments.push({
          id: inserted.id,
          file_name: inserted.file_name,
          mime_type: inserted.mime_type,
          size_bytes: inserted.size_bytes,
          extraction_status: "ready",
          extraction_error: null,
          conversation_id: inserted.conversation_id,
        });
      } catch (extractionError) {
        const message = normalizeExtractionError(
          extractionError,
          safeMimeType || "application/octet-stream"
        );

        const { error: failedUpdateError } = await admin
          .from("documents")
          .update({
            extraction_status: "failed",
            extraction_error: message,
          })
          .eq("id", inserted.id)
          .eq("user_id", user.id);

        if (failedUpdateError) {
          console.error(
            "/api/documents/upload failed-status update error:",
            failedUpdateError
          );
        }

        uploadedDocuments.push({
          id: inserted.id,
          file_name: inserted.file_name,
          mime_type: inserted.mime_type,
          size_bytes: inserted.size_bytes,
          extraction_status: "failed",
          extraction_error: message,
          conversation_id: inserted.conversation_id,
        });
      }
    }

    return jsonResponse({ documents: uploadedDocuments });
  } catch (error) {
    console.error("/api/documents/upload unexpected error:", error);
    const message =
      error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}