import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPastedTextAttachment,
  getComposerMessageLengthError,
  insertTextAtSelection,
  shouldConvertLargePasteToAttachment,
} from "@/app/chat/ChatClient";
import { DOCUMENT_LIMITS, getDocumentLimits } from "@/lib/documents/config";
import { validateFiles } from "@/lib/documents/validate-upload";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const uploadRouteSource = readFileSync("app/api/documents/upload/route.ts", "utf8");
const chatRouteSource = readFileSync("app/api/chat/route.ts", "utf8");

function makeDocumentFile(name: string, sizeBytes: number, type: string): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("composer large-input handling", () => {
  it("keeps ordinary pastes inline and converts only oversized pastes", () => {
    expect(shouldConvertLargePasteToAttachment("x".repeat(2000))).toBe(false);
    expect(shouldConvertLargePasteToAttachment("x".repeat(2001))).toBe(true);
  });

  it("preserves existing instructions, selection replacement, and exact newlines", () => {
    const pastedText = "line one\r\n\r\nline two  \nline three";

    expect(insertTextAtSelection("Review: old", pastedText, 8, 11)).toBe(
      `Review: ${pastedText}`,
    );
    expect(insertTextAtSelection("Review this", pastedText, 11, 11)).toBe(
      `Review this${pastedText}`,
    );
  });

  it("materializes the full oversized paste as a governed text attachment", async () => {
    const pastedText = "first line\n\nconst value = `preserve this`;\n" + "x".repeat(2001);
    const attachment = createPastedTextAttachment(pastedText);

    expect(attachment.name).toBe("pasted-text.txt");
    expect(attachment.type).toBe("text/plain");
    expect(await attachment.text()).toBe(pastedText);
  });

  it("fails explicitly above the request boundary instead of truncating", () => {
    expect(getComposerMessageLengthError(4000)).toBeNull();
    expect(getComposerMessageLengthError(4001)).toBe(
      "Message too long. Maximum 4000 characters.",
    );
  });

  it("removes browser maxLength truncation and wires the large-paste handler", () => {
    expect(clientSource).toContain("onPaste={handleComposerPaste}");
    expect(clientSource).toContain("handleFilesSelected([pastedFile])");
    expect(clientSource).toContain("setComposerDocuments(sentDocuments)");
    expect(clientSource).not.toContain("maxLength={MAX_INPUT_LENGTH}");
    expect(clientSource).toContain("MAX_REQUEST_MESSAGE_LENGTH = 4000");
  });

  it("enforces Free and Pro document count and size limits", () => {
    const fiveMb = 5 * 1024 * 1024;
    const tenMb = 10 * 1024 * 1024;
    const freeDocument = makeDocumentFile("notes.pdf", fiveMb, "application/pdf");
    const oversizedFreeDocument = makeDocumentFile("large.pdf", fiveMb + 1, "application/pdf");

    expect(getDocumentLimits("free")).toEqual({
      maxFilesPerMessage: 1,
      maxFileSizeBytes: fiveMb,
    });
    expect(getDocumentLimits("pro")).toEqual({
      maxFilesPerMessage: 3,
      maxFileSizeBytes: tenMb,
    });
    expect(validateFiles([freeDocument], "free")).toBeNull();
    expect(validateFiles([freeDocument, freeDocument], "free")).toBe(
      "You can upload up to 1 document per message.",
    );
    expect(validateFiles([oversizedFreeDocument], "free")).toBe(
      "File exceeds 5 MB: large.pdf",
    );
    expect(
      validateFiles(
        [
          makeDocumentFile("one.pdf", tenMb, "application/pdf"),
          makeDocumentFile("two.docx", tenMb, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          makeDocumentFile("three.txt", tenMb, "text/plain"),
        ],
        "pro",
      ),
    ).toBeNull();
    expect(DOCUMENT_LIMITS.allowedExtensions).toContain(".pdf");
    expect(validateFiles([makeDocumentFile("photo.exe", 1, "application/x-msdownload")], "free")).toBe(
      "Unsupported file type: photo.exe",
    );
  });

  it("keeps document entitlement authoritative and mode/quota behavior scoped", () => {
    expect(uploadRouteSource).toContain("const planCheck = await getUserPlan");
    expect(uploadRouteSource).toContain("validateFiles(files, planCheck.plan");
    expect(uploadRouteSource).not.toContain("File uploads are a Pro feature");
    expect(chatRouteSource).toContain("const documentLimits = getDocumentLimits(plan)");
    expect(chatRouteSource).toContain("DOCUMENT_LIMIT_EXCEEDED");
    expect(chatRouteSource).toContain("FREE_DAILY_MESSAGE_LIMIT ?? 20");
    expect(clientSource).toContain("Document upload is only available in Standard mode.");
    expect(clientSource).toContain("Image generation mode does not support file upload.");
    expect(clientSource).toContain("disabled={composerDisabled}");
  });
});
