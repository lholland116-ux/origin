#!/usr/bin/env bash
set -Eeuo pipefail

# Focused disposable PostgreSQL qualification for the audited demonstration
# organization provisioning RPC. The container has no published host ports and
# runs on a per-run Docker bridge. It applies only the CAPA schema prerequisites
# and the real provisioning migrations used by these tests.

readonly EXPECTED_HEAD="224df69"
readonly IMAGE="public.ecr.aws/supabase/postgres:17.11.0.002"
readonly MIGRATIONS=(
  "20260812160000_create_capa_foundation.sql"
  "20260819180000_create_capa_organization_provisioning.sql"
  "20261021100000_audited_capa_demo_organization_provisioning.sql"
)
readonly TEST_FILES=(
  "supabase/tests/capa_organization_provisioning_test.sql"
  "supabase/tests/capa_demo_organization_provisioning_test.sql"
)
readonly EXPECTED_TEST_COUNTS=(32 43)

repo="$(git rev-parse --show-toplevel)"
cd "$repo"

if [[ "$(git branch --show-current)" != "main" || "$(git rev-parse --short HEAD)" != "$EXPECTED_HEAD" ]]; then
  echo "STOP: run this qualification from main at $EXPECTED_HEAD." >&2
  exit 1
fi
for file in "${MIGRATIONS[@]}" "${TEST_FILES[@]}"; do
  if [[ ! -f "$repo/supabase/migrations/$file" && ! -f "$repo/$file" ]]; then
    echo "STOP: required migration or test is missing: $file" >&2
    exit 1
  fi
done
if ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker daemon is unavailable to this process; no fixture was created." >&2
  exit 2
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "BLOCKED: cached PostgreSQL 17.11 Supabase image is unavailable; the script will not pull it." >&2
  exit 2
fi

suffix="$(date +%s)-$$-$RANDOM"
container="lvt-capa-demo-pg-$suffix"
network="lvt-capa-demo-net-$suffix"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/lvt-capa-demo-pg.XXXXXX")"
chmod 700 "$workdir"

