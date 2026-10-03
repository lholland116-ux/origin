import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CANDIDATE_CUSTOMER_ID = "cus_from_email";
const EXISTING_CUSTOMER_ID = "cus_already_claimed";

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  supabase: null as unknown as {
    auth: { getUser: ReturnType<typeof vi.fn> };
    from: ReturnType<typeof vi.fn>;
  },
  admin: null as unknown as { from: ReturnType<typeof vi.fn> },
  stripeCustomersList: vi.fn(),
  stripePortalCreate: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

vi.mock("../../lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.admin),
}));

vi.mock("stripe", () => ({
  default: class MockStripe {
    customers = { list: mocks.stripeCustomersList };
    billingPortal = { sessions: { create: mocks.stripePortalCreate } };

    constructor() {}
  },
}));

import { POST } from "../../app/api/stripe/portal/route";

function query(result: QueryResult) {
  const builder = {} as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };

  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

function setup(params: {
  profile?: { plan: string; stripe_customer_id: string | null };
  claimed?: QueryResult;
  current?: QueryResult;
} = {}) {
  const profileQuery = query({
    data: params.profile ?? { plan: "pro", stripe_customer_id: null },
    error: null,
  });

  mocks.supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: { id: USER_ID, email: "owner@example.com" },
        },
        error: null,
      })),
    },
    from: vi.fn(() => profileQuery),
  };

  const claimedQuery = query(
    params.claimed ?? {
      data: { stripe_customer_id: CANDIDATE_CUSTOMER_ID },
      error: null,
    },
  );
  const currentQuery = query(
    params.current ?? {
      data: { stripe_customer_id: EXISTING_CUSTOMER_ID },
      error: null,
    },
  );

  const adminQueries = [claimedQuery, currentQuery];
  mocks.admin = {
    from: vi.fn(() => {
      const next = adminQueries.shift();
      if (!next) throw new Error("Unexpected admin query");
      return next;
    }),
  };

  mocks.stripeCustomersList.mockResolvedValue({
    data: [{ id: CANDIDATE_CUSTOMER_ID }],
  });
  mocks.stripePortalCreate.mockResolvedValue({
    url: "https://billing.stripe.test/session",
  });

  return { profileQuery, claimedQuery, currentQuery };
}

describe("POST /api/stripe/portal profile authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  });

  it("backfills an email-matched customer through the admin client only", async () => {
    const { profileQuery, claimedQuery } = setup();

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://billing.stripe.test/session",
    });
    expect(profileQuery.update).not.toHaveBeenCalled();
    expect(claimedQuery.eq).toHaveBeenCalledWith("id", USER_ID);
    expect(claimedQuery.is).toHaveBeenCalledWith("stripe_customer_id", null);
    expect(mocks.stripePortalCreate).toHaveBeenCalledWith({
      customer: CANDIDATE_CUSTOMER_ID,
      return_url: "https://app.example.com/account",
    });
  });

  it("uses an already-claimed customer when a concurrent backfill wins first", async () => {
    const { currentQuery } = setup({ claimed: { data: null, error: null } });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(currentQuery.select).toHaveBeenCalledWith("stripe_customer_id");
    expect(mocks.stripePortalCreate).toHaveBeenCalledWith({
      customer: EXISTING_CUSTOMER_ID,
      return_url: "https://app.example.com/account",
    });
  });

  it("does not attempt billing lookup or profile mutation for Free users", async () => {
    setup({ profile: { plan: "free", stripe_customer_id: null } });

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.stripeCustomersList).not.toHaveBeenCalled();
    expect(mocks.stripePortalCreate).not.toHaveBeenCalled();
  });
});
