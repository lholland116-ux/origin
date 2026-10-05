import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSubscription: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  events: new Set<string>(),
  lockHeld: false,
  fence: 0,
  finalizer: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mocks.constructEvent };
    subscriptions = { retrieve: mocks.retrieveSubscription };
    constructor() {}
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { POST } from "../../app/api/stripe/webhook/route";

function request() {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body: "signed-event-payload",
    headers: { "stripe-signature": "valid-signature" },
  });
}

function subscription(status = "active") {
  return {
    id: "sub_123",
    customer: "cus_123",
    status,
    metadata: { userId: USER_ID },
    items: { data: [{ current_period_end: 1_800_000_000 }] },
  };
}

function stripeEvent(params: {
  id?: string;
  type?: string;
  created?: number;
  status?: string;
  session?: boolean;
} = {}) {
  const {
    id = "evt_first",
    type = params.session
      ? "checkout.session.completed"
      : "customer.subscription.updated",
    created = 1_800_000_000,
    status = "active",
    session = false,
  } = params;
  return {
    id,
    type,
    created,
    livemode: false,
    data: {
      object: session
        ? {
            id: "cs_123",
            mode: "subscription",
            metadata: { userId: USER_ID },
            customer: "cus_123",
            subscription: "sub_123",
          }
        : {
            id: "sub_123",
            customer: "cus_123",
            status,
            metadata: { userId: USER_ID },
          },
    },
  };
}

