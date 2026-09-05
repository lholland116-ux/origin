import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
  createCapaInvestigationActiveAdvisoryReferenceManifest,
  validateCapaInvestigationActiveAdvisoryModelSafeContext,
  validateCapaInvestigationActiveAdvisoryReferenceManifest,
} from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";

const model_safe_context: any = {
  trust: "model_safe_context", workflow_state: "S40", references: [
    { reference_key: "R1", trust: "authoritative_server_context", source_kind: "investigation_plan_item" },
    { reference_key: "R2", trust: "untrusted_human_draft", source_kind: "ledger_item" },
  ],
};
const reference_manifest: any = [
  { reference_key: "R1", trust: "authoritative_server_context", source_kind: "investigation_plan_item", source_id: "INV-1" },
  { reference_key: "R2", trust: "untrusted_human_draft", source_kind: "ledger_item", source_id: "LEDGER-1" },
];

describe("S40 server-only advisory reference manifest", () => {
  it.each(["R1", "R100"])("accepts controlled reference key %s", (reference_key) => {
    expect(() => validateCapaInvestigationActiveAdvisoryModelSafeContext({
      trust: "model_safe_context",
      workflow_state: "S40",
      references: [{
        reference_key,
        trust: "authoritative_server_context",
        source_kind: "investigation_plan_item",
      }],
    })).not.toThrow();
  });

  it.each(["R0", "R00", "R01", "R101", "R999", "R-1", "reference-1"])(
    "rejects invalid controlled reference key %s",
    (reference_key) => {
      expect(() => validateCapaInvestigationActiveAdvisoryModelSafeContext({
        trust: "model_safe_context",
        workflow_state: "S40",
        references: [{
          reference_key,
          trust: "authoritative_server_context",
          source_kind: "investigation_plan_item",
        }],
      })).toThrow();
    },
  );

  it("requires the exact manifest document shape", () => {
    const document = {
      manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
      workflow_state: "S40",
      entries: reference_manifest,
    };

    expect(() => validateCapaInvestigationActiveAdvisoryReferenceManifest(
      document,
      model_safe_context,
    )).not.toThrow();

    expect(() => validateCapaInvestigationActiveAdvisoryReferenceManifest(
      { ...document, unexpected: true },
      model_safe_context,
    )).toThrow();
  });

  it.each([
    ["wrong trust", { ...model_safe_context, trust: "authoritative_server_context" }],
    ["wrong workflow state", { ...model_safe_context, workflow_state: "S30" }],
    ["non-array references", { ...model_safe_context, references: {} }],
    ["duplicate reference key", { ...model_safe_context, references: [model_safe_context.references[0], model_safe_context.references[0]] }],
    ["malformed reference entry", { ...model_safe_context, references: [{ reference_key: "R1" }] }],
    ["source identifier in model-safe reference", { ...model_safe_context, references: [{ ...model_safe_context.references[0], source_id: "INV-1" }] }],
    ["invalid reference trust", { ...model_safe_context, references: [{ ...model_safe_context.references[0], trust: "untrusted_human_draft" }] }],
    ["invalid reference source kind", { ...model_safe_context, references: [{ ...model_safe_context.references[0], source_kind: "invalid" }] }],
    ["R101", { ...model_safe_context, references: [{ ...model_safe_context.references[0], reference_key: "R101" }] }],
  ])("rejects malformed model-safe context: %s", (_name, value) => {
    expect(() => validateCapaInvestigationActiveAdvisoryModelSafeContext(value)).toThrow();
  });

  it("creates a frozen deterministic canonical manifest fingerprint", () => {
    const first = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest, model_safe_context });
    const second = createCapaInvestigationActiveAdvisoryReferenceManifest({
      reference_manifest: reference_manifest.map((entry: any) => ({ source_id: entry.source_id, source_kind: entry.source_kind, trust: entry.trust, reference_key: entry.reference_key })),
      model_safe_context,
    });
    expect(first.document.manifest_schema_version).toBe(CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION);
    expect(first.fingerprint_algorithm).toBe("sha256-canonical-json-v1");
    expect(first.reference_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second.reference_manifest_sha256).toBe(first.reference_manifest_sha256);
    expect(Object.isFrozen(first.document)).toBe(true);
    expect(Object.isFrozen(first.document.entries)).toBe(true);
  });

  it("changes the fingerprint when server-only source provenance changes", () => {
    const first = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest, model_safe_context });
    const changed = createCapaInvestigationActiveAdvisoryReferenceManifest({
      reference_manifest: [{ ...reference_manifest[0], source_id: "INV-2" }, reference_manifest[1]], model_safe_context,
    });
    expect(changed.reference_manifest_sha256).not.toBe(first.reference_manifest_sha256);
  });

  it.each([
    ["duplicate reference", [{ ...reference_manifest[0] }, { ...reference_manifest[0], source_id: "LEDGER-1" }], model_safe_context],
    ["invalid reference", [{ ...reference_manifest[0], reference_key: "BAD" }, reference_manifest[1]], model_safe_context],
    ["empty source", [{ ...reference_manifest[0], source_id: " " }, reference_manifest[1]], model_safe_context],
    ["count mismatch", [reference_manifest[0]], model_safe_context],
    ["trust mismatch", [{ ...reference_manifest[0], trust: "untrusted_human_draft" }, reference_manifest[1]], model_safe_context],
    ["source-kind mismatch", [{ ...reference_manifest[0], source_kind: "ledger_item" }, reference_manifest[1]], model_safe_context],
  ])("rejects %s", (_name, entries, context) => {
    expect(() => validateCapaInvestigationActiveAdvisoryReferenceManifest({
      manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
      workflow_state: "S40",
      entries,
    }, context as never)).toThrow("controlled S40 advisory reference manifest");
  });
});
