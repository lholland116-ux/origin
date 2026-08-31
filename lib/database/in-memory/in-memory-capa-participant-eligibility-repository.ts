import type { OrganizationId, UserId } from "../../capa/domain/capa-types";
import type { CapaParticipantEligibilityRepository } from "../repositories/capa-participant-eligibility-repository";

/** Development-only adapter. Production eligibility is always database-backed. */
export class InMemoryCapaParticipantEligibilityRepository
implements CapaParticipantEligibilityRepository {
  async listEligibleInvestigationOwners(organizationId: OrganizationId) {
    return Object.freeze([Object.freeze({
      user_id: organizationId as unknown as UserId,
      display_label: null,
    })]);
  }

  async findIneligibleInvestigationOwnerIds(
    _transaction: unknown,
    _organizationId: OrganizationId,
    ownerUserIds: readonly UserId[],
  ) {
    const developmentUserId = _organizationId as unknown as UserId;
    return Object.freeze([...new Set(ownerUserIds)]
      .filter((ownerUserId) => ownerUserId !== developmentUserId));
  }
}
