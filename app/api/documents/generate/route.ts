import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  generateTemplateOutput,
  isTemplateOutputFormat,
} from "@/lib/documents/generation";
import type {
  TemplateInputValue,
  TemplateOutputFormat,
  TemplateVariablesRecord,
} from "@/lib/documents/generation/templates/types";
import {
  DocumentGenerationValidationError,
  MAX_ARTIFACT_BYTES,
} from "@/lib/documents/generation/validation";
import { TemplateValidationError } from "@/lib/documents/generation/templates/types";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_FORMATS = 7;

type GenerateDocumentBody = {
  readonly templateId?: unknown;
  readonly format?: unknown;
  readonly formats?: unknown;
  readonly variables?: unknown;
  readonly filename?: unknown;
  readonly package?: unknown;
};

function errorResponse(message: string, status: number): Response {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplateInputValue(value: unknown, depth = 0): value is TemplateInputValue {
  if (depth > 12) return false;
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value) || typeof value !== "number";
  }
  if (Array.isArray(value)) {
    return value.every((item) => isTemplateInputValue(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isTemplateInputValue(item, depth + 1));
}

function parseVariables(value: unknown): TemplateVariablesRecord | null {
  return isRecord(value) && isTemplateInputValue(value)
    ? (value as TemplateVariablesRecord)
    : null;
}

function parseFormats(body: GenerateDocumentBody): {
  formats: readonly TemplateOutputFormat[];
  packageAsZip: boolean;
} | { error: string } {
  const requestedFormats = Array.isArray(body.formats)
    ? body.formats
    : body.format === "zip"
      ? []
      : [body.format];

  if (requestedFormats.length === 0 || requestedFormats.length > MAX_FORMATS) {
    return { error: "At least one and no more than seven output formats are required." };
  }

  const formats = requestedFormats.filter((format): format is TemplateOutputFormat => isTemplateOutputFormat(format));
  if (formats.length !== requestedFormats.length) {
    return { error: "One or more requested output formats are unsupported." };
  }

  const uniqueFormats = Array.from(new Set(formats));
  if (uniqueFormats.length !== formats.length) {
    return { error: "Output formats must be unique." };
  }

  return {
    formats: uniqueFormats,
    packageAsZip: body.format === "zip" || Boolean(body.package) || uniqueFormats.length > 1,
  };
}

function getFilename(body: GenerateDocumentBody): string | undefined {
  if (body.filename === undefined) return undefined;
  return typeof body.filename === "string" && body.filename.trim()
    ? body.filename.trim()
    : undefined;
}

export async function POST(request: Request): Promise<Response> {
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;

  try {
    supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return errorResponse("Authentication is required.", 401);
    }
  } catch {
    return errorResponse("Authentication is required.", 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("The generation request is too large.", 413);
  }

  let body: GenerateDocumentBody;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("The generation request is too large.", 413);
    }
    body = JSON.parse(raw) as GenerateDocumentBody;
  } catch {
    return errorResponse("Invalid generation request.", 400);
  }

  if (!isRecord(body)) {
    return errorResponse("Invalid generation request.", 400);
  }

  const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
  if (!templateId) return errorResponse("templateId is required.", 400);

  const variables = parseVariables(body.variables);
  if (!variables) return errorResponse("variables must be a valid object.", 400);

  const formatResult = parseFormats(body);
  if ("error" in formatResult) return errorResponse(formatResult.error, 400);

  try {
    const artifact = await generateTemplateOutput({
      templateId,
      formats: formatResult.formats,
      variables,
      packageAsZip: formatResult.packageAsZip,
      filename: getFilename(body),
    });

    if (artifact.sizeBytes > MAX_ARTIFACT_BYTES) {
      return errorResponse("The generated document is too large.", 413);
    }

    return new Response(new Blob([artifact.bytes as unknown as ArrayBuffer], { type: artifact.mimeType }), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        "Content-Type": artifact.mimeType,
        "X-Content-Type-Options": "nosniff",
        "X-LVTChat-Document": "generated",
        "X-LVTChat-Document-Format": artifact.format,
      },
    });
  } catch (error) {
    if (error instanceof TemplateValidationError || error instanceof DocumentGenerationValidationError) {
      return errorResponse(error.message, 400);
    }

    console.error("/api/documents/generate error:", error);
    return errorResponse("The document could not be generated. Please try again.", 500);
  }
}
