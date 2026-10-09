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

## ER-CS5B.3D.3 qualification package

The owner reports that the existing Business plan has custom cron scheduling,
that a five-minute cron successfully ran PHP CLI 8.2.33, and that a private
`0700` directory, `0600` PHP scripts, a private test key, HTTPS reachability,
and fail-closed behavior without that key were checked. The previously checked
`https-cron-caller.php` syntax is evidence for that file only. These are
account-reported measurements, not independently repeated by this local
qualification. They do not establish Node.js 24 behavior, signed delivery,
request time limits, process termination, or cron overlap semantics.

The PHP receiver/caller experiment uses timestamp-only authentication. It does
not implement the production trigger's one-time nonce contract: durable
PostgreSQL nonce consumption, cross-instance replay protection, or its fenced
global gate. Never use the PHP probe as evidence for those production
properties.

This change set adds two isolated test tools:

- `scripts/hostinger-node-runtime-probe.mjs` is a dependency-free Node HTTP
  receiver for an isolated test app. It has no database, user workflow, or
  provider integration. It measures bounded delays (1, 5, 30, 60, 90, 120
  seconds), concurrent requests, memory snapshots, and graceful interruption.
  Its replay cache is process-local and deliberately does not claim durable or
  cross-instance replay protection. It reads only a private regular key file
  with no group/world permissions and exposes availability as a boolean.
- `scripts/hostinger-probe-caller.php` can call only the fixed temporary test
  domain in this procedure. It loads `https-probe.key` beside itself, checks
  private permissions, signs empty POST requests, disables redirects and TLS
  verification bypasses, and prints only case, HTTP status, and duration. It
  never prints response bodies, key material, signatures, or nonces. Its
  135-second HTTP timeout is a client bound, not evidence that Hostinger allows
  a request to run that long.

The PHP CLI is not installed in the local qualification environment, so local
automation validates the shared HMAC vector and PHP runner structure but cannot
run `php -l` on the new PHP file. Run `php -l` in the isolated Hostinger
environment before scheduling it. Do not infer remote Node results from local
Node, and do not infer a 90-second request allowance without measuring it on
this account.

### One controlled remote qualification window

These steps require owner action in Hostinger. They do not authorize changes to
the production site. Use only the temporary domain
`darkblue-bear-768036.hostingersite.com` and private directory
`/home/u564997839/lvtchat-cron-probe`.

1. In Hostinger, create or select an isolated test Node.js 24 app bound only to
   the temporary domain. Deploy the probe file as a test artifact and configure
   its entry point as `node scripts/hostinger-node-runtime-probe.mjs`. Set
   `HOSTINGER_PROBE_REQUIRE_NODE24=true` and
   `HOSTINGER_PROBE_KEY_FILE=/home/u564997839/lvtchat-cron-probe/https-probe.key`
   using the panel's private environment/file mechanisms. Let the platform
   provide `PORT`. Do not copy production environment variables, a Supabase
   URL/key, a provider key, or any customer data into this app. Confirm
   `/healthz` reports `nodeMajor: 24` and only the boolean
   `keyAvailable: true`.
2. Place `scripts/hostinger-probe-caller.php` in the private directory as
   `hostinger-probe-caller.php`, mode `0600`; keep the already-created
   `https-probe.key` private and at least 32 bytes. In the Hostinger terminal,
   run `php -l /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php`.
   A syntax failure is a stop condition. Do not put the key in a command,
   cron field, URL, or evidence capture.
3. Run the caller manually once for `valid`, `invalid-signature`,
   `stale-timestamp`, and `replay`. Expected HTTP statuses are respectively
   `200`, `401`, `401`, and `200` then `409`. Each output is sanitized JSON.
   Stop if any result differs; do not create the cron entry until these pass.
   Also test missing-key fail-closed behavior without touching the private key:
   change only the isolated Node app's `HOSTINGER_PROBE_KEY_FILE` to a
   deliberately nonexistent test path, restart the app, verify `/healthz`
   shows `keyAvailable: false`, and run `missing-key` (expected `503`). Restore
   the correct private path, restart, and verify `keyAvailable: true` before
   continuing. The caller's missing-key case sends no authentication headers.
4. Schedule exactly one temporary five-minute cron entry, capped at 15 minutes,
   invoking only
   `php /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php valid`.
   Follow Hostinger's UI syntax and timezone display; do not place credentials
   in the entry. Capture actual schedule times and receipts, then remove the
   entry immediately after the third execution or at 15 minutes, whichever
   comes first. Record a different execution count as observed; do not extend
   the window just to force three. If only delayed cron delivery is available,
   do not create a second recurring entry just to create overlap.
5. Run each delay case manually and sequentially: `delay-5`, `delay-30`,
   `delay-60`, `delay-90`, and `delay-120`. Record status and measured duration;
   stop increasing the duration after timeout, termination, or any unexpected
   result. These are probe requests only. A `200` for one duration documents
   one observed request, not a guaranteed platform maximum or production
   worker deadline.
6. To test overlap, start two `delay-30` callers concurrently from the
   isolated terminal if supported. Otherwise omit this test and record that
   cron overlap remains unmeasured; do not add a second recurring job. Confirm
   both sanitized responses and the app's `maxObservedActive` log. Restart the
   isolated app while a `delay-30` request is active and record whether it
   completes, receives the probe's sanitized `503`, or is externally
   terminated. Do not infer production recovery from this harmless in-memory
   probe.
7. Save only sanitized evidence: temporary app/runtime version and probe
   `nodeMajor`; boolean key availability; test case; scheduled and observed
   times; HTTP status and duration; overlap count; RSS/heap snapshots; and
   shutdown/interruption classifications. Exclude request headers, key,
   signatures, nonces, response bodies, environment dumps, customer data, and
   credentials. Store the evidence in the approved operational record, not in
   the repository.
8. Clean up in this order: remove/verify removal of the cron entry; stop and
   remove the isolated Node app and its test-only configuration; remove only
   the newly added `hostinger-probe-caller.php` and the test-only key if the
   owner confirms they are no longer needed. Preserve the pre-existing
   `cron-probe.php`, `https-cron-caller.php`, and `cron-auth-probe.php` unless
   separately approved for removal. Verify production remains unchanged and
   the production worker remains disabled.

If setup, authentication, sanitized logging, or cleanup cannot be verified,
stop and preserve the production worker's disabled state. The result of this
window is account-specific operational evidence only; it does not qualify
production activation. Production activation requires a separate review of
these measurements, private secret delivery, runtime limits, and the existing
PostgreSQL security/integration qualification.

### Local repeatability

Run the local probe contract and production-trigger unit tests with:

```sh
./node_modules/.bin/vitest run tests/unit/hostinger-probe-runtime.test.ts tests/unit/execution-trigger.test.ts
```

The disposable PostgreSQL trigger tests remain opt-in and use the documented
test-only database URL/port. They qualify durable nonce consumption and the
fenced gate in PostgreSQL; the temporary Hostinger probe does not. Never point
the opt-in test URL at production or staging.
