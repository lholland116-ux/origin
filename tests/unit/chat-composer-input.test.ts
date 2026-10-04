import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canAttachLargePasteInMode,
  canUploadDocumentInMode,
  buildChatRequestBody,
  createPastedTextAttachment,
  getComposerMessageLengthError,
  getClipboardImageFiles,
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

function clipboardItem(type: string, file: File | null) {
  return {
    kind: "file",
    type,
    getAsFile: () => file,
  } as DataTransferItem;
}

function clipboardData(params: {
  items?: DataTransferItem[];
  files?: File[];
} = {}): DataTransfer {
  return {
    items: params.items,
    files: params.files,
  } as unknown as DataTransfer;
}

describe("composer large-input handling", () => {
  it.each([
    [false, "instant"],
    [false, "medium"],
    [false, "high"],
    [true, "instant"],
    [true, "medium"],
    [true, "high"],
  ] as const)("includes the exact %s-route reasoning mode in its chat request body", (useWebSearch, reasoningMode) => {
    const body = buildChatRequestBody({
      conversationId: "conversation-1",
      message: "A user message",
      generationRequestId: "request-1",
      documentIds: ["document-1"],
      reasoningMode,
      useWebSearch,
      hasImages: !useWebSearch,
      images: [{ imagePath: "image/path", imageName: "photo.png" }],
    });

    expect(body).toMatchObject({
      conversationId: "conversation-1",
      message: "A user message",
      generationRequestId: "request-1",
      documentIds: ["document-1"],
      reasoningMode,
    });
    if (useWebSearch) {
      expect(body).not.toHaveProperty("images");
    } else {
      expect(body).toHaveProperty("images", [{
        imagePath: "image/path",
        imageName: "photo.png",
      }]);
    }
  });

  it("keeps the default Medium state and sends the current selected mode", () => {
    expect(clientSource).toContain('useState<ChatReasoningMode>("medium")');
    expect(clientSource).toContain("reasoningMode,\n          useWebSearch,");
    expect(clientSource).toContain("setReasoningMode(nextMode)");
  });

  it("does not reset reasoning mode when Standard and Web Search change", () => {
    const modeStart = clientSource.indexOf("function handleModeChange(");
    const modeEnd = clientSource.indexOf("function handleImageModeChange(", modeStart);
    const modeHandler = clientSource.slice(modeStart, modeEnd);

    expect(modeHandler).toContain("setUseWebSearch(nextUseWebSearch)");
    expect(modeHandler).not.toContain("setReasoningMode(");
  });

  it("keeps ordinary pastes inline and converts only oversized pastes", () => {
    expect(shouldConvertLargePasteToAttachment("x".repeat(2000))).toBe(false);
    expect(shouldConvertLargePasteToAttachment("x".repeat(2001))).toBe(true);
  });

  it("allows governed large-paste attachments in Standard and Web Search, but not Create Image", () => {
    expect(canAttachLargePasteInMode("standard")).toBe(true);
    expect(canAttachLargePasteInMode("web_search")).toBe(true);
    expect(canAttachLargePasteInMode("create_image")).toBe(false);
    expect(clientSource).toContain(
      "!canAttachLargePasteInMode(composerPlusMenuMode)",
    );
  });

  it("keeps manual document upload unavailable in Web Search", () => {
    expect(canUploadDocumentInMode("standard", "manual")).toBe(true);
    expect(canUploadDocumentInMode("web_search", "manual")).toBe(false);
    expect(canUploadDocumentInMode("web_search", "pasted_text")).toBe(true);
    expect(canUploadDocumentInMode("create_image", "pasted_text")).toBe(false);
    expect(clientSource).toContain('handleFilesSelected([pastedFile], "pasted_text")');
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

  it("detects image clipboard items by MIME type and preserves their bytes", async () => {
    const imageFile = new File(["unchanged image bytes"], "", { type: "image/png" });
    const images = getClipboardImageFiles(clipboardData({
      items: [clipboardItem("image/png", imageFile)],
    }));

    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe("pasted-image-1.png");
    expect(images[0]?.type).toBe("image/png");
    expect(await images[0]?.text()).toBe("unchanged image bytes");
  });

  it("uses image MIME rather than filenames and ignores non-image clipboard files", () => {
    const imageNamedAsText = new File(["image"], "clipboard.txt", { type: "image/webp" });
    const textNamedAsImage = new File(["text"], "picture.png", { type: "text/plain" });
    const images = getClipboardImageFiles(clipboardData({
      items: [
        clipboardItem("image/webp", imageNamedAsText),
        clipboardItem("text/plain", textNamedAsImage),
      ],
      files: [imageNamedAsText, textNamedAsImage],
    }));

    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe("pasted-image-1.webp");
    expect(images[0]?.type).toBe("image/webp");
  });

  it("falls back to image files when clipboard items are unavailable and handles missing data", () => {
    const imageFile = new File(["image"], "capture.jpeg", { type: "image/jpeg" });
    const textFile = new File(["text"], "capture.png", { type: "text/plain" });

    const images = getClipboardImageFiles(clipboardData({ files: [imageFile, textFile] }));
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe("pasted-image-1.jpg");
    expect(images[0]?.type).toBe("image/jpeg");
    expect(getClipboardImageFiles(undefined)).toEqual([]);
  });

  it("wires image paste to the shared manual-image intake without changing text paste", () => {
    const pasteStart = clientSource.indexOf("function handleComposerPaste(");
    const pasteEnd = clientSource.indexOf("function removeComposerDocument(", pasteStart);
    const pasteHandler = clientSource.slice(pasteStart, pasteEnd);
    const sharedStart = clientSource.indexOf("async function handleImageFilesSelected(");
    const manualStart = clientSource.indexOf("async function handleImageChange(");
    const manualEnd = clientSource.indexOf("async function handleSubmit(", manualStart);
    const imageHandlers = clientSource.slice(sharedStart, manualEnd);

    expect(pasteHandler.indexOf("getClipboardImageFiles(clipboardData)")).toBeGreaterThanOrEqual(0);
    expect(pasteHandler.indexOf("getClipboardImageFiles(clipboardData)")).toBeLessThan(
      pasteHandler.indexOf('clipboardData.getData("text/plain")'),
    );
    expect(pasteHandler).toContain("if (!clipboardData) return;");
    expect(pasteHandler).toContain("event.preventDefault();\n      void handleImageFilesSelected(imageFiles);");
    expect(pasteHandler).toContain('if (!shouldConvertLargePasteToAttachment(pastedText))');
    expect(pasteHandler).toContain('event.preventDefault();');
    expect(imageHandlers).toContain("async function handleImageFilesSelected(files: File[])");
    expect(imageHandlers).toContain("await handleImageFilesSelected(files);");
    expect(imageHandlers).toContain("canAddPendingImages(pendingImages.length, files.length, currentPlan)");
    expect(imageHandlers).toContain("const validationError = validateImageBatch(files);");
    expect(imageHandlers).toContain("if (useWebSearch || useImageGeneration)");
  });

  it("fails explicitly above the request boundary instead of truncating", () => {
    expect(getComposerMessageLengthError(4000)).toBeNull();
    expect(getComposerMessageLengthError(4001)).toBe(
      "Message too long. Maximum 4000 characters.",
    );
  });

  it("removes browser maxLength truncation and wires the large-paste handler", () => {
    expect(clientSource).toContain("onPaste={handleComposerPaste}");
    expect(clientSource).toContain('handleFilesSelected([pastedFile], "pasted_text")');
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
    expect(clientSource).toContain("Document upload is not available in Create Image mode.");
    expect(clientSource).toContain("Image generation mode does not support file upload.");
    expect(clientSource).toContain("disabled={composerDisabled}");
  });
});
