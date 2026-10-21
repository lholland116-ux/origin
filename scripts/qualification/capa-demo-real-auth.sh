#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# One-run local Supabase Auth/PostgREST qualification. No source .env.local,
# linked project state, production credentials, or production endpoint is used.
repo="$(git rev-parse --show-toplevel)"
cd "$repo"
if [[ "$(git branch --show-current)" != "main" || "$(git rev-parse --short HEAD)" != "224df69" ]]; then
  echo 'STOP: expected main at 224df69.' >&2
  exit 1
fi
if [[ "$(node_modules/.bin/supabase --version 2>/dev/null)" != "2.115.0" ]]; then
  echo 'STOP: pinned Supabase CLI 2.115.0 is required.' >&2
  exit 1
fi
if [[ "$(node --version)" != v24.* ]]; then
  echo 'STOP: Node.js 24 is required.' >&2
  exit 1
fi
for name in \
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEY \
  SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_ID SUPABASE_PROJECT_REF \
  DATABASE_URL POSTGRES_URL OPENAI_API_KEY; do
  if [[ -n "${!name:-}" ]]; then
    echo "STOP: inherited $name must be unset before isolated qualification." >&2
    exit 1
  fi
done
if ! docker info >/dev/null 2>&1; then
  echo 'BLOCKED: Docker is unavailable; no disposable resources were created.' >&2
  exit 2
fi
if ! command -v ss >/dev/null || ! command -v python3 >/dev/null || ! command -v timeout >/dev/null; then
  echo 'STOP: ss, python3, and timeout are required for network and fixture checks.' >&2
  exit 1
fi
for file in \
  supabase/migrations/20260812160000_create_capa_foundation.sql \
  supabase/migrations/20260819180000_create_capa_organization_provisioning.sql \
  supabase/migrations/20261021100000_audited_capa_demo_organization_provisioning.sql \
  scripts/qualification/capa-demo-real-auth.mjs; do
  [[ -f "$file" ]] || { echo 'STOP: required local qualification file is absent.' >&2; exit 1; }
done

