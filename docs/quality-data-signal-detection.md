# Quality Signal Detection V1

Stage 3B exposes deterministic, read-only detection at `POST /api/quality-data/signals`. It reuses Stage 3A's authenticated organization context, `quality_data.source.read` permission, organization pilot gate, shared `analysis` rate limit, and current approval lookup. A version must still be approved when the request is evaluated. Rejected, revoked, absent, and cross-organization versions do not produce calculations.

The pilot gate remains disabled by default. Signal detection does not write data, alter approval state, invoke a provider, open a CAPA case, verify source evidence, or make a regulated decision. Responses identify the exact immutable dataset version, current approval transition, source version and SHA-256 fingerprint, and source rows/cells used by each calculation.

## Request contract

Requests use `schema_version: "quality-signal-request-1.0.0"`, one `dataset_version_id`, and one to ten explicitly configured signals. Unknown fields, duplicate signal identifiers, duplicate input field roles, non-finite thresholds, and out-of-range limits are rejected.

Supported definitions:

- `recurring_category`: the caller explicitly selects a mapped text field and declares it to represent a `defect_code` or `failure_mode`. Values are compared exactly as normalized in the approved dataset; the detector does not infer defect meaning or merge case variants. The caller supplies `minimum_occurrences` and `minimum_sample_size` (at least three valid values). The window is all records in that version.
- `defect_rate_threshold`: the caller explicitly selects defect-count, production-quantity, and observation-date fields, supplies the expected production unit, a scale (`rate_per`), a threshold in that scaled rate unit, and a minimum of at least three valid records per month. The defect-count field must have numeric values with unit `count`; production-quantity values must be numeric and match the supplied unit exactly; dates must be valid normalized `YYYY-MM-DD` dates.
- `defect_rate_trend`: uses the same explicit fields and monthly windows. It compares adjacent calendar months only, requires the configured minimum sample in both months, and emits a signal only when the caller's direction and minimum absolute rate change are met.

No conversion, imputation, date inference, or formula evaluation is performed. A missing field, incompatible type, or unit mismatch is reported as unsupported schema. Missing values, invalid dates/numbers, zero denominators, and absent cell provenance are excluded with reason counts and source-row references. Repeated record IDs, ordinals, source rows, or cell references invalidate the snapshot. Identical field values on distinct source rows remain distinct observations; they are not deduplicated because repeat occurrence is itself a signal input. A rate denominator is the sum of valid positive production quantities in the month; the numerator is the sum of valid nonnegative integer defect counts. The rate is `sum(defect_count) / sum(production_quantity) * rate_per`, without rounding before comparison. Trend change is the signed difference between consecutive monthly rates, in the same scaled rate unit. The maximum evaluated date span is 120 calendar months.

Insufficient samples and unsupported configurations are explicit in each signal result. The response is bounded to five MiB; an oversized result is rejected instead of truncating evidence. A signal means only that the configured deterministic condition was observed in the selected dataset. Causal explanation, regulatory conclusion, and source verification are explicitly not assessed.

The semantic field mapping and units are caller declarations tied to the selected dataset's approved mapping; the system verifies field keys, stored types, and exact units, but cannot establish that a workbook column truly represents a manufacturing concept. Human review remains necessary before acting on a signal.
