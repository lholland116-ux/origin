import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_SCOPE_APPROVAL_CONFIRMATION,
  createCapaScopeApprovalAttempt,
  parseCapaScopeApprovalFailure,
  parseCapaScopeApprovalSuccess,
} from "../../app/capa/capa-scope-approval-client";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const CURRENT_VERSION_ID =
  "20000000-0000-4000-8000-000000000002";

const RESULTING_VERSION_ID =
  "30000000-0000-4000-8000-000000000003";

const SCOPE_SECTION_ID =
  "40000000-0000-4000-8000-000000000004";

const APPROVAL_AUDIT_ID =
  "50000000-0000-4000-8000-000000000005";

const TRANSITION_AUDIT_ID =
  "60000000-0000-4000-8000-000000000006";

const CORRELATION_ID =
  "70000000-0000-4000-8000-000000000007";

describe(
  "CAPA scope-approval client contract",
  () => {
    it(
      "creates one stable serialized G-01 approval attempt",
      () => {
        const scope = {
          problem_statement:
            "A human-authored problem statement.",
          priority:
            "High",
        };

        const attempt =
          createCapaScopeApprovalAttempt({
            capaCaseId:
              CASE_ID,

            caseNumber:
              "CAPA-000001",

            recordVersion:
              2,

            currentVersionId:
              CURRENT_VERSION_ID,

            idempotencyKey:
              "g01-browser-1",

            scope,

            rationale:
              "  Scope reviewed and accepted.  ",
          });

        expect(attempt)
          .not.toBeNull();

        if (attempt === null) {
          throw new Error(
            "Expected a valid approval attempt.",
          );
        }

        expect(
          JSON.parse(
            attempt.requestBody,
          ),
        ).toEqual({
          expected_record_version:
            2,

          expected_current_version_id:
            CURRENT_VERSION_ID,

          scope: {
            problem_statement:
              "A human-authored problem statement.",
            priority:
              "High",
          },

          approval: {
            decision:
              "approve",

            confirmation:
              CAPA_SCOPE_APPROVAL_CONFIRMATION,

            rationale:
              "Scope reviewed and accepted.",
          },
        });

        expect(
          attempt.idempotencyKey,
        ).toBe(
          "g01-browser-1",
        );

        /*
         * Mutation of the original browser draft after confirmation must not
         * alter the request snapshot retained for an MFA retry.
         */
        scope.priority =
          "Changed after confirmation";

        expect(
          JSON.parse(
            attempt.requestBody,
          ),
        ).toMatchObject({
          scope: {
            priority:
              "High",
          },
        });
      },
    );

    it(
      "normalizes empty rationale to null",
      () => {
        const attempt =
          createCapaScopeApprovalAttempt({
            capaCaseId:
              CASE_ID,
            caseNumber:
              "CAPA-000001",
            recordVersion:
              2,
            currentVersionId:
              CURRENT_VERSION_ID,
            idempotencyKey:
              "g01-browser-2",
            scope: {},
            rationale:
              "   ",
          });

        expect(attempt)
          .not.toBeNull();

        if (attempt === null) {
          return;
        }

        expect(
          JSON.parse(
            attempt.requestBody,
          ),
        ).toMatchObject({
          approval: {
            rationale:
              null,
          },
        });
      },
    );

    it.each([
      {
        field:
          "case id",
        input: {
          capaCaseId: "",
          caseNumber:
            "CAPA-000001",
          recordVersion: 2,
          currentVersionId:
            CURRENT_VERSION_ID,
          idempotencyKey:
            "key",
        },
      },
      {
        field:
          "case number",
        input: {
          capaCaseId:
            CASE_ID,
          caseNumber: "",
          recordVersion: 2,
          currentVersionId:
            CURRENT_VERSION_ID,
          idempotencyKey:
            "key",
        },
      },
      {
        field:
          "record version",
        input: {
          capaCaseId:
            CASE_ID,
          caseNumber:
            "CAPA-000001",
          recordVersion: 0,
          currentVersionId:
            CURRENT_VERSION_ID,
          idempotencyKey:
            "key",
        },
      },
      {
        field:
          "current version",
        input: {
          capaCaseId:
            CASE_ID,
          caseNumber:
            "CAPA-000001",
          recordVersion: 2,
          currentVersionId: "",
          idempotencyKey:
            "key",
        },
      },
      {
        field:
          "idempotency key",
        input: {
          capaCaseId:
            CASE_ID,
          caseNumber:
            "CAPA-000001",
          recordVersion: 2,
          currentVersionId:
            CURRENT_VERSION_ID,
          idempotencyKey: "",
        },
      },
    ])(
      "rejects invalid $field",
      ({
        input,
      }) => {
        expect(
          createCapaScopeApprovalAttempt({
            ...input,
            scope: {},
            rationale:
              null,
          }),
        ).toBeNull();
      },
    );

    it(
      "recognizes the controlled step-up response",
      () => {
        expect(
          parseCapaScopeApprovalFailure({
            error: {
              code:
                "CAPA_STEP_UP_REQUIRED",
              message:
                "Additional authentication is required.",
              correlation_id:
                CORRELATION_ID,
            },
          }),
        ).toEqual({
          kind:
            "step_up_required",
          code:
            "CAPA_STEP_UP_REQUIRED",
          message:
            "Additional authentication is required.",
          correlationId:
            CORRELATION_ID,
        });
      },
    );

    it(
      "preserves controlled G-01 blocker codes",
      () => {
        expect(
          parseCapaScopeApprovalFailure({
            error: {
              code:
                "CAPA_SCOPE_GATE_BLOCKED",
              message:
                "The CAPA scope does not satisfy the G-01 prerequisites.",
              issues: [
                {
                  path:
                    "scope",
                  message:
                    "MISSING_PRIORITY",
                },
                {
                  path:
                    "scope",
                  message:
                    "UNRESOLVED_SCOPE_GAPS",
                },
              ],
              correlation_id:
                CORRELATION_ID,
            },
          }),
        ).toMatchObject({
          kind:
            "gate_blocked",
          blockerCodes: [
            "MISSING_PRIORITY",
            "UNRESOLVED_SCOPE_GAPS",
          ],
          correlationId:
            CORRELATION_ID,
        });
      },
    );

    it.each([
      [
        "CAPA_SCOPE_APPROVAL_VALIDATION_FAILED",
        "validation_failed",
      ],
      [
        "INVALID_CAPA_SCOPE_APPROVAL",
        "validation_failed",
      ],
      [
        "CAPA_IDEMPOTENCY_CONFLICT",
        "conflict",
      ],
      [
        "CAPA_CONCURRENCY_CONFLICT",
        "conflict",
      ],
      [
        "CAPA_WORKFLOW_CONFLICT",
        "conflict",
      ],
      [
        "CAPA_ACCESS_DENIED",
        "access_denied",
      ],
      [
        "CAPA_TENANT_ACCESS_DENIED",
        "access_denied",
      ],
      [
        "UNAUTHORIZED",
        "access_denied",
      ],
      [
        "INVALID_SESSION_CONTEXT",
        "access_denied",
      ],
      [
        "CAPA_NOT_FOUND",
        "not_found",
      ],
    ] as const)(
      "maps %s to %s",
      (
        code,
        kind,
      ) => {
        expect(
          parseCapaScopeApprovalFailure({
            error: {
              code,
              message:
                "Controlled failure.",
            },
          }).kind,
        ).toBe(kind);
      },
    );

    it(
      "fails closed for an unknown error envelope",
      () => {
        expect(
          parseCapaScopeApprovalFailure({
            error: {
              code:
                "SOMETHING_NEW",
              message:
                "Unknown failure.",
            },
          }),
        ).toEqual({
          kind:
            "unexpected",
          code:
            "SOMETHING_NEW",
          message:
            "Unknown failure.",
          correlationId:
            null,
        });
      },
    );

    it(
      "parses a complete S20 approval response",
      () => {
        expect(
          parseCapaScopeApprovalSuccess(
            {
              capa: {
                capa_case_id:
                  CASE_ID,
                case_number:
                  "CAPA-000001",
                status:
                  "S20",
                record_version:
                  3,
                current_version_id:
                  RESULTING_VERSION_ID,
                approved_version_id:
                  RESULTING_VERSION_ID,
                scope_section_version_id:
                  SCOPE_SECTION_ID,
                approved_at:
                  "2026-08-29T15:00:00.000Z",
                approval_audit_event_id:
                  APPROVAL_AUDIT_ID,
                transition_audit_event_id:
                  TRANSITION_AUDIT_ID,
              },
              replayed:
                false,
              correlation_id:
                CORRELATION_ID,
            },
            CASE_ID,
          ),
        ).toEqual({
          capaCaseId:
            CASE_ID,
          caseNumber:
            "CAPA-000001",
          status:
            "S20",
          recordVersion:
            3,
          currentVersionId:
            RESULTING_VERSION_ID,
          approvedVersionId:
            RESULTING_VERSION_ID,
          scopeSectionVersionId:
            SCOPE_SECTION_ID,
          approvedAt:
            "2026-08-29T15:00:00.000Z",
          approvalAuditEventId:
            APPROVAL_AUDIT_ID,
          transitionAuditEventId:
            TRANSITION_AUDIT_ID,
          replayed:
            false,
          correlationId:
            CORRELATION_ID,
        });
      },
    );

    it.each([
      null,
      {},
      {
        capa: {
          capa_case_id:
            "wrong-case",
        },
      },
      {
        capa: {
          capa_case_id:
            CASE_ID,
          case_number:
            "CAPA-000001",
          status:
            "S10",
          record_version:
            3,
          current_version_id:
            RESULTING_VERSION_ID,
          approved_version_id:
            RESULTING_VERSION_ID,
          scope_section_version_id:
            SCOPE_SECTION_ID,
          approved_at:
            "2026-08-29T15:00:00.000Z",
          approval_audit_event_id:
            APPROVAL_AUDIT_ID,
          transition_audit_event_id:
            TRANSITION_AUDIT_ID,
        },
        replayed:
          false,
      },
    ])(
      "rejects incomplete or non-S20 success response %#",
      (
        value,
      ) => {
        expect(
          parseCapaScopeApprovalSuccess(
            value,
            CASE_ID,
          ),
        ).toBeNull();
      },
    );
  },
);
