import { describe, expect, it } from "vitest";
import {
  buildDocumentContext,
  DocumentContextLimitError,
  MAX_DOCUMENT_CONTEXT_CHARS,
} from "@/lib/documents/prepare-context";

describe("document context limits", () => {
  it("preserves document content exactly when it fits the context boundary", () => {
    const content = "first line\n\nsecond line  \nconst value = `keep`;";
    const context = buildDocumentContext([
      {
        id: "document-1",
        file_name: "pasted-text.txt",
        extracted_text: content,
      },
    ]);

    expect(context).toContain(content);
  });

  it("rejects oversized document context explicitly instead of truncating it", () => {
    expect(() =>
      buildDocumentContext([
        {
          id: "document-1",
          file_name: "pasted-text.txt",
          extracted_text: "x".repeat(MAX_DOCUMENT_CONTEXT_CHARS + 1),
        },
      ])
    ).toThrowError(
      new DocumentContextLimitError(),
    );
  });
});