describe("Stripe entitlement webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.clear();
    mocks.lockHeld = false;
    mocks.fence = 0;
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.STRIPE_WEBHOOK_SECRET = "webhook-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GA_API_SECRET;

    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: mocks.maybeSingle,
    };
    mocks.from.mockReturnValue(query);
    mocks.maybeSingle.mockResolvedValue({ data: { id: USER_ID }, error: null });
    mocks.retrieveSubscription.mockResolvedValue(subscription());
    mocks.finalizer.mockImplementation(async (args: Record<string, unknown>) => {
      const eventId = String(args.p_event_id);
      if (mocks.events.has(eventId)) {
        mocks.lockHeld = false;
        return { data: [{ processed: false, should_track_upgrade: false }], error: null };
      }
      mocks.events.add(eventId);
      mocks.lockHeld = false;
      return {
        data: [{
          processed: true,
          should_track_upgrade: args.p_track_upgrade === true && args.p_subscription_status === "active",
        }],
        error: null,
      };
    });
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "acquire_stripe_webhook_entitlement_lock") {
        if (mocks.lockHeld) return { data: [{ acquired: false, fencing_token: null }], error: null };
        mocks.lockHeld = true;
        mocks.fence += 1;
        return { data: [{ acquired: true, fencing_token: mocks.fence }], error: null };
      }
      if (name === "finalize_stripe_webhook_entitlement") return mocks.finalizer(args);
      if (name === "release_stripe_webhook_entitlement_lock") {
        mocks.lockHeld = false;
        return { data: true, error: null };
      }
      if (name === "record_stripe_webhook_event") {
        const eventId = String(args.p_event_id);
        if (mocks.events.has(eventId)) return { data: false, error: null };
        mocks.events.add(eventId);
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
  });

  it("verifies the untouched request body before making database calls", async () => {
    mocks.constructEvent.mockReturnValue({ ...stripeEvent(), type: "customer.updated", data: { object: {} } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.constructEvent).toHaveBeenCalledWith("signed-event-payload", "valid-signature", "webhook-secret");
    expect(mocks.rpc).toHaveBeenCalledWith("record_stripe_webhook_event", expect.any(Object));
  });

  it("rejects a missing signature before verification", async () => {
    const unsigned = new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "payload" });
    expect((await POST(unsigned)).status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("rejects live/test mode mismatch", async () => {
    mocks.constructEvent.mockReturnValue({ ...stripeEvent(), livemode: true });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
  });

  it("commits a first delivery through the atomic entitlement RPC", async () => {
    mocks.constructEvent.mockReturnValue(stripeEvent());
    expect((await POST(request())).status).toBe(200);
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub_123");
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_stripe_webhook_entitlement", expect.objectContaining({
      p_event_id: "evt_first",
      p_event_created: 1_800_000_000,
      p_profile_id: USER_ID,
      p_subscription_status: "active",
      p_lease_token: expect.any(String),
      p_fencing_token: 1,
    }));
  });

  it("ignores exact duplicate delivery without repeating analytics", async () => {
    process.env.GA_MEASUREMENT_ID = "G-test";
    process.env.GA_API_SECRET = "ga-test-secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    mocks.constructEvent.mockReturnValue(stripeEvent({ session: true }));

    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.finalizer).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("serializes simultaneous duplicate deliveries and tracks analytics at most once", async () => {
    process.env.GA_MEASUREMENT_ID = "G-test";
    process.env.GA_API_SECRET = "ga-test-secret";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    mocks.constructEvent.mockReturnValue(stripeEvent({ session: true }));
    const [first, second] = await Promise.all([POST(request()), POST(request())]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.finalizer).toHaveBeenCalledTimes(2);
    expect(mocks.events.size).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("uses the fresh Stripe state for newer-then-older and same-second events", async () => {
    mocks.retrieveSubscription.mockResolvedValue(subscription("active"));
    mocks.constructEvent
      .mockReturnValueOnce(stripeEvent({ id: "evt_new", created: 1_800_000_001, status: "active" }))
      .mockReturnValueOnce(stripeEvent({ id: "evt_old", created: 1_800_000_000, status: "canceled" }))
      .mockReturnValueOnce(stripeEvent({ id: "evt_tie_a", created: 1_800_000_002, status: "canceled" }))
      .mockReturnValueOnce(stripeEvent({ id: "evt_tie_b", created: 1_800_000_002, status: "active" }));

    for (let i = 0; i < 4; i += 1) expect((await POST(request())).status).toBe(200);
    const finalizerCalls = mocks.finalizer.mock.calls.map(([args]) => args as Record<string, unknown>);
    expect(finalizerCalls.map((args) => args.p_event_created)).toEqual([
      1_800_000_001, 1_800_000_000, 1_800_000_002, 1_800_000_002,
    ]);
    expect(finalizerCalls.every((args) => args.p_subscription_status === "active")).toBe(true);
  });

  it("handles an older event racing a newer event by serializing and rereading current state", async () => {
    mocks.constructEvent
      .mockReturnValueOnce(stripeEvent({ id: "evt_old_race", created: 1_800_000_010, status: "active" }))
      .mockReturnValueOnce(stripeEvent({ id: "evt_new_race", created: 1_800_000_011, status: "canceled" }));
    // Both handler executions read the canonical current state under the DB
    // lease, rather than applying the potentially stale event snapshots.
    mocks.retrieveSubscription.mockResolvedValue(subscription("canceled"));

    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.retrieveSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.finalizer.mock.calls.map(([args]) => (args as Record<string, unknown>).p_subscription_status))
      .toEqual(["canceled", "canceled"]);
  });

  it("keeps a failed atomic finalize retryable and does not record it as processed", async () => {
    mocks.constructEvent.mockReturnValue(stripeEvent({ id: "evt_retry" }));
    mocks.finalizer
      .mockResolvedValueOnce({ data: null, error: { message: "transaction aborted" } })
      .mockImplementationOnce(async (args: Record<string, unknown>) => {
        mocks.events.add(String(args.p_event_id));
        mocks.lockHeld = false;
        return { data: [{ processed: true, should_track_upgrade: false }], error: null };
      });

    expect((await POST(request())).status).toBe(500);
    expect(mocks.events.has("evt_retry")).toBe(false);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.events.has("evt_retry")).toBe(true);
  });
});
