import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.AGENT_EXECUTION_TRIGGER_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.AGENT_EXECUTION_TRIGGER_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;

function requireIsolatedDatabase(connectionString: string): void {
  const parsed = new URL(connectionString);
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.port === "57242" && parsed.pathname === "/postgres")) {
    throw new Error("Execution trigger database tests require isolated loopback PostgreSQL port 57242.");
  }
}

describeDatabase("execution trigger replay and overlap controls (isolated PostgreSQL only)", () => {
  let primary: postgres.Sql | undefined;
  let competing: postgres.Sql | undefined;

  beforeAll(async () => {
    requireIsolatedDatabase(DATABASE_URL);
    primary = postgres(DATABASE_URL, { max: 1, connect_timeout: 5 });
    competing = postgres(DATABASE_URL, { max: 1, connect_timeout: 5 });
    await primary`SELECT 1`;
  });

  afterAll(async () => {
    await Promise.all([primary?.end({ timeout: 2 }), competing?.end({ timeout: 2 })]);
  });

  it("consumes one nonce atomically across independent database connections", async () => {
    const nonce = createHash("sha256").update(randomUUID()).digest("hex");
    const [left, right] = await Promise.all([
      primary!`SELECT public.consume_agent_execution_trigger_nonce(${nonce}) AS consumed`,
      competing!`SELECT public.consume_agent_execution_trigger_nonce(${nonce}) AS consumed`,
    ]);
    expect([left[0]!.consumed, right[0]!.consumed].sort()).toEqual([false, true]);
  });

  it("admits only one overlapping trigger and fences stale gate release", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const [left, right] = await Promise.all([
      primary!`SELECT * FROM public.acquire_agent_execution_trigger_gate(${firstId}::uuid)`,
      competing!`SELECT * FROM public.acquire_agent_execution_trigger_gate(${secondId}::uuid)`,
    ]);
    const winners = [left[0]!, right[0]!].filter((item) => item.status === "acquired");
    const losers = [left[0]!, right[0]!].filter((item) => item.status === "busy");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winningId = left[0]!.status === "acquired" ? firstId : secondId;
    const losingId = left[0]!.status === "busy" ? firstId : secondId;
    const generation = Number(winners[0]!.fencing_generation);
    expect(await primary!`SELECT public.release_agent_execution_trigger_gate(${losingId}::uuid, ${generation}) AS released`)
      .toMatchObject([{ released: false }]);
    expect(await primary!`SELECT public.release_agent_execution_trigger_gate(${winningId}::uuid, ${generation}) AS released`)
      .toMatchObject([{ released: true }]);
  });

  it("allows a new gate owner after lease expiry while rejecting the stale owner", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const [first] = await primary!`SELECT * FROM public.acquire_agent_execution_trigger_gate(${firstId}::uuid)`;
    expect(first!.status).toBe("acquired");
    await primary!`UPDATE public.agent_execution_trigger_gate SET lease_until = clock_timestamp() - interval '1 second' WHERE singleton`;
    const [second] = await competing!`SELECT * FROM public.acquire_agent_execution_trigger_gate(${secondId}::uuid)`;
    expect(second!.status).toBe("acquired");
    expect(Number(second!.fencing_generation)).toBe(Number(first!.fencing_generation) + 1);
    expect(await primary!`SELECT public.renew_agent_execution_trigger_gate(
      ${firstId}::uuid, ${first!.fencing_generation}::bigint) AS renewed`).toMatchObject([{ renewed: false }]);
    expect(await competing!`SELECT public.renew_agent_execution_trigger_gate(
      ${secondId}::uuid, ${second!.fencing_generation}::bigint) AS renewed`).toMatchObject([{ renewed: true }]);
    expect(await primary!`SELECT public.release_agent_execution_trigger_gate(
      ${firstId}::uuid, ${first!.fencing_generation}::bigint) AS released`).toMatchObject([{ released: false }]);
    expect(await competing!`SELECT public.release_agent_execution_trigger_gate(
      ${secondId}::uuid, ${second!.fencing_generation}::bigint) AS released`).toMatchObject([{ released: true }]);
  });
});
