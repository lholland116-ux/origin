import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { generatePdfArtifact } from "@/lib/documents/generation";

describe("PDFKit production runtime", () => {
  it("keeps PDFKit external to the Next server bundle and resolves its standard Helvetica font", async () => {
    expect(nextConfig.serverExternalPackages).toContain("pdfkit");

    const artifact = await generatePdfArtifact({
      format: "pdf",
      title: "Production PDF smoke test",
      sections: [{ type: "paragraph", text: "PDFKit standard-font resolution is available." }],
    });

    expect(Buffer.from(artifact.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(artifact.bytes.byteLength).toBeGreaterThan(100);
  });
});