cleanup() {
  status=$?
  trap - EXIT
  failed=0
  if docker container inspect "$container" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null || failed=1
  fi
  if docker network inspect "$network" >/dev/null 2>&1; then
    docker network rm "$network" >/dev/null || failed=1
  fi
  if [[ -d "$workdir" ]]; then
    rm -rf -- "$workdir" || failed=1
  fi
  if [[ "$failed" -eq 1 ]]; then
    echo "CLEANUP ERROR: remove only this run's disposable container/network/temp directory." >&2
    [[ "$status" -ne 0 ]] || status=1
  else
    echo "Cleanup: disposable container, network, and temporary files removed."
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if docker container inspect "$container" >/dev/null 2>&1 || docker network inspect "$network" >/dev/null 2>&1; then
  echo "STOP: generated disposable resource name already exists." >&2
  exit 1
fi

docker network create "$network" >/dev/null
network_config="$(docker network inspect --format '{{.Driver}}|{{.Internal}}' "$network")"
if [[ "$network_config" != "bridge|false" ]]; then
  echo "STOP: disposable network is not a standard Docker bridge." >&2
  exit 1
fi
docker run -d \
  --name "$container" \
  --network "$network" \
  --cpus=1 \
  --memory=2g \
  --memory-swap=2g \
  --pids-limit=256 \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

published="$(docker port "$container" 5432/tcp 2>/dev/null || true)"
if [[ -n "$published" ]]; then
  echo "STOP: the disposable database unexpectedly published a host port: $published" >&2
  exit 1
fi
network_mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")"
if [[ "$network_mode" != "$network" ]]; then
  echo "STOP: container is not attached only to its generated internal network." >&2
  exit 1
fi
echo "Disposable target verified: cached PG17.11, dedicated bridge, no published host ports."

ready=0
for _ in $(seq 1 180); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" != "true" ]]; then
    echo "STOP: disposable PostgreSQL exited during initialization; startup logs follow." >&2
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
  echo "STOP: PostgreSQL was not ready within 180 seconds; startup logs follow." >&2
  docker logs "$container" 2>&1 || true
  exit 1
fi

# This bootstrap exists only in the disposable test container. The PG image
# supplies PostgreSQL but may not include Supabase Auth's catalog. These
# deterministic helpers model PostgREST's request claim GUC interface for
# database authorization tests; they do NOT parse or verify signed JWTs and do
# NOT qualify Supabase Auth/PostgREST token signature validation.
auth_fixture="$workdir/auth-fixture.sql"
cat > "$auth_fixture" <<'SQL'
-- TEST FIXTURE ONLY: never copy these schema/table/helper definitions to a
-- production migration. No Supabase Auth service is running in this fixture.
-- Reuse the image-provided API roles; never CREATE or ALTER a protected role.
DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'anon'
      AND NOT rolcanlogin AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT rolbypassrls
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticated'
      AND NOT rolcanlogin AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT rolbypassrls
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'service_role'
      AND NOT rolcanlogin AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND rolbypassrls
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'supabase_admin' AND rolcanlogin
  ) THEN
    RAISE EXCEPTION 'DISPOSABLE_SUPABASE_ROLE_ATTRIBUTES_INVALID_OR_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS api_role ON api_role.oid = membership.member
    WHERE api_role.rolname IN ('anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'DISPOSABLE_SUPABASE_API_ROLE_MEMBERSHIP_REQUIRES_REVIEW';
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- Reuse the image's Auth catalog where available. Supply only absent objects.
SELECT
  helper.name AS auth_helper,
  helper.oid IS NOT NULL AS image_provided,
  COALESCE(pg_catalog.pg_get_functiondef(helper.oid) LIKE '%request.jwt.claim.sub%', false) AS reads_subject_setting,
  COALESCE(pg_catalog.pg_get_functiondef(helper.oid) LIKE '%request.jwt.claims%', false) AS reads_claims_setting
FROM (VALUES
  ('uid', to_regprocedure('auth.uid()')),
  ('jwt', to_regprocedure('auth.jwt()'))
) AS helper(name, oid);

-- Only the columns read or inserted by these SQL tests are represented when
-- auth.users is absent. No password verification is simulated here.
DO $auth_catalog$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    EXECUTE $users$
      CREATE TABLE auth.users (
        instance_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        id uuid PRIMARY KEY,
        aud text,
        role text,
        email text,
        encrypted_password text NOT NULL DEFAULT '',
        email_confirmed_at timestamptz,
        raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
      )
    $users$;
    EXECUTE 'REVOKE ALL ON TABLE auth.users FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE auth.users TO postgres';
  END IF;

  -- The cached PG image has a partial auth.users catalog. Supabase Auth's
  -- nullable confirmation timestamp is required by both synthetic user seeds.
  -- Add it only to this disposable database when the image omits it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.users'::regclass
      AND attname = 'email_confirmed_at'
      AND NOT attisdropped
  ) THEN
    EXECUTE 'ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.users'::regclass
      AND attname = 'email_confirmed_at'
      AND atttypid = 'timestamp with time zone'::regtype
      AND NOT attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'DISPOSABLE_AUTH_USERS_CONFIRMATION_COLUMN_INVALID';
  END IF;

  IF to_regprocedure('auth.jwt()') IS NULL THEN
    EXECUTE $jwt$
      CREATE FUNCTION auth.jwt()
      RETURNS jsonb
      LANGUAGE sql
      STABLE
      SET search_path = ''
      AS $auth_jwt$
        SELECT COALESCE(
          NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
          '{}'::jsonb
        );
      $auth_jwt$
    $jwt$;
    EXECUTE 'REVOKE ALL ON FUNCTION auth.jwt() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role, postgres';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $uid$
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SET search_path = ''
      AS $auth_uid$
        SELECT NULLIF(
          pg_catalog.current_setting('request.jwt.claim.sub', true), ''
        )::uuid;
      $auth_uid$
    $uid$;
    EXECUTE 'REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, postgres';
  END IF;
END
$auth_catalog$;

DO $fixture_check$
DECLARE
  v_claims jsonb := '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}'::jsonb;
  v_subject uuid := '30000000-0000-4000-8000-000000000003'::uuid;
  v_json_only_uid_matches boolean;
  v_json_only_aal_matches boolean;
  v_subject_setting_matches boolean;
  v_uid_matches boolean;
  v_aal_matches boolean;
