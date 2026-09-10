import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(relativePath), "utf8");

describe("S40 advisory reference-manifest client/server boundary", () => {
  it("keeps the browser-safe contract free of node crypto", () => {
    const contract = source("lib/capa/ai/capa-investigation-active-advisory-reference-manifest-contract.ts");
    expect(contract).not.toContain("node:crypto");
    expect(contract).not.toContain("createHash");
  });

  it("keeps the adoption validator off the crypto-bearing manifest module", () => {
    const validator = source("lib/capa/ai/capa-investigation-active-adoption-validator.ts");
    expect(validator).toContain("capa-investigation-active-advisory-reference-manifest-contract");
    expect(validator).not.toContain("capa-investigation-active-advisory-reference-manifest\"");
    expect(validator).not.toContain("capa-ai-generation-trace");
  });

  it("retains server fingerprinting in the manifest module", () => {
    const manifest = source("lib/capa/ai/capa-investigation-active-advisory-reference-manifest.ts");
    expect(manifest).toContain("capa-ai-generation-trace");
    expect(manifest).toContain("fingerprintCanonicalJson");
  });
});
