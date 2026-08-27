import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseCapaExistingCaseResponse,
} from "../../app/capa/capa-existing-case-client";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const OTHER_CASE_ID =
  "10000000-0000-4000-8000-000000000002";

const CASE_VERSION_ID =
  "20000000-0000-4000-8000-000000000001";

const SECTION_VERSION_ID =
  "30000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "40000000-0000-4000-8000-000000000001";

const FALLBACK_CORRELATION_ID =
  "50000000-0000-4000-8000-000000000001";

function responseBody() {
  return {
    capa: {
      capa_case_id:
        CASE_ID,

      case_number:
        "CAPA-000008",

      status:
        "S10",

      record_version:
        2,

      current_version_id:
        CASE_VERSION_ID,

      created_at:
        "2026-08-27T15:43:00.000Z",

      sections: [
        {
          section_version_id:
            SECTION_VERSION_ID,

          content: {
            initiating_event:
              "Production validation intake.",

            source: {
              source_type:
                "internal",

              source_reference:
                "M5-E2E",
            },

            organization_reference:
              "LVTChat LLC",
          },
        },
      ],
    },

    correlation_id:
      CORRELATION_ID,
  };
}

describe(
  "CAPA existing-case browser parser",
  () => {
    it(
      "accepts an authoritative S10 case bound to the selected CAPA",
      () => {
        expect(
          parseCapaExistingCaseResponse(
            responseBody(),
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toEqual({
          capaCaseId:
            CASE_ID,

          caseNumber:
            "CAPA-000008",

          status:
            "S10",

          recordVersion:
            2,

          currentVersionId:
            CASE_VERSION_ID,

          sectionVersionId:
            SECTION_VERSION_ID,

          createdAt:
            "2026-08-27T15:43:00.000Z",

          initiatingEvent:
            "Production validation intake.",

          sourceType:
            "internal",

          sourceReference:
            "M5-E2E",

          organizationReference:
            "LVTChat LLC",

          correlationId:
            CORRELATION_ID,

          retrievalVerified:
            true,
        });
      },
    );

    it(
      "uses the request correlation ID when the response omits one",
      () => {
        const body = responseBody();

        const {
          correlation_id:
            _correlationId,
          ...withoutCorrelation
        } = body;

        expect(
          parseCapaExistingCaseResponse(
            withoutCorrelation,
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toMatchObject({
          correlationId:
            FALLBACK_CORRELATION_ID,
        });
      },
    );

    it(
      "rejects a response for a different CAPA case",
      () => {
        const body = responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,
                capa_case_id:
                  OTHER_CASE_ID,
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it.each([
      0,
      -1,
      1.5,
      "2",
      null,
    ])(
      "rejects invalid record version %j",
      (recordVersion) => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,
                record_version:
                  recordVersion,
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects a representation without a valid intake section",
      () => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,
                sections: [],
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects a representation without an authoritative source type",
      () => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,

                sections: [
                  {
                    section_version_id:
                      SECTION_VERSION_ID,

                    content: {
                      initiating_event:
                        "Production validation intake.",

                      source: {},
                    },
                  },
                ],
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects malformed optional controlled fields",
      () => {
        const body =
          responseBody();

        expect(
          parseCapaExistingCaseResponse(
            {
              ...body,

              capa: {
                ...body.capa,

                sections: [
                  {
                    section_version_id:
                      SECTION_VERSION_ID,

                    content: {
                      initiating_event:
                        "Production validation intake.",

                      source: {
                        source_type:
                          "internal",

                        source_reference:
                          123,
                      },

                      organization_reference:
                        false,
                    },
                  },
                ],
              },
            },
            {
              expectedCaseId:
                CASE_ID,

              fallbackCorrelationId:
                FALLBACK_CORRELATION_ID,
            },
          ),
        ).toBeNull();
      },
    );
  },
);
