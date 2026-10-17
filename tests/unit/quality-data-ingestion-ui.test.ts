import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("quality-data ingestion UI boundary", () => {
  const client = readFileSync(resolve("app/quality-data/QualityDataIngestionClient.tsx"), "utf8");
  const page = readFileSync(resolve("app/quality-data/page.tsx"), "utf8");

  it("requires authenticated, server-verified ingestion eligibility before enabling upload controls", () => {
    expect(page).toContain("supabase.auth.getUser()");
    expect(page).toContain('redirect("/login")');
    expect(client).toContain('fetch("/api/quality-data/xlsx", { method: "GET", cache: "no-store" })');
    expect(client).toContain('eligibility !== "allowed"');
    expect(client).toContain("Access is checked on the server for every request.");
  });

  it("requires explicit worksheet, field key, type, and map-or-ignore decisions", () => {
    expect(client).toContain("Choose worksheet");
    expect(client).toContain("Load selected headers");
    expect(client).toContain("Canonical field key");
    expect(client).toContain("Select type");
    expect(client).toContain("Map every column");
    expect(client).toContain("No field meaning is inferred.");
    expect(client).toContain("ignored_headers");
  });

  it("previews before submission, prevents duplicate clicks, and preserves one idempotency key for ambiguous retry", () => {
    expect(client).toContain("Validate mapping");
    expect(client).toContain("Submit import");
    expect(client).toContain("response.status === 422");
    expect(client).toContain("setDiagnostics(Array.isArray(body.diagnostics)");
    expect(client).toContain("inFlight.current");
    expect(client).toContain('"Idempotency-Key": idempotencyKey');
    expect(client).toContain("No automatic retry was made.");
    expect(client).toContain("reuse the same idempotency key");
    expect(client).toContain("disabled={busy || eligibility !== \"allowed\"}");
  });

  it("does not let the browser select an organization or request an AI interpretation", () => {
    expect(client).not.toContain("organization_id");
    expect(client).not.toContain("CAPA_DATABASE_URL");
    expect(client).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(client).toContain("No AI interpretation or evidence verification is performed.");
  });
});
