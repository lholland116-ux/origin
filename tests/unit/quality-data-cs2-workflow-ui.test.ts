import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Layer 3 CS2 quality demonstration UI boundaries", () => {
  const ingestion = readFileSync(resolve("app/quality-data/QualityDataIngestionClient.tsx"), "utf8");
  const analysis = readFileSync(resolve("app/quality-data/QualityDataAnalysisWorkspace.tsx"), "utf8");
  const report = readFileSync(resolve("app/quality-data/QualityDataIntelligenceReportClient.tsx"), "utf8");
  const capa = readFileSync(resolve("app/capa/CapaIntakeClient.tsx"), "utf8");

  it("retains the exact ingestion receipt IDs and links to the fictional fixture", () => {
    expect(ingestion).toContain("receipt.dataset_id");
    expect(ingestion).toContain("receipt.dataset_version_id");
    expect(ingestion).toContain("receipt.source_version_id");
    expect(ingestion).toContain("/demo/synthetic-manufacturing-quality.xlsx");
    expect(ingestion).toContain("normalized_unit");
  });

  it("separates explicit dataset approval from deterministic report creation", () => {
    expect(analysis).toContain("Approve version for analytical use");
    expect(analysis).toContain("/approval");
    expect(analysis).toContain("/api/quality-data/intelligence/deterministic");
    expect(analysis).toContain('mode: "deterministic_only"');
    expect(analysis).not.toContain("/api/quality-data/ai-analysis");
  });

  it("shows cell provenance and keeps human review separate from CAPA creation", () => {
    expect(report).toContain("Cell-level source provenance");
    expect(report).toContain("Record human review");
    expect(report).toContain("Create S00 CAPA draft");
    expect(report).toContain("source verification: not asserted");
    expect(report).toContain("workflow not advanced");
    expect(report).toContain("/capa-draft");
    expect(report).toContain("/review");
  });

  it("offers reverse navigation through the server-authorized evidence lookup", () => {
    expect(capa).toContain("View Supporting Evidence");
    expect(capa).toContain("/api/quality-data/capa-evidence/");
  });
});
