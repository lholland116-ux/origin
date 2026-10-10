import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleExecutionTrigger, signExecutionTrigger } from "@/lib/agent-runtime/execution-trigger";

const ENABLED = process.env.AGENT_EXECUTION_TRIGGER_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.AGENT_EXECUTION_TRIGGER_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";
const TEST_SECRET = "local-only-execution-trigger-secret-material";
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

  it("serializes simultaneous authenticated wake requests through the real PostgreSQL gate", async () => {
    let markFirstWorkerStarted!: () => void;
    const firstWorkerStarted = new Promise<void>((resolve) => { markFirstWorkerStarted = resolve; });
    let releaseFirstWorker!: () => void;
    const firstWorkerRelease = new Promise<void>((resolve) => { releaseFirstWorker = resolve; });
    let workerCalls = 0;

    function dependencies(client: postgres.Sql, claimId: string, runOnce: () => Promise<{
      status: "no_work"; durationMs: number; providerCalls: number;
    }>) {
      return {
        enabled: true,
        secret: TEST_SECRET,
        createClaimId: () => claimId,
        consumeNonce: async (nonceHash: string) => {
          const [row] = await client`SELECT public.consume_agent_execution_trigger_nonce(${nonceHash}) AS consumed`;
          return row!.consumed as boolean;
        },
        acquireInvocation: async (id: string) => {
          const [row] = await client`SELECT * FROM public.acquire_agent_execution_trigger_gate(${id}::uuid)`;
          if (row!.status === "busy") return { status: "busy" as const };
          return { status: "acquired" as const, fencingGeneration: Number(row!.fencing_generation) };
        },
        renewInvocation: async (id: string, generation: number) => {
          const [row] = await client`SELECT public.renew_agent_execution_trigger_gate(${id}::uuid, ${generation}::bigint) AS renewed`;
          return row!.renewed as boolean;
        },
        releaseInvocation: async (id: string, generation: number) => {
          const [row] = await client`SELECT public.release_agent_execution_trigger_gate(${id}::uuid, ${generation}::bigint) AS released`;
          return row!.released as boolean;
        },
        runOnce,
      };
    }

    function request(nonce: string): Request {
      const timestamp = String(Math.floor(Date.now() / 1000));
      return new Request("https://local.test/api/internal/execution-wake", {
        method: "POST",
        headers: {
          "x-lvtchat-timestamp": timestamp,
          "x-lvtchat-nonce": nonce,
          "x-lvtchat-signature": signExecutionTrigger(TEST_SECRET, timestamp, nonce),
        },
      });
    }

    const firstClaimId = randomUUID();
    const first = handleExecutionTrigger(request(randomUUID().replaceAll("-", "")), dependencies(primary!, firstClaimId, async () => {
      workerCalls += 1;
      markFirstWorkerStarted();
      await firstWorkerRelease;
      return { status: "no_work", durationMs: 1, providerCalls: 0 };
    }));
    await firstWorkerStarted;

    const second = await handleExecutionTrigger(
      request(randomUUID().replaceAll("-", "")),
      dependencies(competing!, randomUUID(), async () => {
        workerCalls += 1;
        return { status: "no_work", durationMs: 1, providerCalls: 0 };
      }),
    );
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ status: "busy" });
    expect(workerCalls).toBe(1);

    releaseFirstWorker();
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    expect(workerCalls).toBe(1);
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
