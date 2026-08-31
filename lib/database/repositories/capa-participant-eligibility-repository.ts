import type { OrganizationId, UserId } from "../../capa/domain/capa-types";
import type { CapaInvestigationOwnerParticipant } from "../../capa/participants/capa-investigation-owner-eligibility";
import type { TransactionContext } from "../transactions";

export interface CapaParticipantEligibilityRepository {
  listEligibleInvestigationOwners(
    organizationId: OrganizationId,
    trustedNow: Date,
  ): Promise<readonly CapaInvestigationOwnerParticipant[]>;

  findIneligibleInvestigationOwnerIds(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    ownerUserIds: readonly UserId[],
    trustedNow: Date,
  ): Promise<readonly UserId[]>;
}