BEGIN
  IF to_regclass('auth.users') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('auth.jwt()') IS NULL
    OR to_regnamespace('extensions') IS NULL
  THEN
    RAISE EXCEPTION 'DISPOSABLE_AUTH_CATALOG_FIXTURE_INCOMPLETE';
  END IF;
  IF has_table_privilege('anon', 'auth.users', 'SELECT')
    OR has_table_privilege('authenticated', 'auth.users', 'SELECT')
  THEN
    RAISE EXCEPTION 'DISPOSABLE_AUTH_USERS_TABLE_MUST_REMAIN_PRIVATE';
  END IF;
  IF NOT has_table_privilege('postgres', 'auth.users', 'SELECT')
    OR NOT has_table_privilege('postgres', 'auth.users', 'INSERT')
    OR NOT has_table_privilege('postgres', 'auth.users', 'UPDATE')
  THEN
    RAISE EXCEPTION 'DISPOSABLE_POSTGRES_ROLE_CANNOT_SEED_AUTH_FIXTURE';
  END IF;
  IF NOT has_function_privilege('anon', 'auth.uid()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'auth.uid()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'auth.jwt()', 'EXECUTE')
    OR NOT has_function_privilege('postgres', 'auth.uid()', 'EXECUTE')
    OR NOT has_function_privilege('postgres', 'auth.jwt()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'DISPOSABLE_AUTH_HELPER_GRANTS_INVALID';
  END IF;

  -- Probe the prior JSON-only setup without printing any claim or identity.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims::text, true);
  v_json_only_uid_matches := auth.uid() IS NOT DISTINCT FROM v_subject;
  v_json_only_aal_matches := (auth.jwt() ->> 'aal') IS NOT DISTINCT FROM 'aal2';
  RAISE NOTICE 'DISPOSABLE_AUTH_CLAIM_PROBE json_only_uid_matches=% json_only_aal_matches=% session_is_authenticated=%',
    v_json_only_uid_matches, v_json_only_aal_matches, current_user = 'authenticated';

  -- PostgREST supplies the subject setting separately from the claims JSON.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_subject::text, true);
  v_subject_setting_matches := pg_catalog.current_setting('request.jwt.claim.sub', true) IS NOT DISTINCT FROM v_subject::text;
  v_uid_matches := auth.uid() IS NOT DISTINCT FROM v_subject;
  v_aal_matches := (auth.jwt() ->> 'aal') IS NOT DISTINCT FROM 'aal2';
  RAISE NOTICE 'DISPOSABLE_AUTH_CLAIM_CHECK subject_setting_matches=% uid_matches=% aal_matches=% session_is_admin=%',
    v_subject_setting_matches, v_uid_matches, v_aal_matches, current_user = 'supabase_admin';
  IF NOT v_subject_setting_matches OR NOT v_uid_matches OR NOT v_aal_matches THEN
    RAISE EXCEPTION 'DISPOSABLE_AUTH_HELPER_CLAIM_SEMANTICS_INVALID';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL OR auth.jwt() IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'DISPOSABLE_AUTH_HELPER_EMPTY_CONTEXT_INVALID';
  END IF;
END
$fixture_check$;
SQL
chmod 600 "$auth_fixture"

docker exec -i "$container" psql -X -A -F '|' -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
SELECT
  api_role.rolname,
  api_role.rolsuper,
  api_role.rolbypassrls,
  api_role.rolcanlogin,
  api_role.rolinherit,
  api_role.rolcreatedb,
  api_role.rolcreaterole,
  api_role.rolreplication,
  (
    SELECT count(*)
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.member = api_role.oid
  ) AS direct_memberships
FROM pg_catalog.pg_roles AS api_role
WHERE api_role.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY api_role.rolname;
SQL
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$auth_fixture"
echo "Disposable Auth fixture verified: existing anon/authenticated/service_role roles have expected restricted attributes and no inherited role memberships; auth.users access and auth.uid()/auth.jwt() claim behavior are valid."
echo "Qualification boundary: request.jwt.claims is a simulated database GUC; this fixture does not validate signed JWTs, AAL issuance, Supabase Auth, or PostgREST." >&2

pgtap_available="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pgtap');")"
if [[ "$pgtap_available" != "t" ]]; then
  echo "STOP: the cached disposable PostgreSQL image does not provide the pgtap extension required by the 75 SQL assertions." >&2
  exit 1
fi
echo "Disposable test prerequisite verified: pgtap is available."

for migration in "${MIGRATIONS[@]}"; do
  migration_path="$repo/supabase/migrations/$migration"
  echo "Applying disposable prerequisite: $migration"
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$migration_path" >/dev/null
done

total_passed=0
for index in "${!TEST_FILES[@]}"; do
  test_file="${TEST_FILES[$index]}"
  expected="${EXPECTED_TEST_COUNTS[$index]}"
  test_log="$workdir/$(basename "$test_file").log"
  docker exec -i "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres < "$repo/$test_file" >"$test_log"
  passed="$(grep -Ec '^ok [0-9]+' "$test_log" || true)"
  if [[ "$passed" -ne "$expected" ]] \
    || grep -q '^not ok ' "$test_log" \
    || grep -Eiq '^ok [0-9]+.*#[[:space:]]*(SKIP|TODO)([[:space:]]|$)' "$test_log" \
    || ! grep -q "^1\.\.$expected$" "$test_log"; then
    echo "FAIL: $test_file did not report $expected passing assertions with zero skips." >&2
    cat "$test_log" >&2
    exit 1
  fi
  total_passed=$((total_passed + passed))
  echo "PASS: $test_file $passed/$expected; zero failures."
done

echo "PASS: $total_passed/75 PostgreSQL assertions; zero failures."
