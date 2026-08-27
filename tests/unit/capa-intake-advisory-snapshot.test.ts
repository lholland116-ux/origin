import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseCapaIntakeAdvisorySnapshot,
} from "../../app/capa/capa-intake-advisory-snapshot";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const CASE_VERSION_ID =
  "20000000-0000-4000-8000-000000000001";

function validSnapshot() {
  return {
    capa_case_id:
      CASE_ID,

    case_version_id:
      CASE_VERSION_ID,

    record_version:
      2,
  };
}

describe(
  "CAPA intake advisory browser snapshot parser",
  () => {
    it(
      "accepts the exact authoritative snapshot contract",
      () => {
        const result =
          parseCapaIntakeAdvisorySnapshot(
            validSnapshot(),
          );

        expect(result).toEqual({
          capaCaseId:
            CASE_ID,

          caseVersionId:
            CASE_VERSION_ID,

          recordVersion:
            2,
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);
      },
    );

    it.each([
      null,
      [],
      "snapshot",
      7,
    ])(
      "rejects a non-object snapshot: %p",
      (value) => {
        expect(
          parseCapaIntakeAdvisorySnapshot(
            value,
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects an unexpected authority field",
      () => {
        expect(
          parseCapaIntakeAdvisorySnapshot({
            ...validSnapshot(),
            organization_id:
              "30000000-0000-4000-8000-000000000001",
          }),
        ).toBeNull();
      },
    );

    it(
      "rejects an invalid CAPA case identifier",
      () => {
        expect(
          parseCapaIntakeAdvisorySnapshot({
            ...validSnapshot(),
            capa_case_id:
              "not-a-uuid",
          }),
        ).toBeNull();
      },
    );

    it(
      "rejects an invalid case version identifier",
      () => {
        expect(
          parseCapaIntakeAdvisorySnapshot({
            ...validSnapshot(),
            case_version_id:
              "not-a-uuid",
          }),
        ).toBeNull();
      },
    );

    it.each([
      0,
      -1,
      1.5,
      Number.NaN,
      "2",
    ])(
      "rejects invalid record version %p",
      (recordVersion) => {
        expect(
          parseCapaIntakeAdvisorySnapshot({
            ...validSnapshot(),
            record_version:
              recordVersion,
          }),
        ).toBeNull();
      },
    );
  },
);
