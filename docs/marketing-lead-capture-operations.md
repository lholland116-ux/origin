# Marketing lead capture operations

## Cloudflare Turnstile setup

Create a Turnstile widget for the production hostname `lvtchat.com` (the site redirects `www.lvtchat.com` to that hostname). Use the managed widget mode. The application renders it with action `marketing_lead_submit` and accepts Siteverify success only when the returned hostname and action match exactly.

Configure these Hostinger Node.js environment variables before building or redeploying:

- `NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY` — the production widget sitekey. This is public and is embedded in the request page.
- `CLOUDFLARE_TURNSTILE_SECRET_KEY` — the matching private secret, used only by the server route.
- `NEXT_PUBLIC_SUPABASE_URL` — existing Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — existing server-only key used for the restricted submission RPC.

Do not put a secret in a `NEXT_PUBLIC_` variable. Do not use Cloudflare testing keys in Hostinger production. Missing or malformed Turnstile configuration disables submissions. Siteverify is sent only from the server, with a five-second timeout and no client IP parameter. The application does not read forwarding headers for identity or quotas.

## Database rollout order

The forward-only Turnstile/global-limit migration depends on the lead-capture schema and RPC from `20261019120000_create_private_marketing_lead_capture.sql`. Apply that base migration first where it is still pending, then apply `20261019130000_marketing_turnstile_and_global_limits.sql`. Do not edit the base migration; it may already exist in another persistent environment. Verify the migration ledger and RPC signature before release.

Cloudflare publishes official testing keys for automated/local tests. The unit tests use its always-pass test pair and mock the Siteverify response; they do not send requests to Cloudflare. Cloudflare's test keys are rejected by the application when `NODE_ENV=production`.

## Lead limits and retries

New leads are limited to three submissions per normalized email in a rolling 24-hour window and 100 new leads globally per rolling 24-hour window. Both limits are transactionally enforced by the private Supabase RPC. There is no client-IP quota. Idempotent retries keep the same lead idempotency key when the form fields are unchanged and obtain a fresh one-use Turnstile token; a changed form payload gets a new key. Siteverify tokens are never logged or persisted.

## Proposed 12-month review and deletion procedure

This is a manual procedure; the application does not schedule or automatically delete leads.

1. Each month, an authorized database operator reviews the count of lead records approaching 12 months from `created_at`, using the Supabase SQL Editor under an owner-approved administrative role.
2. Confirm whether any request remains open or whether a legal obligation requires a documented exception. The database does not track last-contact or request status, so the operator must make that determination using the authorized request-handling process.
3. Delete eligible records by the 12-month anniversary. Record the review date, operator, aggregate count deleted, and any exception reason in the approved administrative record; do not place lead names, email addresses, or free text in general logs.
4. Process earlier access, correction, and deletion requests through the published support contact. Verify the request before making a narrowly scoped database change.
5. Confirm the encrypted-backup expiry schedule with the backup owner. A deletion from the active table does not immediately remove the record from existing encrypted archives; document the actual archive expiry and restore handling before collecting live leads.

The live application exposes no lead list or deletion API. Public, anonymous, authenticated, and service roles do not have direct table access; retrieval and deletion are controlled database-operator actions. Never use the browser or service-role API to export lead rows.
