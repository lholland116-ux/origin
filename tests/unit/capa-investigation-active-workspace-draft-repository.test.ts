import { describe, expect, it } from "vitest";
import type {
  CapaInvestigationActiveWorkspaceDraft,
} from "../../lib/capa/application/capa-investigation-active-workspace-draft-contract";
import type {
  SaveCapaInvestigationActiveWorkspaceDraftInput,
  SaveCapaInvestigationActiveWorkspaceDraftResult,
} from "../../lib/database/repositories/capa-investigation-active-workspace-draft-repository";

describe("S40 investigation-active workspace draft repository contract", () => {
  it("defines case-scoped read and explicit compare-and-swap save results", () => {
    const draft = {} as CapaInvestigationActiveWorkspaceDraft;
    const create: SaveCapaInvestigationActiveWorkspaceDraftInput = { draft, expected_draft_revision: null };
    const update: SaveCapaInvestigationActiveWorkspaceDraftInput = { draft: { ...draft, draft_revision: 2 }, expected_draft_revision: 1 };
    const saved: SaveCapaInvestigationActiveWorkspaceDraftResult = { status: "saved", draft };
    const stale: SaveCapaInvestigationActiveWorkspaceDraftResult = { status: "concurrency_conflict" };

    expect(create.expected_draft_revision).toBeNull();
    expect(update.expected_draft_revision).toBe(1);
    expect(saved.status).toBe("saved");
    expect(stale.status).toBe("concurrency_conflict");
  });
});
