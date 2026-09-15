type DocumentRow = {
  id: string;
  file_name: string;
  extracted_text: string | null;
};

export const MAX_DOCUMENT_CONTEXT_CHARS = 30000;

export class DocumentContextLimitError extends Error {
  constructor() {
    super(
      "Attached document content exceeds the supported context size. Please remove a document or use a shorter file."
    );
    this.name = "DocumentContextLimitError";
  }
}

export function buildDocumentContext(documents: DocumentRow[]) {
  const usable = documents.filter((doc) => doc.extracted_text?.trim());

  if (!usable.length) {
    return "";
  }

  const totalCharacters = usable.reduce(
    (total, doc) => total + (doc.extracted_text?.length ?? 0),
    0
  );

  if (totalCharacters > MAX_DOCUMENT_CONTEXT_CHARS) {
    throw new DocumentContextLimitError();
  }

  const sections = usable.map((doc) => {
    const text = doc.extracted_text || "";

    return [
      `Document ID: ${doc.id}`,
      `File Name: ${doc.file_name}`,
      "Content:",
      text,
    ].join("\n");
  });

  return [
    "The user attached the following documents.",
    "Use them as the primary source of truth for this answer.",
    "If the answer is not in the documents, say that clearly.",
    "Do not invent missing details.",
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}
