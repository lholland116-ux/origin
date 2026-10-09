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

Current Hostinger documentation confirms that Business plans support Node.js
web apps, including Node 24 and ZIP deployment, and that Business plans can
host multiple websites. It also says an already-attached domain must be
removed before being reused for a Node.js website. Therefore Site A (existing
PHP/HTML) must remain intact and Site B must be a newly created Node.js website
on a different Hostinger temporary domain. Do not reassign Site A's domain or
use `lvtchat.com`. See [Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/),
[multiple websites](https://www.hostinger.com/support/1583214-how-to-add-a-website-in-hostinger/),
and [plan options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/).

The public documentation does not establish that Site B's process can read a
private file under Site A, nor does it document a cron-to-app shared secret
store, request-duration ceiling, or cron overlap semantics. Test Site B access
to Site A's private key using the probe's boolean health field. If unavailable,
stop; do not loosen permissions, place the key in the ZIP, or assume cross-site
filesystem access.

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

## Two-site account probe (approval required)

Site A is the existing PHP/HTML website, cron manager, caller, and private
signing-key host. Site B is a new Node.js 24 website on a different Hostinger
temporary domain. Do not reuse Site A's domain or modify `lvtchat.com`. Current
Hostinger instructions say an existing website must be removed before its
domain can be reassigned to a Node.js app, so create Site B with a fresh
temporary domain instead.

The caller reads Site B's approved bare hostname from a private Site A
allowlist. It rejects Site A's hostname and non-Hostinger temporary hostnames,
constructs HTTPS itself, and disables redirects. Site B attempts to read the
private key from Site A's private path; if `/healthz` does not confirm that key
is available, stop without loosening permissions or copying the key into the
deployment package. Shared filesystem access between sites is not established.

## ER-CS5B.3D.3 two-site qualification package

The owner reports that Site A already has a working five-minute PHP cron,
private directory/key, and HTTPS receiver. Retain that PHP/HTML site, its cron
manager, the key at
`/home/u564997839/lvtchat-cron-probe/https-probe.key`, and the existing test
receiver. The old timestamp-only PHP receiver does not demonstrate production
nonce replay protection or the fenced PostgreSQL gate.

The deployable Node package is
`/tmp/lvtchat-hostinger-node-probe-port-fix.zip`. It contains only
root-level `package.json` and `hostinger-node-runtime-probe.mjs`;
the package manifest pins Node `24.x`, has no dependencies, and starts with
`npm start`. The probe binds `0.0.0.0` and uses Hostinger's `PORT` when valid.
For an absent or blank value it falls back to port `3000`; malformed or
out-of-range explicit values still fail closed. Hostinger's Node.js guidance
specifies listening on port `3000` ([troubleshooting guidance](https://www.hostinger.com/support/fix-failed-to-build-application-error-hostinger-node-js/)).
Recreate the archive from the repository root with:

```sh
zip -j -X /tmp/lvtchat-hostinger-node-probe-port-fix.zip deploy/hostinger-node-probe/package.json scripts/hostinger-node-runtime-probe.mjs
```

The generated archive SHA-256 is
`f2d3e29ae2945d5da1bbca55ef0c5cacfc9be6521f17d378da4d245032878419`.

The configured entry now starts the HTTP server at module load by default;
startup does not depend on a `process.argv[1]` path comparison, which can fail
when a hosting loader imports an ESM entry. `HOSTINGER_PROBE_DISABLE_AUTOSTART`
is a test-only opt-out and must not be set in Site B.

The follow-up `port_unavailable` event means the old code rejected `PORT`
before calling `listen()`: `Number(undefined)` is `NaN` and an empty string
converts to zero, while the literal string `3000` is valid. Thus the reported
event after setting `PORT=3000` does not prove that the deployed process
received that value; runtime environment propagation or deployment freshness
remain unverified. Local child-process regression tests now cover absent,
blank, valid `3000`, malformed, and out-of-range values in direct and ESM-import
entry modes, with the listener reachable within three seconds, key-present and
key-absent behavior, and clean shutdown.

Local qualification on 2026-10-09 (Node.js `v25.8.1`) passed 23 focused tests
across `hostinger-probe-runtime.test.ts` and `execution-trigger.test.ts`;
TypeScript, targeted ESLint, Node syntax, and `git diff --check` also passed.
This is local evidence only and does not qualify Site B's Node 24 runtime.

Site A's caller reads the approved Site B hostname from the private,
`0600` file `/home/u564997839/lvtchat-cron-probe/probe-host.allow`. It accepts
only a bare single Hostinger temporary hostname (`.hostingersite.com` or
`.hostinger-site.com`), rejects Site A's own hostname, URLs, ports, paths, IP
addresses, and localhost values, and constructs an `https://` URL itself.
Both stream and cURL requests verify TLS and disable redirects. Signed requests
are empty-body POSTs and use the same v1 HMAC bytes as the Node receiver.

Site B's `HOSTINGER_PROBE_KEY_FILE` will initially point to Site A's existing
private key path. This explicitly tests whether Site B can read it. The Node
probe accepts only a private regular file and reports availability as a
boolean. If it reports `false`, stop: do not loosen permissions, place the key
in the ZIP, or assume shared-site access. Hostinger does not document this
cross-site filesystem property.

### Owner session in hPanel; no SSH terminal required

Budget roughly 30–35 minutes for the scheduled checks, depending on where each
five-minute cron tick falls. The longest `delay-suite` run can take up to about
120 seconds plus request/cron overhead. This is a planning estimate, not a
Hostinger execution guarantee.

Hostinger's current docs describe Business websites as multi-site eligible,
Node.js Web Apps as available on Business, Node versions through 24.x, ZIP
upload, and temporary domains. They also warn that a domain already attached to
a website must first have that website removed before reusing it. The safe flow
is to add a different temporary domain for Site B. References: [Node.js app
deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/),
[website creation and multiple sites](https://www.hostinger.com/support/1583214-how-to-add-a-website-in-hostinger/),
[Node hosting options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/),
and [temporary domains](https://www.hostinger.com/support/how-to-switch-to-a-temporary-domain-in-hostinger-dashboard/).

1. In Websites, select the existing Business plan and choose Create Website →
   Web App → Node.js → Upload your website files. Upload
   `/tmp/lvtchat-hostinger-node-probe-port-fix.zip`, choose Node.js `24.x`,
   and select “Other” if asked for an app/framework type. Set the entry file to
   `hostinger-node-runtime-probe.mjs`; no custom build command or third-party
   dependency is required. Choose **Use temporary
   domain** and confirm the assigned Site B hostname is different from Site A
   (`darkblue-bear-768036.hostingersite.com`) and not `lvtchat.com`. Do not
   remove, reassign, or redeploy Site A. If hPanel offers no additional
   website slot or temporary domain under the current plan, stop; do not
   upgrade, purchase a domain, or repurpose Site A.
2. In Site B's private Environment Variables settings, set only:

   ```text
   HOSTINGER_PROBE_REQUIRE_NODE24=true
   HOSTINGER_PROBE_KEY_FILE=/home/u564997839/lvtchat-cron-probe/https-probe.key
   ```

   Let hPanel set `PORT`. Hostinger supports these values in the app's
   Environment variables settings, separate from repository contents (see
   [environment variable setup](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)).
   Do not import `.env`, use Database Connect Wizard, or
   enter production Supabase/provider settings. Wait for HTTPS. Check Site B
   `https://{SITE_B_HOST}/healthz`; require `nodeMajor: 24` and
   `keyAvailable: true`. If false, stop and do not alter key permissions.
3. In Site A File Manager, create the private `probe-host.allow` file with the
   exact bare Site B hostname only, mode `0600`. Place the reviewed
   `hostinger-probe-caller.php` beside `https-probe.key`, mode `0600`. In Site
   A → Advanced → Cron Jobs, create one temporary custom job scheduled every
   five minutes. Use “View Output” from the Cron Jobs list; no SSH is needed.
   First set its command to:

   ```sh
   php -l /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php
   ```

   Expected: `No syntax errors detected`. If hPanel does not expose the cron
   output, stop; do not proceed without syntax evidence.
4. Edit the same cron entry's command to:

   ```sh
   php /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php auth-suite
   ```

   Allow up to three five-minute executions (15 minutes), then inspect output.
   Each run performs valid HMAC (`200`), invalid signature (`401`), stale
   timestamp (`401`), missing authentication headers (`401`), and exact replay
   (`200`, then `409`). The suite returns only case labels, HTTP statuses, and
   durations. Stop if results differ.
5. For the missing-key test, change only Site B's key-file environment setting
   to a nonexistent path and restart Site B. Require `/healthz` to report
   `keyAvailable: false`. Edit the same cron command to:

   ```sh
   php /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php missing-key
   ```

   Wait for one five-minute execution; expected status is `503`. Restore the
   original private path, apply the change, and restart Site B only if hPanel
   does not restart it automatically. Require `keyAvailable: true` before
   proceeding. Never move, display, or copy the key.
6. Edit the job command to:

   ```sh
   php /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php delay-suite
   ```

   Wait for one run. It starts five individually signed POSTs concurrently for
   5, 30, 60, 90, and 120 seconds, recording each HTTP status/duration and
   exercising overlap. Expect `200` for each request that completes. The PHP
   cURL multi extension is required; if unavailable, output reports
   `curl_multi_unavailable` and overlap/duration suite is unqualified. The
   caller's 135-second timeout is not a Hostinger limit. If requests are killed
   or output is truncated, stop and report the longest completed request; do
   not claim a 90-second ceiling or guarantee.
7. To observe interruption, set the same job command to:

   ```sh
   php /home/u564997839/lvtchat-cron-probe/hostinger-probe-caller.php delay-90
   ```

   Watch Site B's runtime logs in hPanel; use the Site B Restart control only
   while a request-start event is visible. The probe may return `503` after its
   five-second graceful-shutdown window; Hostinger may instead terminate it
   externally. If request start cannot be observed in time, leave the process
   alone and report interruption as unmeasured. Remove the cron entry after
   this phase.
8. Save sanitized evidence: Site B hostname, Node version, boolean key
   availability, case, HTTP status, duration, observed cron times, maximum
   active requests, RSS/heap snapshots, and interruption outcome. Exclude key
   contents, signatures, nonces, headers, response bodies, environment values,
   customer data, and credentials. Do not capture hPanel secret settings.

### Stop, cleanup, and evidence limits

Stop immediately on any unexpected target, key access, authentication, TLS,
logging, or process behavior. Delete the cron entry first. Restore Site B's
original key path if changed, then remove only the newly created Site B after
checking its identity; Hostinger warns website removal deletes its associated
files/configuration. Remove only the newly created caller/allowlist if no
longer needed. Preserve Site A, its cron configuration, key, and pre-existing
test files. Verify `lvtchat.com` and production configuration are untouched and
the production worker remains disabled.

This session uses no production Supabase, paid providers, customer workflows,
or production route. The probe's nonce cache is process-local and does not
qualify production's durable PostgreSQL replay protection. Local tests cover
the package/HMAC contract; Hostinger key visibility, cURL availability, HTTPS
delivery, time limits (including 90 seconds), overlap, and process termination
remain unmeasured until this owner-run session completes.

### Local repeatability

```sh
./node_modules/.bin/vitest run tests/unit/hostinger-probe-runtime.test.ts tests/unit/execution-trigger.test.ts
```

The opt-in PostgreSQL trigger tests use only the documented disposable loopback
database URL/port. Never point them at production or staging.
