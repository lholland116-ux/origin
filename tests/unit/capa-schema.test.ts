import { describe, expect, it } from "vitest";

import {
  ActorReferenceSchema,
  CAPA_INPUT_LIMITS,
  CapaStateIdSchema,
  ControlledCodeSchema,
  CreateCapaDraftRequestSchema,
  IsoDateTimeSchema,
  OpaqueIdSchema,
  PositiveVersionSchema,
  RequestTraceSchema,
} from "../../lib/capa/validation/capa-schema";

/**
 * Requirements-traced runtime validation tests.
 *
 * Traceability:
 * URS-ACC-001 through URS-ACC-010
 * URS-CASE-001 through URS-CASE-012
 * DM-COM-001 through DM-COM-009
 * WFR-001 through WFR-013
 */

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_UUID = "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

describe("CAPA primitive schemas", () => {
  it("accepts approved workflow states", () => {
    expect(CapaStateIdSchema.parse("S00")).toBe("S00");
    expect(CapaStateIdSchema.parse("S150")).toBe("S150");
  });

  it("rejects unapproved workflow states", () => {
    expect(() => CapaStateIdSchema.parse("DRAFT")).toThrow();
    expect(() => CapaStateIdSchema.parse("S160")).toThrow();
  });

  it("accepts valid UUID identifiers", () => {
    expect(OpaqueIdSchema.parse(VALID_UUID)).toBe(VALID_UUID);
  });

  it("rejects malformed identifiers", () => {
    expect(() => OpaqueIdSchema.parse("case-123")).toThrow();
  });

  it("accepts ISO 8601 timestamps with an offset", () => {
    expect(
      IsoDateTimeSchema.parse("2026-08-11T14:30:00.000Z"),
    ).toBe("2026-08-11T14:30:00.000Z");
  });

  it("rejects timestamps without timezone information", () => {
    expect(() =>
      IsoDateTimeSchema.parse("2026-08-11T14:30:00"),
    ).toThrow();
  });

  it("accepts only positive integer versions", () => {
    expect(PositiveVersionSchema.parse(1)).toBe(1);
    expect(() => PositiveVersionSchema.parse(0)).toThrow();
    expect(() => PositiveVersionSchema.parse(1.5)).toThrow();
  });

  it("trims and accepts controlled codes", () => {
    expect(ControlledCodeSchema.parse("  SOURCE.CUSTOMER  ")).toBe(
      "SOURCE.CUSTOMER",
    );
  });

  it("rejects unsupported controlled-code characters", () => {
    expect(() =>
      ControlledCodeSchema.parse("SOURCE CUSTOMER"),
    ).toThrow();

    expect(() =>
      ControlledCodeSchema.parse("<script>"),
    ).toThrow();
  });
});

describe("actor and request trace schemas", () => {
  it("accepts an attributable human actor", () => {
    expect(
      ActorReferenceSchema.parse({
        actor_type: "human",
        actor_id: VALID_UUID,
      }),
    ).toEqual({
      actor_type: "human",
      actor_id: VALID_UUID,
    });
  });

  it("accepts a versioned service actor", () => {
    expect(
      ActorReferenceSchema.parse({
        actor_type: "service",
        actor_id: VALID_UUID,
        actor_version: "capa-service-1.0.0",
      }),
    ).toEqual({
      actor_type: "service",
      actor_id: VALID_UUID,
      actor_version: "capa-service-1.0.0",
    });
  });

  it("rejects unknown actor fields", () => {
    expect(() =>
      ActorReferenceSchema.parse({
        actor_type: "human",
        actor_id: VALID_UUID,
        organization_id: SECOND_UUID,
      }),
    ).toThrow();
  });

  it("accepts request and correlation identifiers", () => {
    expect(
      RequestTraceSchema.parse({
        request_id: VALID_UUID,
        correlation_id: SECOND_UUID,
        idempotency_key: "create-capa-001",
      }),
    ).toEqual({
      request_id: VALID_UUID,
      correlation_id: SECOND_UUID,
      idempotency_key: "create-capa-001",
    });
  });

  it("rejects an invalid request identifier", () => {
    expect(() =>
      RequestTraceSchema.parse({
        request_id: "request-1",
        correlation_id: SECOND_UUID,
      }),
    ).toThrow();
  });
});

describe("CreateCapaDraftRequestSchema", () => {
  it("accepts and normalizes a valid draft request", () => {
    const result = CreateCapaDraftRequestSchema.parse({
      initiating_event:
        "  A recurring seal defect was identified during inspection.  ",
      source: {
        source_type: "NONCONFORMANCE",
        source_reference: "  NCR-2026-0042  ",
      },
      organization_reference: "  CUSTOMER-CAPA-19  ",
    });

    expect(result).toEqual({
      initiating_event:
        "A recurring seal defect was identified during inspection.",
      source: {
        source_type: "NONCONFORMANCE",
        source_reference: "NCR-2026-0042",
      },
      organization_reference: "CUSTOMER-CAPA-19",
    });
  });

  it("accepts a minimal valid draft request", () => {
    const result = CreateCapaDraftRequestSchema.parse({
      initiating_event: "Complaint trend requires investigation.",
      source: {
        source_type: "COMPLAINT",
      },
    });

    expect(result).toEqual({
      initiating_event: "Complaint trend requires investigation.",
      source: {
        source_type: "COMPLAINT",
      },
    });
  });

  it("rejects an empty initiating event", () => {
    expect(() =>
      CreateCapaDraftRequestSchema.parse({
        initiating_event: "   ",
        source: {
          source_type: "COMPLAINT",
        },
      }),
    ).toThrow();
  });

  it("rejects an initiating event over the controlled limit", () => {
    expect(() =>
      CreateCapaDraftRequestSchema.parse({
        initiating_event: "A".repeat(
          CAPA_INPUT_LIMITS.initiating_event + 1,
        ),
        source: {
          source_type: "COMPLAINT",
        },
      }),
    ).toThrow();
  });

  it("rejects invalid source codes", () => {
    expect(() =>
      CreateCapaDraftRequestSchema.parse({
        initiating_event: "A valid initiating event.",
        source: {
          source_type: "INVALID SOURCE",
        },
      }),
    ).toThrow();
  });

  it("rejects client-supplied authoritative fields", () => {
    expect(() =>
      CreateCapaDraftRequestSchema.parse({
        initiating_event: "A valid initiating event.",
        source: {
          source_type: "COMPLAINT",
        },
        organization_id: VALID_UUID,
        status: "S130",
        approved: true,
        created_by: VALID_UUID,
      }),
    ).toThrow();
  });

  it("rejects unknown nested source fields", () => {
    expect(() =>
      CreateCapaDraftRequestSchema.parse({
        initiating_event: "A valid initiating event.",
        source: {
          source_type: "COMPLAINT",
          approved: true,
        },
      }),
    ).toThrow();
  });
});