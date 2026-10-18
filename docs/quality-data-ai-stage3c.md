# Stage 3C: Evidence-Grounded Quality Analysis

Stage 3C adds an advisory interpretation layer over the deterministic Stage 3A calculations and Stage 3B signals. It does not change a CAPA record, decide a root cause, verify evidence, or make a regulated quality decision.

## Authorization gates

An interpretation request requires all of the following at runtime:

1. Existing authenticated, server-resolved tenant context and `quality_data.source.read` authorization.
2. The exact immutable dataset version is currently approved for analytical use. A rejected, absent, or revoked version is denied.
3. A current append-only organization external-AI transfer event has decision `enabled`. This is separate from analytical-use approval. Only an active `CAPA_ORG_ADMIN` with the distinct `quality_data.external_ai.manage` permission can append an enable/disable event. The event records the actor, membership, rationale, timestamp, transition, request correlation and idempotency fingerprint. No event means denied.
4. `QUALITY_DATA_AI_INTERPRETATION_ENABLED=true` and the server-resolved organization appears in `QUALITY_DATA_AI_ORGANIZATION_IDS`.
5. The existing quality-data pilot gate and shared database-backed rate limiter allow the request.

All environment gates are disabled by default and fail closed for malformed values. The quality-data pilot must remain disabled until separately approved.

## Provider packet boundary

The Responses API receives only a validated `quality-evidence-packet-1.0.0` packet containing aggregate metric values/counts, monthly aggregate buckets, sample sizes, thresholds, standardized unit aliases, static assumptions/data-quality codes, and random opaque evidence handles. Recurring category values are replaced by aliases such as `C1`.

The packet excludes raw records, field values, field names, workbook/source names and hashes, organization/dataset/customer identities, row/cell provenance, personal data, free text, and lot/serial identifiers. The handle-to-record/cell/source mapping is created in request memory and never enters the provider prompt or telemetry. The locally returned citation attachment is resolved from that mapping only after every model reference has been checked against the packet handle set.

The model can produce only possible-cause hypotheses, uncertainty statements, and human investigation suggestions. These are marked unverified and must cite valid handles. Unsupported handles, malformed structured output, or identifier-like content are rejected. The deterministic calculations and observations are returned separately from the model text.

## Provider and resource bounds

The only configured model is the existing `gpt-6-luna` OpenAI Responses API integration. Requests set `store:false`, use strict JSON schema, have no tools, no background mode, no provider fallback, zero SDK retries, a 15-second request timeout, a 512 output-token limit, and a 24 KB prompt/packet bound. A conservative preflight estimate must be below USD $0.01 per request. The shared database limiter permits at most 3 AI interpretations per user per 10-minute window; the separate opt-in control is limited to 10 transitions per user per window. Failures are not retried automatically.

The new telemetry table contains only opaque request/correlation UUIDs, model, token counts, estimated cost, latency, status, and pricing version. It does not store tenant/user identifiers, packets, prompts, source references, narratives, or customer content. Telemetry write failure is non-fatal and does not print request data.

## Provider retention and production activation gate

`store:false` requests that Responses application state not be retained; it does **not** mean Zero Data Retention. OpenAI documents default API abuse-monitoring logs as retained for up to 30 days, and those logs may contain prompts, responses, or derived content. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) and the [OpenAI Data Processing Addendum](https://openai.com/policies/feb-2024-data-processing-addendum/). This repository cannot read or verify the active OpenAI organization/project retention configuration.

Before any real manufacturing evidence is sent, an owner must separately verify the actual API project retention mode and applicable agreement, confirm the customer-facing disclosure and organizational authorization for this minimized transfer, and approve the production pilot. Do not infer Zero Data Retention from `store:false`, the application opt-in, or the allowlist. Keep both application gates disabled until those checks and production qualification are complete.

## Migration and local qualification

Forward-only migration: `20261018110000_quality_data_external_ai_interpretation.sql`. It adds the distinct transfer-management permission, append-only opt-in events, metadata-only telemetry storage, and shared limiter actions/limits. Apply it only to a disposable qualification database during this change set; production application requires a separate approval.

The local tests use synthetic data and mocked model responses only. No provider request is made by the qualification suite.
