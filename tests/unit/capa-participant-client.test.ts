import { describe, expect, it, vi } from "vitest";
import { fetchCapaInvestigationOwners, parseCapaParticipantDirectory } from "../../app/capa/capa-participant-client";

const USER = "10000000-0000-4000-8000-000000000001";
const CORR = "50000000-0000-4000-8000-000000000001";
const valid = () => ({ purpose: "investigation_owner", participants: [{ user_id: USER, display_label: null }], correlation_id: CORR });

describe("CAPA participant browser client", () => {
  it("strictly parses nullable labels", () => {
    expect(parseCapaParticipantDirectory(valid())).toEqual({ participants: [{ userId: USER, displayLabel: null }], correlationId: CORR });
  });
  it.each([
    { ...valid(), extra: true },
    { ...valid(), participants: [{ user_id: "bad", display_label: null }] },
    { ...valid(), participants: [{ user_id: USER, display_label: null, email: "x@y.test" }] },
    { ...valid(), participants: [{ user_id: USER, display_label: null }, { user_id: USER, display_label: "Duplicate" }] },
  ])("rejects malformed or duplicate directory data", (value) => {
    expect(parseCapaParticipantDirectory(value)).toBeNull();
  });
  it("rejects duplicate UUID identities that differ only by hexadecimal casing", () => {
    const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    const upper = lower.toUpperCase();
    expect(parseCapaParticipantDirectory({
      ...valid(),
      participants: [
        { user_id: lower, display_label: null },
        { user_id: upper, display_label: "Same identity" },
      ],
    })).toBeNull();
  });
  it("uses the exact investigation-owner endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(valid()), { status: 200 }));
    await fetchCapaInvestigationOwners(fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/capa/participants?purpose=investigation_owner", { method: "GET", cache: "no-store" });
  });
  it("fails safely without returning fallback identities", async () => {
    await expect(fetchCapaInvestigationOwners(vi.fn().mockResolvedValue(new Response("{}", { status: 503 }))))
      .rejects.toThrow("could not be loaded");
  });
});
