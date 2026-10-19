#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Applies only the marketing lead migration to a new, disposable local
# Supabase PostgreSQL container, then runs its database-backed tests.
readonly IMAGE="public.ecr.aws/supabase/postgres:17.11.0.002"
readonly HOST_PORT="57381"
readonly MIGRATION="supabase/migrations/20261019120000_create_private_marketing_lead_capture.sql"
readonly TEST_FILE="tests/integration/marketing-leads-postgres.test.ts"
readonly EXPECTED_TESTS="5"

repo="$(git rev-parse --show-toplevel)"
cd "$repo"

if [[ ! -x "$repo/node_modules/.bin/vitest" ]]; then
  echo "STOP: repository-local Vitest is unavailable." >&2
  exit 1
fi
if [[ ! -f "$MIGRATION" || ! -f "$TEST_FILE" ]]; then
  echo "STOP: marketing migration or database test file is missing." >&2
  exit 1
fi
if [[ "$(grep -Ec '^[[:space:]]*it\(' "$TEST_FILE" || true)" -ne "$EXPECTED_TESTS" ]]; then
  echo "STOP: marketing PostgreSQL test inventory changed; review before qualification." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "STOP: Docker daemon is unavailable to this terminal." >&2
  exit 1
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "STOP: required cached Supabase PostgreSQL 17.11 image is unavailable; this script will not pull it." >&2
  exit 1
fi

