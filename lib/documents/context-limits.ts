/** Maximum extracted document text included in a single chat context. */
export const MAX_DOCUMENT_CONTEXT_CHARS = 30000;

export class DocumentContextLimitError extends Error {
  constructor() {
    super(
      "Attached document content exceeds the supported context size. Please remove a document or use a shorter file."
    );
    this.name = "DocumentContextLimitError";
  }
}
