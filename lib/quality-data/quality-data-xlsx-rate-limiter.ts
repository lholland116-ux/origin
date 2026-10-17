import { randomUUID } from "node:crypto";

import { createAdminClient } from "../supabase/admin";
import { type QualityDataXlsxApiAction, type QualityDataXlsxApiParseSlotResult, type QualityDataXlsxApiRateLimiter, type QualityDataXlsxApiRateLimitResult } from "./quality-data-xlsx-api";

/**
 * Production request counts and parse-slot leases are atomic and shared
 * through Supabase/PostgreSQL, rather than process-local counters.
 */
export class SupabaseQualityDataXlsxApiRateLimiter implements QualityDataXlsxApiRateLimiter {
  async consume(userId: string, action: QualityDataXlsxApiAction): Promise<QualityDataXlsxApiRateLimitResult> {
    try {
      const { data, error } = await createAdminClient().rpc("consume_quality_data_xlsx_api_rate_limit", {
        p_user_id: userId,
        p_action: action,
      });
      if (error || typeof data !== "boolean") return "unavailable";
      return data ? "allowed" : "limited";
    } catch {
      return "unavailable";
    }
  }

  async acquireParseSlot(userId: string): Promise<QualityDataXlsxApiParseSlotResult> {
    const leaseId = randomUUID();
    try {
      const { data, error } = await createAdminClient().rpc("acquire_quality_data_xlsx_api_parse_slot", {
        p_lease_id: leaseId,
        p_user_id: userId,
      });
      if (error || typeof data !== "boolean") return "unavailable";
      if (!data) return "busy";
      return { release: () => this.releaseParseSlot(leaseId) };
    } catch {
      return "unavailable";
    }
  }

  private async releaseParseSlot(leaseId: string): Promise<void> {
    try {
      await createAdminClient().rpc("release_quality_data_xlsx_api_parse_slot", { p_lease_id: leaseId });
    } catch {
      // The database lease is short-lived and expires if release cannot reach Supabase.
    }
  }
}
