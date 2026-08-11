import { describe, expect, it } from "vitest";

import type {
  ControlledCode,
  IsoDateTime,
  UserId,
} from "../../lib/capa/domain/capa-types";

import {
  hasRecentReauthentication,
  isHumanPrincipal,
  isServicePrincipal,
  isSessionActive,
  type AuthenticationContext,
  type ServiceIdentityId,
  type SessionId,
} from "../../lib/security/auth-context";

/**
 * Requirements-traced authentication-context tests.
 *
 * Primary source:
 * Document #9 — Security, Privacy, and Access-Control Specification
 *
 * Traceability:
 * IAM-001 through IAM-010
 * AUTH-001 through AUTH-010
 * SEC-AC-001
 * SEC-TBD-002
 */

const TRUSTED_NOW = new Date("2026-08-11T15:00:00.000Z");

function iso(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

function humanContext(
  overrides: Partial<AuthenticationContext> = {},
): AuthenticationContext {
  return {
    principal: {
      principal_type: "human",
      user_id:
        "550e8400-e29b-41d4-a716-446655440000" as UserId,
    },
    session_id:
      "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as SessionId,
    authentication_method: controlled("OIDC"),
    assurance_level: controlled("MFA"),
    authenticated_at: iso("2026-08-11T14:00:00.000Z"),
    expires_at: iso("2026-08-11T16:00:00.000Z"),
    reauthenticated_at: iso("2026-08-11T14:55:00.000Z"),
    ...overrides,
  };
}

function serviceContext(): AuthenticationContext {
  return {
    principal: {
      principal_type: "service",
      service_identity_id:
        "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as ServiceIdentityId,
    },
    session_id:
      "a65d17e5-4688-4412-aa08-f2832b37f671" as SessionId,
    authentication_method: controlled("SERVICE_CREDENTIAL"),
    assurance_level: controlled("SERVICE"),
    authenticated_at: iso("2026-08-11T14:00:00.000Z"),
    expires_at: iso("2026-08-11T16:00:00.000Z"),
  };
}

describe("authenticated principal classification", () => {
  it("identifies a named human principal", () => {
    const context = humanContext();

    expect(isHumanPrincipal(context)).toBe(true);
    expect(isServicePrincipal(context)).toBe(false);

    if (isHumanPrincipal(context)) {
      expect(context.principal.user_id).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
    }
  });

  it("identifies a service principal", () => {
    const context = serviceContext();

    expect(isServicePrincipal(context)).toBe(true);
    expect(isHumanPrincipal(context)).toBe(false);

    if (isServicePrincipal(context)) {
      expect(context.principal.service_identity_id).toBe(
        "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
      );
    }
  });
});

describe("session activity", () => {
  it("accepts an unexpired server-verified session", () => {
    expect(
      isSessionActive(humanContext(), TRUSTED_NOW),
    ).toBe(true);
  });

  it("rejects an expired session", () => {
    const context = humanContext({
      expires_at: iso("2026-08-11T14:59:59.000Z"),
    });

    expect(isSessionActive(context, TRUSTED_NOW)).toBe(false);
  });

  it("rejects a session expiring exactly at the current time", () => {
    const context = humanContext({
      expires_at: iso("2026-08-11T15:00:00.000Z"),
    });

    expect(isSessionActive(context, TRUSTED_NOW)).toBe(false);
  });

  it("fails closed for an invalid expiration timestamp", () => {
    const context = humanContext({
      expires_at: iso("invalid-date"),
    });

    expect(isSessionActive(context, TRUSTED_NOW)).toBe(false);
  });
});

describe("recent reauthentication", () => {
  it("accepts reauthentication within the supplied maximum age", () => {
    expect(
      hasRecentReauthentication(
        humanContext(),
        TRUSTED_NOW,
        10 * 60 * 1000,
      ),
    ).toBe(true);
  });

  it("accepts reauthentication exactly at the maximum age", () => {
    expect(
      hasRecentReauthentication(
        humanContext({
          reauthenticated_at: iso(
            "2026-08-11T14:50:00.000Z",
          ),
        }),
        TRUSTED_NOW,
        10 * 60 * 1000,
      ),
    ).toBe(true);
  });

  it("rejects reauthentication older than the maximum age", () => {
    expect(
      hasRecentReauthentication(
        humanContext({
          reauthenticated_at: iso(
            "2026-08-11T14:49:59.000Z",
          ),
        }),
        TRUSTED_NOW,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("rejects a missing reauthentication timestamp", () => {
    const context = serviceContext();

    expect(
      hasRecentReauthentication(
        context,
        TRUSTED_NOW,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("rejects invalid reauthentication timestamps", () => {
    expect(
      hasRecentReauthentication(
        humanContext({
          reauthenticated_at: iso("invalid-date"),
        }),
        TRUSTED_NOW,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("rejects future reauthentication timestamps", () => {
    expect(
      hasRecentReauthentication(
        humanContext({
          reauthenticated_at: iso(
            "2026-08-11T15:00:01.000Z",
          ),
        }),
        TRUSTED_NOW,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("rejects negative or non-finite maximum ages", () => {
    const context = humanContext();

    expect(
      hasRecentReauthentication(
        context,
        TRUSTED_NOW,
        -1,
      ),
    ).toBe(false);

    expect(
      hasRecentReauthentication(
        context,
        TRUSTED_NOW,
        Number.POSITIVE_INFINITY,
      ),
    ).toBe(false);
  });
});