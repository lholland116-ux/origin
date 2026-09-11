import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCapaDevelopmentRuntime,
} from "../../lib/capa/application/capa-development-runtime";
import {
  createCapaProductionRuntime,
} from "../../lib/capa/application/capa-production-runtime";
import {
  SupabaseCapaImplementationReviewDecisionRepository,
} from "../../lib/database/supabase/supabase-capa-implementation-review-decision-repository";
import {
  resolveDevelopmentCapaRequestContext,
} from "../../lib/security/supabase-capa-context";

const USER = "20000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-11T12:00:00.000Z");
const SQL = vi.fn() as unknown as postgres.Sql;

const previousOrganization = process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;
const previousRole = process.env.CAPA_DEVELOPMENT_ROLE_ID;

function context() {
  process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID = ORG;
  process.env.CAPA_DEVELOPMENT_ROLE_ID = "CAPA_APPROVER";
  return resolveDevelopmentCapaRequestContext({
    verified_user_id: USER,
    authenticated_at: "2026-09-11T11:00:00.000Z",
    expires_at_epoch_seconds: 2_000_000_000,
    verified_aal: "aal2",
    verified_reauthenticated_at_epoch_seconds: NOW.getTime() / 1_000,
  }, NOW);
}

afterEach(() => {
  if (previousOrganization === undefined) delete process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;
  else process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID = previousOrganization;
  if (previousRole === undefined) delete process.env.CAPA_DEVELOPMENT_ROLE_ID;
  else process.env.CAPA_DEVELOPMENT_ROLE_ID = previousRole;
});

describe("S90 implementation-review runtime wiring", () => {
  it("provides the projection and transaction-backed decision dependencies in development", () => {
    const runtime = createCapaDevelopmentRuntime({
      environment: "test",
      now: () => NOW,
    });
    const projection = runtime.create_implementation_review_projection_service(context());
    expect(projection.load).toEqual(expect.any(Function));
    expect(runtime.decide_implementation_review_dependencies.capa_repository).toBe(runtime.database);
    expect(runtime.decide_implementation_review_dependencies.review_decision_repository).toEqual(expect.objectContaining({
      saveDecision: expect.any(Function),
      findDecision: expect.any(Function),
      findDecisionInTransaction: expect.any(Function),
    }));
  });

  it("provides Supabase persistence and projection dependencies in production", () => {
    const runtime = createCapaProductionRuntime({
      sql: SQL,
      now: () => NOW,
    });
    const projection = runtime.create_implementation_review_projection_service({} as any);
    expect(projection.load).toEqual(expect.any(Function));
    expect(runtime.decide_implementation_review_dependencies.capa_repository).toBe(runtime.database);
    expect(runtime.decide_implementation_review_dependencies.review_decision_repository)
      .toBeInstanceOf(SupabaseCapaImplementationReviewDecisionRepository);
  });
});
