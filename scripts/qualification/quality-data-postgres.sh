#!/usr/bin/env bash
set -Eeuo pipefail

# Disposable PostgreSQL qualification for the Layer 2 quality-data services.
#
# The fixture deliberately avoids replaying the repository's unrelated
# historical migration chain. It applies the real CAPA foundation migration
# (which provides the role, membership, audit, auth.uid()-based RLS helpers,
# policies, and grants exercised by the tests), followed by the real quality
# data migrations in dependency order. Supabase's cached PG image supplies
# the standard Postgres roles and auth.uid(); the Storage catalog tables and
# two prerequisite private buckets are minimal synthetic fixture objects.
#
# Stage 3B default:
#   scripts/qualification/quality-data-postgres.sh
#
# Future quality-data stages may reuse the fixture by setting, for example:
#   QUALITY_DATA_PG_TEST_FILES="tests/integration/a.test.ts tests/integration/b.test.ts" \
#   QUALITY_DATA_PG_EXPECTED_TESTS=17 \
#   scripts/qualification/quality-data-postgres.sh

readonly EXPECTED_HEAD="17b4a7b204a166418f93c60b57eafb075f653795"
readonly IMAGE="public.ecr.aws/supabase/postgres:17.11.0.002"
readonly HOST_PORT="57381"
readonly DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:57381/postgres"
readonly CLI_DATABASE_URL="${DATABASE_URL}?sslmode=disable"
readonly DEFAULT_TEST_FILES="tests/integration/quality-data-stage3a-postgres.test.ts"
readonly DEFAULT_EXPECTED_TESTS="11"
readonly ALLOWED_UNTRACKED_MIGRATIONS=("20261018110000_quality_data_external_ai_interpretation.sql")

repo="$(git rev-parse --show-toplevel)"
cd "$repo"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "STOP: expected branch main." >&2
  exit 1
fi
if [[ "$(git rev-parse HEAD)" != "$EXPECTED_HEAD" ]]; then
  echo "STOP: HEAD does not match the qualified Stage 3B baseline." >&2
  exit 1
fi
if ! git diff --quiet "$EXPECTED_HEAD" -- supabase/migrations; then
  echo "STOP: tracked migration files differ from the baseline." >&2
  exit 1
fi
actual_untracked_migrations="$(git ls-files --others --exclude-standard -- supabase/migrations | sed 's#^supabase/migrations/##' | sort)"
expected_untracked_migrations="$(printf '%s\n' "${ALLOWED_UNTRACKED_MIGRATIONS[@]}" | sort)"
if [[ "$actual_untracked_migrations" != "$expected_untracked_migrations" ]]; then
  echo "STOP: untracked migration files differ from this Stage 3C fixture allowlist." >&2
  exit 1
fi

readonly MIGRATIONS=(
  "20260812160000_create_capa_foundation.sql"
  "20261016110000_create_quality_data_foundation.sql"
  "20261017100000_create_quality_data_source_bucket.sql"
  "20261017110000_add_quality_data_xlsx_api_rate_limit.sql"
  "20261018100000_quality_data_analytical_approval.sql"
  "20261018110000_quality_data_external_ai_interpretation.sql"
)
for migration in "${MIGRATIONS[@]}"; do
  if [[ ! -f "$repo/supabase/migrations/$migration" ]]; then
    echo "STOP: required migration is missing: $migration" >&2
    exit 1
  fi
done

test_files_string="${QUALITY_DATA_PG_TEST_FILES:-$DEFAULT_TEST_FILES}"
expected_tests="${QUALITY_DATA_PG_EXPECTED_TESTS:-$DEFAULT_EXPECTED_TESTS}"
read -r -a test_files <<< "$test_files_string"
if [[ "${#test_files[@]}" -eq 0 || ! "$expected_tests" =~ ^[0-9]+$ || "$expected_tests" -eq 0 ]]; then
  echo "STOP: test files and expected test count must be nonempty and valid." >&2
  exit 1
fi

