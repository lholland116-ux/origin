# Agent execution wake-up (dormant)

The internal `POST /api/internal/execution-wake` endpoint is only a wake-up. It
accepts no user, run, conversation, or step identifiers and delegates once to
the existing trusted worker. PostgreSQL remains authoritative for due-work
discovery, per-run claims/fencing, authorization, cost admission, controls,
checkpoints, and finalization.

The endpoint is disabled unless `AGENT_EXECUTION_TRIGGER_ENABLED` is exactly
`true`. It also requires `AGENT_EXECUTION_TRIGGER_SECRET` to contain at least
32 UTF-8 bytes. Missing/invalid configuration fails closed. Never place this
secret in a URL, repository, browser bundle, request body, or logs.

## Request contract

The trigger accepts only an empty-body `POST` with these headers:

- `x-lvtchat-timestamp`: Unix seconds, within five minutes of server time
- `x-lvtchat-nonce`: 16 random bytes encoded as 32 hexadecimal characters
- `x-lvtchat-signature`: lowercase or uppercase hex HMAC-SHA256 of this exact
  UTF-8 message, using the server-only secret:

  ```text
  v1\nPOST\n/api/internal/execution-wake\n{timestamp}\n{lowercase_nonce}
  ```

The server compares signatures in constant time and stores only SHA-256 of the
nonce. PostgreSQL rejects nonce reuse for ten minutes. A separate short-lived,
fenced global gate admits one trigger invocation at a time. While the handler
awaits the worker it renews that gate every 30 seconds through an atomic,
fencing-checked database RPC. A stale or expired claim cannot renew or release a
new owner's gate. This is in addition to, not a replacement for, atomic per-run
execution claims.

The route awaits the worker and returns only a sanitized status, duration, and
provider-call count. Logs contain an invocation ID and safe classifications;
they must not contain prompts, provider results, user/run IDs, secrets, or raw
nonces. A lost trigger response is safe to retry only with a new nonce; the
durable worker checkpoint and claims remain the authority for whether work
advances.

## Hostinger status

Hostinger's public documentation confirms Business Node.js hosting, Node 24,
Next.js, ZIP deployment, custom cron commands, UTC schedules, and cron/runtime
log views. It does not document a cron secret store shared with the Node app,
cron Node/curl availability, HTTP or cron duration ceilings, or cron overlap
semantics. Therefore this implementation is locally testable but must remain
dormant until an isolated Hostinger probe verifies a credential path that does
not place secrets in command output/configuration and measures actual execution
and overlap behavior. Do not create a production cron job or enable the route
based only on this document.

The owner reports these Hostinger-side checks were previously completed: a
PHP/HTML scheduling site was created; five-minute scheduled PHP runs succeeded;
protected PHP script permissions and private signing-material loading were
verified; the HTTPS receiver failed closed; and the HTTPS caller passed a PHP
syntax check. These establish a PHP cron/caller starting point, not successful
authenticated delivery to this Next.js route or Node.js execution-time and
overlap behavior. This local qualification does not independently repeat or
attest to the account-side measurements.

The worker's 90-second deadline is cooperative for some non-provider I/O, and
Hostinger's request termination ceiling is unknown. The 150-second global gate
is a renewable concurrency lease, not a hard process timeout; loss of database
connectivity can prevent renewal, and lease expiry cannot cancel an in-flight
provider request. If ownership is lost or uncertain, the handler returns an
unavailable response after the worker settles and does not claim successful
serialization. PostgreSQL per-run claims, fencing, and recovery-required
classification protect durable state, but they cannot cancel an already-
dispatched provider request. An ambiguous paid operation must retain its
reservation and follow the existing recovery policy; it must not be
automatically replayed merely because a trigger or lease expired.

## Controlled account probe (approval required)

Use a temporary isolated Node.js 24 test app/subdomain with no customer data,
production Supabase credentials, or provider keys. First deploy only a harmless
HMAC receiver that records a fixed non-billable probe receipt. Configure a
test-only signing secret through a Hostinger-supported private mechanism, then
create one temporary five-minute cron entry using the previously verified PHP
caller. Capture sanitized invocation/HTTP timestamps, response status,
duration, cron output, runtime logs, resource usage, and secret availability
(boolean only). Verify valid HMAC delivery, wrong/expired HMAC rejection,
replay rejection, and concurrent duplicate delivery. Separately measure a
bounded Node.js request with a test-only delay; do not infer its ceiling from
the PHP run duration. Test worker interruption/recovery only against an
explicitly isolated test database and mocked/no-provider worker, never customer
records. Run for a short owner-approved window. Delete the cron entry, test
secret, and isolated test deployment afterward. Do not use the production
worker endpoint, production Supabase, or production provider keys.

Rollback is to remove the temporary cron entry first, disable/remove the
test-only secret and endpoint deployment, then verify the production app and
configuration are unchanged. Any production deployment/configuration change
or use of the actual worker requires separate explicit approval.