project="lvt-capa-auth-$(date +%s)-$$-$RANDOM"
network="$project-net"
workdir="$(mktemp -d /tmp/lvt-capa-auth.XXXXXX)"
chmod 700 "$workdir"
mkdir -m 700 "$workdir/home"
isolated_supabase() {
  timeout 240 env HOME="$workdir/home" XDG_CONFIG_HOME="$workdir/home/.config" \
    SUPABASE_TELEMETRY_DISABLED=1 "$repo/node_modules/.bin/supabase" "$@"
}
started=0
network_created=0
cleanup() {
  status=$?
  trap - EXIT
  failed=0
  if [[ "$started" -eq 1 ]]; then
    isolated_supabase stop --project-id "$project" --no-backup --workdir "$workdir" >"$workdir/stop.log" 2>&1 || failed=1
  fi
  if [[ "$network_created" -eq 1 ]]; then
    docker network rm "$network" >/dev/null 2>&1 || failed=1
  fi
  if [[ -d "$workdir" && "$workdir" == /tmp/lvt-capa-auth.* ]]; then
    rm -rf -- "$workdir" || failed=1
  fi
  if [[ "$failed" -eq 1 ]]; then
    echo 'CLEANUP ERROR: inspect only this run’s disposable Supabase containers, network, and temporary directory.' >&2
    [[ "$status" -ne 0 ]] || status=1
  else
    echo 'Cleanup: this run’s disposable containers, volumes, network, and temporary files removed.'
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 700 "$workdir/supabase" "$workdir/supabase/migrations"
cp "$repo/supabase/config.toml" "$workdir/supabase/config.toml"
for migration in \
  20260812160000_create_capa_foundation.sql \
  20260819180000_create_capa_organization_provisioning.sql \
  20261021100000_audited_capa_demo_organization_provisioning.sql; do
  cp "$repo/supabase/migrations/$migration" "$workdir/supabase/migrations/$migration"
done
: > "$workdir/supabase/seed.sql"
chmod 600 "$workdir/supabase/config.toml" "$workdir/supabase/seed.sql" "$workdir/supabase/migrations/"*.sql
CAPA_DEMO_DISPOSABLE_PROJECT_ID="$project" python3 - "$workdir/supabase/config.toml" <<'PY'
import os, pathlib, re, sys
path = pathlib.Path(sys.argv[1])
config = path.read_text()
for old, new in [
    ('project_id = "openai-next-starter"', f'project_id = "{os.environ["CAPA_DEMO_DISPOSABLE_PROJECT_ID"]}"'),
    ('jwt_expiry = 3600', 'jwt_expiry = 120'),
]:
    if config.count(old) != 1: raise SystemExit('STOP: disposable config contract changed.')
    config = config.replace(old, new, 1)
for old, new in [
    ('port = 54321', 'port = 58321'),
    ('port = 54322', 'port = 58322'),
    ('shadow_port = 54320', 'shadow_port = 58320'),
    ('port = 54329', 'port = 58329'),
    ('port = 54323', 'port = 58323'),
    ('port = 54324', 'port = 58324'),
    ('port = 54327', 'port = 58327'),
    ('site_url = "http://127.0.0.1:3000"', 'site_url = "http://127.0.0.1:58300"'),
    ('additional_redirect_urls = ["https://127.0.0.1:3000"]',
     'additional_redirect_urls = ["https://127.0.0.1:58300"]'),
]:
    pattern = rf'(?m)^{re.escape(old)}$'
    config, count = re.subn(pattern, new, config)
    if count != 1: raise SystemExit('STOP: disposable port config contract changed.')
pattern = r'(\[auth\.mfa\.totp\]\n)(enroll_enabled = false\n)(verify_enabled = false)'
config, count = re.subn(pattern, r'\1enroll_enabled = true\nverify_enabled = true', config)
if count != 1: raise SystemExit('STOP: disposable TOTP config contract changed.')
path.write_text(config)
PY
if [[ -e "$workdir/.env.local" || -e "$workdir/supabase/.temp/project-ref" ]]; then
  echo 'STOP: disposable project contains an environment or production link file.' >&2
  exit 1
fi

docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$network" >/dev/null
network_created=1
if [[ "$(docker network inspect --format '{{.Driver}}|{{.Internal}}|{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}' "$network")" != 'bridge|false|127.0.0.1' ]]; then
  echo 'STOP: the disposable Docker network is not loopback-bound.' >&2
  exit 1
fi
listeners="$(ss -ltnH)" || { echo 'STOP: host listener inspection failed.' >&2; exit 1; }
for port in 58300 58320 58321 58322 58323 58324 58327 58329; do
  if printf '%s\n' "$listeners" | awk -v port=":$port" '$4 ~ port"$" { found=1 } END { exit !found }'; then
    echo 'STOP: a reserved disposable Supabase port is already in use.' >&2
    exit 1
  fi
done
running_ids="$(docker ps --format '{{.ID}}')" || { echo 'STOP: Docker container inventory failed.' >&2; exit 1; }
if [[ -n "$running_ids" ]]; then
  mapfile -t existing_containers <<< "$running_ids"
  docker inspect --format '{"name":{{json .Name}},"ports":{{json .NetworkSettings.Ports}}}' "${existing_containers[@]}" | node -e '
    let raw="";process.stdin.on("data",chunk=>raw+=chunk).on("end",()=>{
      const reserved=new Set(["58300","58320","58321","58322","58323","58324","58327","58329"]);
      let conflict=false;
      for(const line of raw.trim().split("\n")){
        const container=JSON.parse(line);
        for(const bindings of Object.values(container.ports||{})){
          for(const binding of bindings||[]){
            if(reserved.has(binding.HostPort))conflict=true;
            if(binding.HostIp==="0.0.0.0"||binding.HostIp==="::"){
              process.stdout.write(`EXISTING_WILDCARD_BINDING ${container.name.replace(/^\//,"")} ${binding.HostIp}:${binding.HostPort}\n`);
            }
          }
        }
      }
      process.exit(conflict?1:0);
    });
  ' || { echo 'STOP: an existing container publishes a reserved disposable port.' >&2; exit 1; }
fi

# Supabase CLI output can contain disposable keys; keep it private and delete it.
started=1
cd "$workdir"
if ! isolated_supabase start --yes --workdir "$workdir" --network-id "$network" \
  --exclude studio,realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta \
  >"$workdir/start.log" 2>&1; then
  echo 'STOP: disposable Supabase startup failed; private startup output was not printed.' >&2
  exit 1
fi

mapfile -t containers < <(docker ps --filter "network=$network" --format '{{.ID}}')
mapfile -t project_containers < <(docker ps --format '{{.ID}} {{.Names}}' | awk -v project="$project" 'index($2, project) { print $1 }')
if [[ "${#containers[@]}" -lt 3 || "${#containers[@]}" -ne "${#project_containers[@]}" ]]; then
  echo 'STOP: expected isolated Auth, PostgREST, and PostgreSQL services were not all present.' >&2
  exit 1
fi
docker inspect --format '{"networkMode":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}}}' \
  "${project_containers[@]}" | CAPA_DEMO_NETWORK="$network" node -e '
  let raw="";process.stdin.on("data",x=>raw+=x).on("end",()=>{
    let api=false, db=false;
    for(const line of raw.trim().split("\n")){
      const container=JSON.parse(line);
      if(container.networkMode!==process.env.CAPA_DEMO_NETWORK)process.exit(1);
      if(Object.keys(container.networks||{}).some(name=>name!==process.env.CAPA_DEMO_NETWORK))process.exit(1);
      for(const bindings of Object.values(container.ports||{})){
        for(const binding of bindings||[]){
          if(binding.HostIp!=="127.0.0.1")process.exit(1);
          if(!["58321","58322"].includes(binding.HostPort))process.exit(1);
          if(binding.HostPort==="58321")api=true;
          if(binding.HostPort==="58322")db=true;
        }
      }
    }
    process.exit(api&&db?0:1);
  });
' || { echo 'STOP: at least one port is not exclusively bound to 127.0.0.1.' >&2; exit 1; }
listeners="$(ss -ltnH)" || { echo 'STOP: host listener inspection failed.' >&2; exit 1; }
if printf '%s\n' "$listeners" | awk '$4 ~ /:(58321|58322)$/ && $4 !~ /^127\.0\.0\.1:/ { bad=1 } END { exit !bad }'; then
  echo 'STOP: host listener inspection found a non-loopback Supabase endpoint.' >&2
  exit 1
fi
node - <<'JS'
const net=require('node:net'), os=require('node:os');
const addresses=[...new Set([
  '::1',
  ...Object.values(os.networkInterfaces()).flat()
    .filter(x=>x&&(x.family==='IPv4'||x.family==='IPv6')&&!x.internal)
    .map(x=>x.address),
])];
(async()=>{
  for(const address of addresses)for(const port of [58300,58321,58322]){
    const reached=await new Promise(resolve=>{
      const socket=net.connect({host:address,port,timeout:1000});
      socket.once('connect',()=>{socket.destroy();resolve(true)});
      socket.once('error',()=>resolve(false));
      socket.once('timeout',()=>{socket.destroy();resolve(false)});
    });
    if(reached)process.exit(1);
  }
})().catch(()=>process.exit(1));
JS
echo 'PASS: every published Docker port and host listener is loopback-only; non-loopback connection probes failed.'
echo 'PASS: no Next.js process was launched; Auth/PostgREST use this isolated local Supabase project only.'

export CAPA_DEMO_DISPOSABLE_PROJECT_ID="$project"
if ! isolated_supabase status --workdir "$workdir" -o json 2>"$workdir/status.log" \
  | timeout 300 node "$repo/scripts/qualification/capa-demo-real-auth.mjs"; then
  echo 'BLOCKED: real Auth acceptance failed; the disposable project will be removed.' >&2
  exit 1
fi
echo 'PASS: isolated real Auth, TOTP, signed PostgREST, provisioning, audit, and negative-security qualification.'
