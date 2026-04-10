type DocumentRow = {
  id: string;
  file_name: string;
  extracted_text: string | null;
};

const MAX_TOTAL_CHARS = 30000;

function trimText(text: string, maxChars: number) {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function buildDocumentContext(documents: DocumentRow[]) {
  const usable = documents.filter((doc) => doc.extracted_text?.trim());

  if (!usable.length) {
    return "";
  }

  const perDocMax = Math.max(4000, Math.floor(MAX_TOTAL_CHARS / usable.length));

  const sections = usable.map((doc) => {
    const text = trimText(doc.extracted_text || "", perDocMax);

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