node - "$HOST_PORT" <<'NODE'
const net = require("node:net");
const port = Number(process.argv[2]);
const server = net.createServer();
server.once("error", (error) => {
  console.error(`STOP: 127.0.0.1:${port} is unavailable (${error.code || "bind failure"}).`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => server.close(() => process.exit(0)));
NODE

suffix="$(date +%s)-$$-$RANDOM"
container="lvt-marketing-pg-$suffix"
network="lvt-marketing-net-$suffix"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/lvt-marketing-pg.XXXXXX")"
chmod 700 "$workdir"
local_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
database_url="postgresql://postgres:${local_password}@127.0.0.1:${HOST_PORT}/postgres"

cleanup() {
  status=$?
  trap - EXIT
  cleanup_failed=0
  if docker container inspect "$container" >/dev/null 2>&1; then
    if ! docker rm -fv "$container" >/dev/null; then
      echo "CLEANUP ERROR: could not remove this run's disposable container and anonymous volume." >&2
      cleanup_failed=1
    fi
  fi
  if docker network inspect "$network" >/dev/null 2>&1; then
    if ! docker network rm "$network" >/dev/null; then
      echo "CLEANUP ERROR: could not remove this run's disposable network." >&2
      cleanup_failed=1
    fi
  fi
  if [[ -n "$workdir" && -d "$workdir" ]] && ! rm -rf -- "$workdir"; then
    echo "CLEANUP ERROR: could not remove this run's temporary files." >&2
    cleanup_failed=1
  fi
  unset local_password database_url
  if [[ "$cleanup_failed" -eq 0 ]]; then
    echo "Cleanup: this run's container, anonymous volume, network, and temporary files removed."
  elif [[ "$status" -eq 0 ]]; then
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if docker container inspect "$container" >/dev/null 2>&1 || docker network inspect "$network" >/dev/null 2>&1; then
  echo "STOP: generated disposable resource name unexpectedly already exists." >&2
  exit 1
fi

docker network create "$network" >/dev/null
network_config="$(docker network inspect --format '{{.Driver}}|{{.Internal}}' "$network")"
if [[ "$network_config" != "bridge|false" ]]; then
  echo "STOP: test network is not a standard disposable Docker bridge." >&2
  exit 1
fi

docker run -d \
  --name "$container" \
  --network "$network" \
  --publish "127.0.0.1:${HOST_PORT}:5432/tcp" \
  --cpus=1 \
  --memory=2g \
  --memory-swap=2g \
  --pids-limit=256 \
  --env "POSTGRES_PASSWORD=${local_password}" \
  --env POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

published="$(docker port "$container" 5432/tcp)"
if [[ "$published" != "127.0.0.1:${HOST_PORT}" ]]; then
  echo "STOP: unexpected PostgreSQL port binding: $published" >&2
  exit 1
fi
published_inspect="$(docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{printf "%s:%s->%s\n" .HostIp .HostPort $port}}{{end}}{{end}}' "$container")"
if [[ "$published_inspect" != "127.0.0.1:${HOST_PORT}->5432/tcp" ]]; then
  echo "STOP: unexpected inspected PostgreSQL port binding: $published_inspect" >&2
  exit 1
fi
resource_limits="$(docker inspect --format '{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.PidsLimit}}' "$container")"
if [[ "$resource_limits" != "1000000000|2147483648|2147483648|256" ]]; then
  echo "STOP: disposable container resource limits differ from the required bounds: $resource_limits" >&2
  exit 1
fi
echo "Disposable target: cached Supabase PG17.11; only 127.0.0.1:${HOST_PORT} published; CPU 1, memory/swap 2 GiB, PID 256."

ready=0
for second in $(seq 1 180); do
  running="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)"
  if [[ "$running" != "true" ]]; then
    echo "STOP: PostgreSQL exited during initialization. Startup logs follow:" >&2
    docker logs "$container" 2>&1 || true
    exit 1
  fi
  if docker exec "$container" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "STOP: PostgreSQL did not become ready within 180 seconds. Startup logs follow:" >&2
  docker logs "$container" 2>&1 || true
  exit 1
fi

role_count="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','supabase_admin','anon','authenticated','service_role');")"
if [[ "$role_count" != "5" ]]; then
  echo "STOP: required Supabase PostgreSQL roles are incomplete (found $role_count of 5)." >&2
  exit 1
fi
preflight="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT (to_regnamespace('public') IS NOT NULL AND to_regclass('public.marketing_leads') IS NULL AND to_regclass('public.marketing_lead_rate_limits') IS NULL AND to_regprocedure('public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)') IS NULL)::text;")"
if [[ "$preflight" != "true" ]]; then
  echo "STOP: target is not a fresh empty database for this one migration." >&2
  exit 1
fi
echo "PostgreSQL ready; Supabase roles present; target has no pre-existing marketing objects."

migration_sha_before="$(sha256sum "$MIGRATION" | awk '{print $1}')"
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$MIGRATION"
migration_sha_after="$(sha256sum "$MIGRATION" | awk '{print $1}')"
if [[ "$migration_sha_before" != "$migration_sha_after" ]]; then
  echo "STOP: tracked migration content changed during qualification." >&2
  exit 1
fi

export MARKETING_LEADS_DATABASE_INTEGRATION_TESTS=true
export MARKETING_LEADS_TEST_DATABASE_URL="$database_url"
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_ID
unset NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CAPA_DATABASE_URL DATABASE_URL

results="$workdir/vitest-results.json"
"$repo/node_modules/.bin/vitest" run "$TEST_FILE" \
  --no-file-parallelism \
  --reporter=json \
  --outputFile="$results"

node - "$results" "$EXPECTED_TESTS" <<'NODE'
const fs = require("node:fs");
const [file, expectedText] = process.argv.slice(2);
const expected = Number(expectedText);
const result = JSON.parse(fs.readFileSync(file, "utf8"));
const counts = {
  total: result.numTotalTests,
  passed: result.numPassedTests,
  failed: result.numFailedTests,
  pending: result.numPendingTests,
  todo: result.numTodoTests,
};
console.log(`PostgreSQL tests: ${counts.passed}/${counts.total} passed; ${counts.failed} failed; ${counts.pending} skipped/pending; ${counts.todo} todo.`);
if (counts.total !== expected || counts.passed !== expected || counts.failed !== 0 || counts.pending !== 0 || counts.todo !== 0) {
  console.error("STOP: expected every marketing PostgreSQL test to execute and pass with no skips.");
  process.exit(1);
}
NODE

echo "QUALIFICATION PASS: all ${EXPECTED_TESTS} marketing PostgreSQL integration tests passed with zero skips."