declared_test_total=0
for test_file in "${test_files[@]}"; do
  if [[ "$test_file" == /* || "$test_file" == *".."* || ! -f "$repo/$test_file" ]]; then
    echo "STOP: test path must be an existing repository-relative file: $test_file" >&2
    exit 1
  fi
  declared_count="$(grep -Ec '^[[:space:]]*it\(' "$repo/$test_file" || true)"
  declared_test_total=$((declared_test_total + declared_count))
done
if [[ "$declared_test_total" -ne "$expected_tests" ]]; then
  echo "STOP: configured test files declare $declared_test_total tests, expected $expected_tests." >&2
  exit 1
fi

if [[ ! -x "$repo/node_modules/.bin/supabase" || ! -x "$repo/node_modules/.bin/vitest" ]]; then
  echo "STOP: repository-local Supabase CLI or Vitest is unavailable." >&2
  exit 1
fi
version_home="$(mktemp -d "${TMPDIR:-/tmp}/lvt-quality-cli-version.XXXXXX")"
chmod 700 "$version_home"
mkdir -m 700 -p "$version_home/.config"
if ! supabase_version="$(HOME="$version_home" XDG_CONFIG_HOME="$version_home/.config" SUPABASE_TELEMETRY_DISABLED=1 "$repo/node_modules/.bin/supabase" --version)"; then
  rm -rf -- "$version_home"
  echo "STOP: repository-local Supabase CLI version check failed." >&2
  exit 1
fi
rm -rf -- "$version_home"
if [[ "$supabase_version" != "2.115.0" ]]; then
  echo "STOP: expected repository-pinned Supabase CLI 2.115.0; found $supabase_version." >&2
  exit 1
fi
if ! docker info >/dev/null; then
  echo "STOP: Docker daemon is unavailable." >&2
  exit 1
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "STOP: required cached image is unavailable; this script will not pull it." >&2
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
container="lvt-quality-pg-$suffix"
network="lvt-quality-net-$suffix"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/lvt-quality-postgres.XXXXXX")"
chmod 700 "$workdir"

cleanup() {
  status=$?
  trap - EXIT
  cleanup_failed=0

  if docker container inspect "$container" >/dev/null 2>&1; then
    if ! docker rm -f "$container" >/dev/null; then
      echo "CLEANUP ERROR: could not remove this run's disposable container." >&2
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
    echo "CLEANUP ERROR: could not remove this run's temporary directory." >&2
    cleanup_failed=1
  fi

  if [[ "$cleanup_failed" -eq 0 ]]; then
    echo "Cleanup: this run's container, network, and temporary files removed."
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

# A private temporary HOME prevents the CLI from seeing the owner's saved auth.
export HOME="$workdir/home"
export XDG_CONFIG_HOME="$HOME/.config"
export SUPABASE_TELEMETRY_DISABLED=1
export CI=1
export NO_COLOR=1
mkdir -m 700 -p "$HOME" "$XDG_CONFIG_HOME"
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_ID

project="$workdir/project"
mkdir -m 700 -p "$project/supabase/migrations"
cp "$repo/supabase/config.toml" "$project/supabase/config.toml"
expected_versions="$workdir/expected-versions.txt"
for migration in "${MIGRATIONS[@]}"; do
  cp "$repo/supabase/migrations/$migration" "$project/supabase/migrations/$migration"
  printf '%s\n' "${migration%%_*}" >> "$expected_versions"
done
sort -u -o "$expected_versions" "$expected_versions"

storage_fixture="$workdir/storage-fixture.sql"
cat > "$storage_fixture" <<'SQL'
-- Synthetic Storage catalog only; no Storage service or customer objects.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  bucket_id text NOT NULL,
  name text NOT NULL
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'documents', 'documents', false, 10485760,
    ARRAY[
      'text/plain', 'text/markdown', 'text/csv', 'application/csv', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  ),
  (
    'chat-images', 'chat-images', false, 52428800,
    ARRAY['image/png', 'image/jpeg', 'image/webp']
  )
ON CONFLICT (id) DO NOTHING;

DO $fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'documents' AND name = 'documents' AND public = false
      AND file_size_limit >= 10485760 AND allowed_mime_types IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Synthetic documents Storage bucket prerequisite is invalid.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'chat-images' AND name = 'chat-images' AND public = false
  ) THEN
    RAISE EXCEPTION 'Synthetic chat-images Storage bucket prerequisite is invalid.';
  END IF;
END
$fixture$;
SQL
chmod 600 "$storage_fixture"

docker network create "$network" >/dev/null
network_config="$(docker network inspect --format '{{.Driver}}|{{.Internal}}' "$network")"
if [[ "$network_config" != "bridge|false" ]]; then
  echo "STOP: disposable network is not a normal Docker bridge." >&2
  exit 1
fi

docker run -d \
  --name "$container" \
  --network "$network" \
  --publish 127.0.0.1:57381:5432/tcp \
  --cpus=1 \
  --memory=2g \
  --memory-swap=2g \
  --pids-limit=256 \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

published="$(docker port "$container" 5432/tcp)"
if [[ "$published" != "127.0.0.1:57381" ]]; then
  echo "STOP: unexpected PostgreSQL Docker port binding: $published" >&2
  exit 1
fi
published_inspect="$(docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{printf "%s:%s->%s\n" .HostIp .HostPort $port}}{{end}}{{end}}' "$container")"
if [[ "$published_inspect" != "127.0.0.1:57381->5432/tcp" ]]; then
  echo "STOP: unexpected inspected port binding: $published_inspect" >&2
  exit 1
fi
resource_limits="$(docker inspect --format '{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.PidsLimit}}' "$container")"
if [[ "$resource_limits" != "1000000000|2147483648|2147483648|256" ]]; then
  echo "STOP: container resource limits differ from approved bounds: $resource_limits" >&2
  exit 1
fi
echo "Disposable target: cached PG17.11; bridge network; only 127.0.0.1:57381 published; CPU 1, memory/swap 2 GiB, PID 256."

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
echo "PostgreSQL initialized and ready."

# Verify actual Supabase-provided roles/auth helpers before applying migrations.
role_count="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c "SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','supabase_admin','anon','authenticated','service_role');")"
if [[ "$role_count" != "5" ]]; then
  echo "STOP: required Supabase PostgreSQL roles are incomplete (found $role_count of 5)." >&2
  exit 1
fi
auth_ready="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c "SELECT (to_regnamespace('auth') IS NOT NULL AND to_regnamespace('extensions') IS NOT NULL AND to_regnamespace('storage') IS NOT NULL AND to_regprocedure('auth.uid()') IS NOT NULL)::text;")"
if [[ "$auth_ready" != "true" ]]; then
  echo "STOP: required auth/extensions/storage schemas or auth.uid() are absent from the cached Supabase image." >&2
  exit 1
fi
echo "Supabase role and auth.uid() prerequisites verified."

# This exact grant and its verification apply only inside this new disposable container.
if ! docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c 'GRANT CREATE ON SCHEMA storage TO postgres;'
then
  echo "STOP: disposable-fixture storage grant failed; see the exact PostgreSQL error above." >&2
  exit 1
fi
storage_create="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  -c "SELECT has_schema_privilege('postgres', 'storage', 'CREATE');")"
if [[ "$storage_create" != "t" ]]; then
  echo "STOP: postgres lacks CREATE on the disposable storage schema (result: $storage_create)." >&2
  exit 1
fi
echo "Verified: postgres has CREATE on schema storage in the disposable container only."

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$storage_fixture"

# PGSSLMODE is scoped to this Supabase CLI process. The URL remains loopback-only.
if ! (
  cd "$project"
  PGSSLMODE=disable "$repo/node_modules/.bin/supabase" db push \
    --db-url "$CLI_DATABASE_URL" \
    --include-all \
    --skip-vault \
    --yes
); then
  echo "STOP: dependency-scoped disposable migration push failed. Do not replay unrelated migrations; inspect the failing selected migration and error." >&2
  exit 1
fi

applied_versions="$workdir/applied-versions.txt"
docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;" \
  | sed '/^[[:space:]]*$/d' | sort -u > "$applied_versions"
if ! diff -u "$expected_versions" "$applied_versions"; then
  echo "STOP: selected migration files and disposable migration ledger differ." >&2
  exit 1
fi
echo "Migration ledger verified: exactly the six dependency-scoped migrations were applied."

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'quality-data-sources'
      AND name = 'quality-data-sources'
      AND public = false
      AND file_size_limit = 10485760
      AND allowed_mime_types = ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ) THEN
    RAISE EXCEPTION 'Quality-data Storage bucket postflight failed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'storage.objects'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Storage objects RLS postflight failed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'quality_data_source_objects_server_only'
      AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'Quality-data Storage privacy policy postflight failed.';
  END IF;
END
$postflight$;
SQL
echo "Storage migration postflight: private bucket, RLS, and restrictive server-only policy verified."

log_file="$workdir/vitest.log"
QUALITY_DATA_DATABASE_INTEGRATION_TESTS=true \
QUALITY_DATA_TEST_DATABASE_URL="$DATABASE_URL" \
  "$repo/node_modules/.bin/vitest" run "${test_files[@]}" --reporter=verbose \
  2>&1 | tee "$log_file"

if ! grep -Eq "^[[:space:]]*Tests[[:space:]]+$expected_tests passed[[:space:]]+\\($expected_tests\\)[[:space:]]*$" "$log_file"; then
  echo "STOP: Vitest did not report exactly $expected_tests passed tests with zero skips." >&2
  exit 1
fi
echo "QUALIFICATION PASS: all $expected_tests PostgreSQL integration tests passed; zero skipped."
