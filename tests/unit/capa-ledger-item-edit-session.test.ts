import { describe, expect, it } from "vitest";
import {
  beginCapaLedgerItemEditSession,
  commitCapaLedgerItemEditSession,
  patchCapaLedgerItemEditSession,
} from "../../app/capa/capa-ledger-item-edit-session";
import {
  addLedgerItem,
  createInitialLedgerDraft,
  createLedgerItem,
} from "../../app/capa/capa-root-cause-draft";

const USER =
  "30000000-0000-4000-8000-000000000001";

const NOW =
  "2026-09-06T12:00:00.000Z";

describe("S40 Ledger-item edit session", () => {
  it("keeps several existing-item changes local until explicit commit", () => {
    const original =
      createLedgerItem(
        "missing_information",
        "LED-1",
      );

    const ledger =
      addLedgerItem(
        createInitialLedgerDraft(),
        original,
      );

    let session =
      beginCapaLedgerItemEditSession(
        original,
        "existing",
      );

    session =
      patchCapaLedgerItemEditSession(
        session,
        "LED-1",
        { gap_status: "resolved" },
      );

    session =
      patchCapaLedgerItemEditSession(
        session,
        "LED-1",
        { critical_to_conclusion: true },
      );

    session =
      patchCapaLedgerItemEditSession(
        session,
        "LED-1",
        { target_date: "2026-09-30" },
      );

    session =
      patchCapaLedgerItemEditSession(
        session,
        "LED-1",
        {
          supporting_item_ids:
            Object.freeze([
              "LED-2",
              "E2E-PERSIST",
            ]),
        },
      );

    expect(ledger.items[0]).toMatchObject({
      gap_status: "open",
      critical_to_conclusion: false,
      target_date: null,
      supporting_item_ids: [],
    });

    const committed =
      commitCapaLedgerItemEditSession(
        ledger,
        session,
        USER,
        NOW,
      );

    expect(committed.items).toHaveLength(1);

    expect(committed.items[0]).toMatchObject({
      item_id: "LED-1",
      gap_status: "resolved",
      critical_to_conclusion: true,
      target_date: "2026-09-30",
      supporting_item_ids: [
        "LED-2",
        "E2E-PERSIST",
      ],
      human_disposition: {
        user_id: USER,
        disposition_at: NOW,
      },
    });
  });

  it("keeps a new human Ledger item absent until explicit commit", () => {
    const ledger =
      createInitialLedgerDraft();

    const item =
      createLedgerItem(
        "missing_information",
        "LED-NEW",
      );

    let session =
      beginCapaLedgerItemEditSession(
        item,
        "new",
      );

    session =
      patchCapaLedgerItemEditSession(
        session,
        "LED-NEW",
        {
          statement:
            "Human-created browser qualification gap.",
          target_date:
            "2026-10-01",
        },
      );

    expect(ledger.items).toHaveLength(0);

    const committed =
      commitCapaLedgerItemEditSession(
        ledger,
        session,
        USER,
        NOW,
      );

    expect(committed.items).toHaveLength(1);

    expect(committed.items[0]).toMatchObject({
      item_id: "LED-NEW",
      statement:
        "Human-created browser qualification gap.",
      target_date:
        "2026-10-01",
      provenance: {
        source_type: "human",
      },
    });
  });

  it("does not patch another Ledger item through the active session", () => {
    const item =
      createLedgerItem(
        "missing_information",
        "LED-1",
      );

    const session =
      beginCapaLedgerItemEditSession(
        item,
        "existing",
      );

    const unchanged =
      patchCapaLedgerItemEditSession(
        session,
        "LED-2",
        {
          target_date:
            "2026-09-30",
        },
      );

    expect(unchanged).toBe(session);
  });

  it("stamps resolved human disposition at commit", () => {
    const original =
      createLedgerItem(
        "missing_information",
        "LED-1",
      );

    const ledger =
      addLedgerItem(
        createInitialLedgerDraft(),
        original,
      );

    const session =
      patchCapaLedgerItemEditSession(
        beginCapaLedgerItemEditSession(
          original,
          "existing",
        ),
        "LED-1",
        {
          gap_status: "resolved",
          human_disposition: {
            user_id: USER,
            disposition_at:
              "2026-09-06T11:00:00.000Z",
            rationale:
              "Executed records were reconciled.",
          },
        },
      );

    const committed =
      commitCapaLedgerItemEditSession(
        ledger,
        session,
        USER,
        NOW,
      );

    expect(
      committed.items[0]?.human_disposition,
    ).toEqual({
      user_id: USER,
      disposition_at: NOW,
      rationale:
        "Executed records were reconciled.",
    });
  });
});
