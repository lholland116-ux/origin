import mammoth from "mammoth";

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const pdfParse =
    (mod as { default?: (buffer: Buffer) => Promise<{ text?: string }> }).default ??
    (mod as unknown as (buffer: Buffer) => Promise<{ text?: string }>);

  const result = await pdfParse(buffer);
  return normalizeText(result.text || "");
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value || "");
}

async function extractPlainText(buffer: Buffer): Promise<string> {
  return normalizeText(buffer.toString("utf-8"));
}

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return extractPdfText(buffer);

    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocxText(buffer);

    case "text/plain":
    case "text/markdown":
    case "text/csv":
      return extractPlainText(buffer);

    default:
      throw new Error(`Unsupported MIME type for extraction: ${mimeType}`);
  }
}