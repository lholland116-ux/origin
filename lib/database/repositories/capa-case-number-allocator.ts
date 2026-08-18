import type {
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  TransactionContext,
} from "../transactions";

/**
 * Allocates stable, human-readable CAPA case numbers.
 *
 * Allocation must occur inside the same transaction as CAPA aggregate
 * creation so a failed creation does not consume a number.
 */
export interface CapaCaseNumberAllocator {
  allocateNextCaseNumber(
    transaction: TransactionContext,
    organizationId: OrganizationId,
  ): Promise<string>;
}