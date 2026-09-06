import type {
  CapaEvidenceAssumptionLedgerItem,
} from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import {
  addLedgerItem,
  updateLedgerItem,
  type RootCauseLedgerDraft,
} from "./capa-root-cause-draft";

export type CapaLedgerItemEditSession = Readonly<{
  readonly itemId: string;
  readonly mode: "existing" | "new";
  readonly draft: CapaEvidenceAssumptionLedgerItem;
}>;

export function beginCapaLedgerItemEditSession(
  item: CapaEvidenceAssumptionLedgerItem,
  mode: "existing" | "new",
): CapaLedgerItemEditSession {
  return Object.freeze({
    itemId: item.item_id,
    mode,
    draft: item,
  });
}

export function patchCapaLedgerItemEditSession(
  session: CapaLedgerItemEditSession,
  itemId: string,
  patch: Partial<CapaEvidenceAssumptionLedgerItem>,
): CapaLedgerItemEditSession {
  if (session.itemId !== itemId) return session;

  return Object.freeze({
    ...session,
    draft: Object.freeze({
      ...session.draft,
      ...patch,
      item_id: session.draft.item_id,
      information_class: session.draft.information_class,
    }),
  });
}

export function commitCapaLedgerItemEditSession(
  ledger: RootCauseLedgerDraft,
  session: CapaLedgerItemEditSession,
  currentUserId: string,
  now = new Date().toISOString(),
): RootCauseLedgerDraft {
  const withItem =
    session.mode === "new"
      ? addLedgerItem(ledger, session.draft)
      : ledger;

  return updateLedgerItem(
    withItem,
    session.itemId,
    session.draft,
    currentUserId,
    now,
  );
}
