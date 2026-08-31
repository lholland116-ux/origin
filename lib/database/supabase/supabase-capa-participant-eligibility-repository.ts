import type postgres from "postgres";
import type { OrganizationId, UserId } from "../../capa/domain/capa-types";
import type { CapaInvestigationOwnerParticipant } from "../../capa/participants/capa-investigation-owner-eligibility";
import type { CapaParticipantEligibilityRepository } from "../repositories/capa-participant-eligibility-repository";
import type { TransactionContext } from "../transactions";
import { requireSupabaseTransaction } from "./supabase-transactions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ParticipantRow extends postgres.Row { readonly user_id: string }

export class CapaParticipantEligibilityDataError extends Error {
  constructor() {
    super("The CAPA participant eligibility data is invalid.");
    this.name = "CapaParticipantEligibilityDataError";
  }
}

function validatedParticipants(rows: readonly ParticipantRow[]): readonly CapaInvestigationOwnerParticipant[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.user_id !== "string" || !UUID_PATTERN.test(row.user_id)) {
      throw new CapaParticipantEligibilityDataError();
    }
    ids.add(row.user_id);
  }
  return Object.freeze([...ids].sort().map((userId) => Object.freeze({
    user_id: userId as UserId,
    display_label: null,
  })));
}

export class SupabaseCapaParticipantEligibilityRepository
implements CapaParticipantEligibilityRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async listEligibleInvestigationOwners(organizationId: OrganizationId, trustedNow: Date) {
    const at = trustedNow.toISOString();
    const rows = await this.sql<ParticipantRow[]>`
      select membership.user_id
      from public.capa_organization_memberships as membership
      join public.capa_organizations as organization
        on organization.organization_id = membership.organization_id
      join public.capa_role_assignments as assignment
        on assignment.organization_id = membership.organization_id
       and assignment.membership_id = membership.membership_id
       and assignment.user_id = membership.user_id
      join public.capa_roles as role on role.role_id = assignment.role_id
      where membership.organization_id = ${organizationId}
        and organization.status = 'active'
        and organization.effective_at <= ${at}
        and (organization.superseded_at is null or organization.superseded_at > ${at})
        and membership.status = 'active'
        and membership.effective_at <= ${at}
        and (membership.expires_at is null or membership.expires_at > ${at})
        and assignment.status = 'active'
        and assignment.scope_code = 'ORGANIZATION'
        and assignment.scope_resource_type is null
        and assignment.scope_resource_id is null
        and assignment.effective_at <= ${at}
        and (assignment.expires_at is null or assignment.expires_at > ${at})
        and assignment.role_id in ('CAPA_OWNER', 'CAPA_CONTRIBUTOR')
        and role.status = 'active'
      order by membership.user_id
    `;
    return validatedParticipants(rows);
  }

  async findIneligibleInvestigationOwnerIds(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    ownerUserIds: readonly UserId[],
    trustedNow: Date,
  ): Promise<readonly UserId[]> {
    const unique = [...new Set(ownerUserIds)].sort();
    if (unique.length === 0) return Object.freeze([]);
    if (unique.some((id) => !UUID_PATTERN.test(id))) throw new CapaParticipantEligibilityDataError();
    const sql = requireSupabaseTransaction(transaction);
    const at = trustedNow.toISOString();
    const rows = await sql<ParticipantRow[]>`
      select membership.user_id
      from public.capa_organization_memberships as membership
      join public.capa_organizations as organization
        on organization.organization_id = membership.organization_id
      join public.capa_role_assignments as assignment
        on assignment.organization_id = membership.organization_id
       and assignment.membership_id = membership.membership_id
       and assignment.user_id = membership.user_id
      join public.capa_roles as role on role.role_id = assignment.role_id
      where membership.organization_id = ${organizationId}
        and membership.user_id = any(${unique})
        and organization.status = 'active'
        and organization.effective_at <= ${at}
        and (organization.superseded_at is null or organization.superseded_at > ${at})
        and membership.status = 'active'
        and membership.effective_at <= ${at}
        and (membership.expires_at is null or membership.expires_at > ${at})
        and assignment.status = 'active'
        and assignment.scope_code = 'ORGANIZATION'
        and assignment.scope_resource_type is null
        and assignment.scope_resource_id is null
        and assignment.effective_at <= ${at}
        and (assignment.expires_at is null or assignment.expires_at > ${at})
        and assignment.role_id in ('CAPA_OWNER', 'CAPA_CONTRIBUTOR')
        and role.status = 'active'
      order by membership.user_id, assignment.role_assignment_id
      for share of organization, membership, assignment, role
    `;
    const eligible = new Set(validatedParticipants(rows).map((item) => item.user_id));
    return Object.freeze(unique.filter((id) => !eligible.has(id)) as UserId[]);
  }
}
