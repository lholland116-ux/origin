import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENT_BUCKET, DOCUMENT_LIMITS } from "@/lib/documents/config";
import { extractTextFromFile } from "@/lib/documents/extract-text";

type UploadedDocumentResponse = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: string;
  conversation_id: string | null;
};

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
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
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const formData = await req.formData();
    const files = formData.getAll("files").filter((v): v is File => v instanceof File);
    const conversationIdRaw = formData.get("conversationId");
    const conversationId =
      typeof conversationIdRaw === "string" && conversationIdRaw.trim()
        ? conversationIdRaw
        : null;

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    if (files.length > DOCUMENT_LIMITS.maxFilesPerMessage) {
      return NextResponse.json(
        {
          error: `Maximum ${DOCUMENT_LIMITS.maxFilesPerMessage} files per message.`,
        },
        { status: 400 }
      );
    }

    const uploadedDocuments: UploadedDocumentResponse[] = [];

    for (const file of files) {
      if (!DOCUMENT_LIMITS.allowedMimeTypes.includes(file.type as any)) {
        return NextResponse.json(
          { error: `Unsupported file type: ${file.name}` },
          { status: 400 }
        );
      }

      if (file.size > DOCUMENT_LIMITS.maxFileSizeBytes) {
        return NextResponse.json(
          { error: `File exceeds 10 MB: ${file.name}` },
          { status: 400 }
        );
      }

      const safeName = sanitizeFileName(file.name);
      const storagePath = `${user.id}/${conversationId ?? "general"}/${Date.now()}-${safeName}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
          cacheControl: "3600",
        });

      if (uploadError) {
        return NextResponse.json(
          { error: `Storage upload failed for ${file.name}: ${uploadError.message}` },
          { status: 500 }
        );
      }

      const { data: inserted, error: insertError } = await admin
        .from("documents")
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          storage_path: storagePath,
          extraction_status: "processing",
        })
        .select("id, file_name, mime_type, size_bytes, extraction_status, conversation_id")
        .single();

      if (insertError || !inserted) {
        await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);

        return NextResponse.json(
          { error: `Database insert failed for ${file.name}.` },
          { status: 500 }
        );
      }

      try {
        const extractedText = await extractTextFromFile(buffer, file.type);

        await admin
          .from("documents")
          .update({
            extracted_text: extractedText,
            extraction_status: "ready",
            extraction_error: null,
          })
          .eq("id", inserted.id)
          .eq("user_id", user.id);

        uploadedDocuments.push({
          ...inserted,
          extraction_status: "ready",
        });
      } catch (extractionError) {
        const message =
          extractionError instanceof Error
            ? extractionError.message
            : "Unknown extraction error";

        await admin
          .from("documents")
          .update({
            extraction_status: "failed",
            extraction_error: message,
          })
          .eq("id", inserted.id)
          .eq("user_id", user.id);

        uploadedDocuments.push({
          ...inserted,
          extraction_status: "failed",
        });
      }
    }

    return NextResponse.json({ documents: uploadedDocuments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}