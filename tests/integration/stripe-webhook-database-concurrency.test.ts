import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.STRIPE_WEBHOOK_DATABASE_INTEGRATION_TESTS === "true";
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase("Stripe webhook PostgreSQL concurrency guarantees", () => {
  let sql: ReturnType<typeof postgres>;
  const userId = crypto.randomUUID();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const eventIds = [
    `evt_db_first_${suffix}`,
    `evt_db_newer_${suffix}`,
    `evt_db_older_${suffix}`,
    `evt_db_tie_a_${suffix}`,
    `evt_db_tie_b_${suffix}`,
    `evt_db_retry_${suffix}`,
  ];
  const leaseTokens = Array.from({ length: 8 }, () => crypto.randomUUID());
  let fixtureCreated = false;
  let profileOnlyFixture = false;

  async function acquire(token: string) {
    const [row] = await sql<{ acquired: boolean; fencing_token: string | null }[]>`
      SELECT * FROM public.acquire_stripe_webhook_entitlement_lock(
        ${userId}::uuid, ${token}::uuid, 60
      )
    `;
    return row;
  }

  async function finalize(params: {
    eventId: string;
    created: number;
    status: string | null;
    token: string;
    fencingToken: string;
    trackUpgrade?: boolean;
  }) {
    const [row] = await sql<{ processed: boolean; should_track_upgrade: boolean }[]>`
      SELECT * FROM public.finalize_stripe_webhook_entitlement(
        ${params.eventId}, 'customer.subscription.updated', ${params.created}, 'sub_db_test',
        ${userId}::uuid, 'sub_db_test', 'cus_db_test', ${params.status}, NULL,
        ${params.token}::uuid, ${params.fencingToken}::bigint, ${params.trackUpgrade ?? false}
      )
    `;
    return row;
  }

  beforeAll(async () => {
    const connectionString = process.env.STRIPE_WEBHOOK_TEST_DATABASE_URL;
    if (!connectionString) {
      throw new Error("STRIPE_WEBHOOK_TEST_DATABASE_URL is required when database integration tests are enabled.");
    }
    const databaseUrl = new URL(connectionString);
    if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname)) {
      throw new Error("Stripe webhook database integration tests only allow loopback PostgreSQL URLs.");
    }

    sql = postgres(connectionString, { max: 4, connect_timeout: 5 });
    profileOnlyFixture = process.env.STRIPE_WEBHOOK_TEST_PROFILE_ONLY_FIXTURE === "true";
    if (profileOnlyFixture) {
      await sql`INSERT INTO public.profiles (id) VALUES (${userId}::uuid)`;
    } else {
      await sql`
        INSERT INTO auth.users (id, aud, role, email)
        VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`stripe-webhook-${suffix}@example.test`})
      `;
    }
    fixtureCreated = true;
    await sql`UPDATE public.profiles SET plan = 'free', plan_source = 'manual', lifetime_pro = false WHERE id = ${userId}::uuid`;
  });

  afterAll(async () => {
    if (!sql) return;
    if (fixtureCreated) {
      await sql`DELETE FROM public.stripe_webhook_events WHERE event_id = ANY(${eventIds})`;
      if (profileOnlyFixture) await sql`DELETE FROM public.profiles WHERE id = ${userId}::uuid`;
      else await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
    await sql.end();
  });

  it("allows only one simultaneous profile lease and commits one event/analytics decision", async () => {
    const claims = await Promise.all([acquire(leaseTokens[0]), acquire(leaseTokens[1])]);
    expect(claims.filter((claim) => claim.acquired)).toHaveLength(1);
    const winnerIndex = claims[0].acquired ? 0 : 1;
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = claims[winnerIndex];
    expect(winner.fencing_token).not.toBeNull();

    const committed = await finalize({
      eventId: eventIds[0],
      created: 1_800_000_000,
      status: "active",
      token: leaseTokens[winnerIndex],
      fencingToken: winner.fencing_token!,
      trackUpgrade: true,
    });
    expect(committed).toEqual({ processed: true, should_track_upgrade: true });

    // The losing delivery retries the lease after the first delivery commits,
    // then reaches the durable event-ID uniqueness check.
    const duplicateLease = await acquire(leaseTokens[loserIndex]);
    const duplicate = await finalize({
      eventId: eventIds[0],
      created: 1_800_000_000,
      status: "canceled",
      token: leaseTokens[loserIndex],
      fencingToken: duplicateLease.fencing_token!,
      trackUpgrade: true,
    });
    expect(duplicate).toEqual({ processed: false, should_track_upgrade: false });
    const [profile] = await sql`SELECT plan, subscription_status FROM public.profiles WHERE id = ${userId}::uuid`;
    expect(profile).toEqual({ plan: "pro", subscription_status: "active" });
  });

  it("serializes newer/older and equal-created-second requests without timestamp tie-break claims", async () => {
    const newerLease = await acquire(leaseTokens[3]);
    await finalize({
      eventId: eventIds[1], created: 1_800_000_010, status: "active",
      token: leaseTokens[3], fencingToken: newerLease.fencing_token!,
    });

    const olderLease = await acquire(leaseTokens[4]);
    await finalize({
      eventId: eventIds[2], created: 1_800_000_009, status: "active",
      token: leaseTokens[4], fencingToken: olderLease.fencing_token!,
    });

    const tiedLeaseA = await acquire(leaseTokens[5]);
    await finalize({
      eventId: eventIds[3], created: 1_800_000_011, status: "active",
      token: leaseTokens[5], fencingToken: tiedLeaseA.fencing_token!,
    });
    const tiedLeaseB = await acquire(leaseTokens[6]);
    await finalize({
      eventId: eventIds[4], created: 1_800_000_011, status: "active",
      token: leaseTokens[6], fencingToken: tiedLeaseB.fencing_token!,
    });

    const [profile] = await sql`SELECT plan, subscription_status FROM public.profiles WHERE id = ${userId}::uuid`;
    expect(profile).toEqual({ plan: "pro", subscription_status: "active" });
  });

  it("rolls back an invalid event claim so the same event can retry", async () => {
    const lease = await acquire(leaseTokens[7]);
    await expect(finalize({
      eventId: eventIds[5], created: 1_800_000_012, status: null,
      token: leaseTokens[7], fencingToken: lease.fencing_token!,
    })).rejects.toThrow();

    const [absent] = await sql`SELECT count(*)::int AS count FROM public.stripe_webhook_events WHERE event_id = ${eventIds[5]}`;
    expect(absent.count).toBe(0);
    await sql`SELECT public.release_stripe_webhook_entitlement_lock(${userId}::uuid, ${leaseTokens[7]}::uuid, ${lease.fencing_token!}::bigint)`;

    const retryToken = crypto.randomUUID();
    const retryLease = await acquire(retryToken);
    const retry = await finalize({
      eventId: eventIds[5], created: 1_800_000_012, status: "active",
      token: retryToken, fencingToken: retryLease.fencing_token!,
    });
    expect(retry.processed).toBe(true);
  });
});
