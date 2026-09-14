import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const DEFAULT_LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN_DATABASE_INTEGRATION_TESTS =
  process.env.IMAGE_QUOTA_DATABASE_INTEGRATION_TESTS === "true";
const TEST_DATABASE_URL =
  process.env.CAPA_TEST_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;

const USER_ID = randomUUID();
const CONVERSATION_ID = randomUUID();
const ATTEMPT_ID = randomUUID();

function assertLocalDatabaseUrl(connectionString: string): void {
  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("The local image-quota database URL is invalid.");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.port !== "54322" ||
    parsed.pathname.replace(/^\/+/, "") !== "postgres"
  ) {
    throw new Error(
      "Image-quota concurrency tests require the local Supabase postgres database on port 54322.",
    );
  }
}

const describeDatabase = RUN_DATABASE_INTEGRATION_TESTS ? describe : describe.skip;

let adminSql: postgres.Sql | undefined;

describeDatabase("image-generation quota concurrency", () => {
  beforeAll(async () => {
    assertLocalDatabaseUrl(TEST_DATABASE_URL);
    adminSql = postgres(TEST_DATABASE_URL, {
      prepare: false,
      max: 4,
      connect_timeout: 10,
      idle_timeout: 5,
      connection: { application_name: "lvtchat-image-quota-concurrency-test" },
    });

    await adminSql.begin(async (sql) => {
      await sql`
        insert into auth.users (id, aud, role, email)
        values (
          ${USER_ID},
          'authenticated',
          'authenticated',
          ${`${USER_ID}@image-quota-concurrency.test`}
        )
      `;

      await sql`
        insert into public.conversations (id, user_id, title)
        values (${CONVERSATION_ID}, ${USER_ID}, 'Image quota concurrency')
      `;

      await sql`
        insert into public.image_generation_attempts (
          id,
          user_id,
          conversation_id,
          plan_snapshot,
          status,
          reserved_at,
          expires_at,
          provider_started_at,
          completed_at,
          provider,
          model,
          estimated_cost_microusd
        )
        values (
          ${ATTEMPT_ID},
          ${USER_ID},
          ${CONVERSATION_ID},
          'free',
          'succeeded',
          now() - interval '2 minutes',
          now() + interval '13 minutes',
          now() - interval '90 seconds',
          now() - interval '60 seconds',
          'replicate',
          'flux-schnell',
          3000
        )
      `;
    });
  });

  afterAll(async () => {
    if (!adminSql) return;

    await adminSql.begin(async (sql) => {
      await sql`delete from public.conversations where id = ${CONVERSATION_ID}`;
      await sql`delete from auth.users where id = ${USER_ID}`;
    });
    await adminSql.end({ timeout: 5 });
    adminSql = undefined;
  });

  it("allows exactly one of two concurrent reservations to claim the last Free daily slot", async () => {
    const attempts = await Promise.all(
      [0, 1].map(async () => {
        const client = postgres(TEST_DATABASE_URL, {
          prepare: false,
          max: 1,
          connect_timeout: 10,
          idle_timeout: 5,
          connection: { application_name: "lvtchat-image-quota-race" },
        });

        try {
          const result = await client.begin(async (sql) => {
            await sql.unsafe("set local role authenticated");
            await sql`select set_config('request.jwt.claim.sub', ${USER_ID}, true)`;
            return sql`
              select *
              from public.reserve_image_generation_quota(${CONVERSATION_ID})
            `;
          });

          return { status: "succeeded" as const, result };
        } catch (error) {
          return {
            status: "rejected" as const,
            message: error instanceof Error ? error.message : String(error),
          };
        } finally {
          await client.end({ timeout: 5 });
        }
      }),
    );

    expect(attempts.filter((attempt) => attempt.status === "succeeded")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(
      attempts.find((attempt) => attempt.status === "rejected")?.message,
    ).toContain("IMAGE_DAILY_LIMIT_REACHED");

    const rows = await adminSql!`
      select status
      from public.image_generation_attempts
      where user_id = ${USER_ID}
      order by reserved_at, id
    `;

    expect(rows.map((row) => row.status)).toEqual(["succeeded", "reserved"]);
    expect(rows).toHaveLength(2);
  });
});
