import type { UserId } from "../domain/capa-types";

export const CAPA_INVESTIGATION_OWNER_ROLE_IDS = Object.freeze([
  "CAPA_OWNER",
  "CAPA_CONTRIBUTOR",
] as const);

export interface CapaInvestigationOwnerParticipant {
  readonly user_id: UserId;
  readonly display_label: null;
}

export const CAPA_INVESTIGATION_OWNER_PURPOSE =
  "investigation_owner" as const;
