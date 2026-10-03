import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  adminQueryResult: {
    data: [{ id: "10000000-0000-4000-8000-000000000001" }],
    error: null,
  } as {
    data: unknown;
    error: unknown;
  },
  adminFrom: vi.fn(),
  adminUpdate: vi.fn(),
  adminSelect: vi.fn(),
  adminEq: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mocks.constructEvent };

    constructor() {}
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mocks.adminFrom })),
}));

import { POST } from "../../app/api/stripe/webhook/route";

function request() {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "valid-signature" },
    body: "signed-event-payload",
  });
}

function configureAdminQuery() {
  const query = {
    update: mocks.adminUpdate,
    select: mocks.adminSelect,
    eq: mocks.adminEq,
    then: (
      resolve: (value: typeof mocks.adminQueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(mocks.adminQueryResult).then(resolve, reject),
  };

  mocks.adminFrom.mockReturnValue(query);
  mocks.adminUpdate.mockReturnValue(query);
  mocks.adminSelect.mockReturnValue(query);
  mocks.adminEq.mockReturnValue(query);
}

describe("Stripe entitlement webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "test-secret";
    process.env.STRIPE_WEBHOOK_SECRET = "webhook-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    configureAdminQuery();
  });

  it("rejects an invalid signature before any entitlement update", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("keeps valid subscription transitions on the service-role update path", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          status: "active",
          metadata: { userId: USER_ID },
          items: { data: [{ current_period_end: 1_800_000_000 }] },
        },
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.adminFrom).toHaveBeenCalledWith("profiles");
    expect(mocks.adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "pro",
        plan_source: "stripe",
        lifetime_pro: false,
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_123",
        subscription_status: "active",
      }),
    );
    expect(mocks.adminEq).toHaveBeenCalledWith("id", USER_ID);
  });
});
