import { describe, expect, it, vi } from "vitest";
import {
  documentFormatFromMimeType,
  filenameFromContentDisposition,
  saveDocumentBlob,
} from "@/lib/documents/download";

describe("document download helpers", () => {
  it("maps supported MIME types and extracts safe response filenames", () => {
    expect(documentFormatFromMimeType("text/markdown; charset=utf-8")).toBe("md");
    expect(documentFormatFromMimeType("application/zip")).toBe("zip");
    expect(documentFormatFromMimeType("application/x-executable")).toBeNull();
    expect(filenameFromContentDisposition('attachment; filename="report.pdf"')).toBe(
      "report.pdf",
    );
  });

  it("creates, triggers, and revokes a browser object URL", async () => {
    const click = vi.fn();
    const revoke = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    const anchor = { click, href: "", download: "", rel: "" } as unknown as HTMLAnchorElement;
    const createObjectUrl = vi.fn(() => "blob:document");

    await saveDocumentBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
      "report.pdf",
      "pdf",
      {
        createObjectUrl,
        createAnchor: () => anchor,
        revokeObjectUrl: revoke,
        scheduleObjectUrlRevoke: schedule,
      },
    );

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(anchor.href).toBe("blob:document");
    expect(anchor.download).toBe("report.pdf");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:document");
  });

  it("uses the same native save contract for Android files", async () => {
    const nativeSave = vi.fn(async () => undefined);

    await saveDocumentBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" }),
      "bundle.zip",
      "zip",
      { nativeSave },
    );

    expect(nativeSave).toHaveBeenCalledWith({
      base64: "AQID",
      fileName: "bundle.zip",
      mimeType: "application/zip",
    });
  });

  it("rejects unsafe filenames and mismatched supported MIME types", async () => {
    await expect(
      saveDocumentBlob(
        new Blob([new Uint8Array([1])], { type: "application/pdf" }),
        "../report.pdf",
        "pdf",
      ),
    ).rejects.toThrow(/safely/);

    await expect(
      saveDocumentBlob(
        new Blob([new Uint8Array([1])], { type: "application/pdf" }),
        "report.pdf",
        "docx",
      ),
    ).rejects.toThrow(/safely/);
  });
});
