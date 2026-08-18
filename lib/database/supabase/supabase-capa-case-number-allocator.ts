import type postgres from "postgres";

import type {
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaCaseNumberAllocator,
} from "../repositories/capa-case-number-allocator";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

/**
 * Durable organization-scoped CAPA case-number allocator.
 *
 * Numbers use the controlled format CAPA-000001 through CAPA-999999.
 * Allocation is performed through the active PostgreSQL transaction so
 * rollback, organization isolation and concurrent serialization are
 * enforced by the database.
 */

const MAXIMUM_CASE_NUMBER = 999_999;

const CASE_NUMBER_PREFIX = "CAPA-";

const CASE_NUMBER_WIDTH = 6;

interface AllocationRow extends postgres.Row {
  readonly last_allocated_number:
    | number
    | string;
}

export class CapaCaseNumberAllocationError
  extends Error {
  constructor(
    message =
      "The CAPA case number could not be allocated.",
  ) {
    super(message);
    this.name =
      "CapaCaseNumberAllocationError";
  }
}

export class CapaCaseNumberExhaustedError
  extends CapaCaseNumberAllocationError {
  constructor() {
    super(
      "The organization has exhausted its available CAPA case numbers.",
    );

    this.name =
      "CapaCaseNumberExhaustedError";
  }
}

function parseAllocatedNumber(
  value: number | string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAXIMUM_CASE_NUMBER
  ) {
    throw new CapaCaseNumberAllocationError(
      "The CAPA case-number allocator returned an invalid value.",
    );
  }

  return parsed;
}

function formatCaseNumber(
  allocatedNumber: number,
): string {
  return `${CASE_NUMBER_PREFIX}${String(
    allocatedNumber,
  ).padStart(CASE_NUMBER_WIDTH, "0")}`;
}

/**
 * PostgreSQL implementation of the CAPA case-number allocator.
 *
 * The INSERT ... ON CONFLICT statement obtains the organization counter
 * row lock and advances the value atomically. Different organizations
 * retain independent sequences.
 *
 * The WHERE condition prevents the counter from exceeding CAPA-999999.
 * PostgreSQL returns no row when that organization has exhausted its
 * controlled range.
 */
export class SupabaseCapaCaseNumberAllocator
  implements CapaCaseNumberAllocator
{
  async allocateNextCaseNumber(
    transaction: TransactionContext,
    organizationId: OrganizationId,
  ): Promise<string> {
    const sql =
      requireSupabaseTransaction(
        transaction,
      );

    const rows =
      await sql<AllocationRow[]>`
        insert into
          public.capa_case_number_counters
            as counter (
              organization_id,
              last_allocated_number
            )
        values (
          ${organizationId},
          1
        )
        on conflict (organization_id)
        do update
        set
          last_allocated_number =
            counter.last_allocated_number + 1,
          updated_at =
            statement_timestamp()
        where
          counter.last_allocated_number <
            ${MAXIMUM_CASE_NUMBER}
        returning
          counter.last_allocated_number
      `;

    if (rows.length === 0) {
      throw new CapaCaseNumberExhaustedError();
    }

    if (
      rows.length !== 1 ||
      rows[0] === undefined
    ) {
      throw new CapaCaseNumberAllocationError(
        "The CAPA case-number allocator returned an unexpected result.",
      );
    }

    const allocatedNumber =
      parseAllocatedNumber(
        rows[0].last_allocated_number,
      );

    return formatCaseNumber(
      allocatedNumber,
    );
  }
}