#!/usr/bin/env bash
set -Eeuo pipefail

echo "================================================================"
echo "LVTCHAT — HOSTINGER CONTROLLED RELEASE"
echo "================================================================"

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

BRANCH="$(git branch --show-current)"
COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"

echo "Reading remote main directly..."
REMOTE_MAIN="$(
  git ls-remote --exit-code origin refs/heads/main |
  awk 'NR == 1 {print $1}'
)"

ENV_FILE="$ROOT_DIR/.env.local"
DOWNLOAD_DIR="$HOME/Downloads"
FINAL_ZIP="$DOWNLOAD_DIR/lvtchat-hostinger-${SHORT}.zip"

TMP_ROOT="$(mktemp -d)"
TMP_ZIP="$TMP_ROOT/lvtchat-hostinger-${SHORT}.zip"
BUILD_DIR="$TMP_ROOT/build"
ZIP_LIST="$TMP_ROOT/zip-list.txt"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL — $*"
  exit 1
}

run_logged() {
  local label="$1"
  local log="$2"
  shift 2

  echo
  echo "===== $label ====="

  if "$@" >"$log" 2>&1; then
    echo "PASS — $label"
  else
    echo "FAIL — $label"
    echo
    echo "----- LAST 120 LOG LINES -----"
    tail -n 120 "$log" || true
    exit 1
  fi
}

echo
echo "===== 1. RELEASE SOURCE ====="
echo "Branch: $BRANCH"
echo "Commit: $SHORT"

[ "$BRANCH" = "main" ] || fail "release must be run from main"

[ -n "$REMOTE_MAIN" ] || fail "remote main is unavailable"

[ "$COMMIT" = "$REMOTE_MAIN" ] || {
  echo "HEAD:        $COMMIT"
  echo "remote main:  $REMOTE_MAIN"
  fail "HEAD must exactly match remote main before release"
}

echo "PASS — HEAD exactly matches remote main"

echo
echo "===== 2. WORKTREE ISOLATION ====="
echo "The following local changes, if any, are NOT packaged:"
git status --short --untracked-files=all || true
echo
echo "PASS — release source is committed Git tree $SHORT"

echo
echo "===== 3. LOCAL QUALIFICATION ENV ====="

[ -f "$ENV_FILE" ] || fail ".env.local is required for local production-build qualification"

if grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+' "$ENV_FILE"; then
  echo "PASS — OPENAI_API_KEY is defined"
else
  fail "OPENAI_API_KEY is not defined in .env.local"
fi

echo
echo "===== 4. CREATE EXACT COMMIT ARCHIVE ====="

git archive \
  --format=zip \
  --output="$TMP_ZIP" \
  "$COMMIT"

[ -s "$TMP_ZIP" ] || fail "Git archive was not created"

echo "PASS — archive created from $SHORT"

echo
echo "===== 5. REMOVE NON-PRODUCTION ENV TEMPLATE ====="

zip -dq "$TMP_ZIP" ".env.example" 2>/dev/null || true

unzip -Z1 "$TMP_ZIP" > "$ZIP_LIST"

if grep -E '(^|/)\.env($|\.)' "$ZIP_LIST" >/dev/null; then
  echo "Environment-like files found:"
  grep -E '(^|/)\.env($|\.)' "$ZIP_LIST" || true
  fail "environment file remains inside release archive"
fi

echo "PASS — no .env* files packaged"

echo
echo "===== 6. REQUIRED RELEASE FILES ====="

REQUIRED=(
  "package.json"
  "package-lock.json"
  "app/about/page.tsx"
  "app/pricing/page.tsx"
  "lib/branding.ts"
  "lib/landing-content.ts"
  "scripts/qualification/image-editing/run.mjs"
  "scripts/qualification/image-editing/live/contracts.mjs"
  "scripts/qualification/image-editing/live/credentials.mjs"
)

for file in "${REQUIRED[@]}"; do
  if grep -Fx "$file" "$ZIP_LIST" >/dev/null; then
    echo "PASS — $file"
  else
    fail "required release file missing: $file"
  fi
done

echo
echo "===== 7. FORBIDDEN MATERIAL CHECK ====="

if grep -E \
'(^|/)\.git(/|$)|(^|/)node_modules(/|$)|(^|/)\.next(/|$)' \
"$ZIP_LIST" >/dev/null; then
  grep -E \
  '(^|/)\.git(/|$)|(^|/)node_modules(/|$)|(^|/)\.next(/|$)' \
  "$ZIP_LIST" || true
  fail "forbidden generated/development material found"
fi

echo "PASS — no .git, node_modules, or .next packaged"

echo
echo "===== 8. EXTRACT RELEASE FOR ISOLATED QUALIFICATION ====="

mkdir -p "$BUILD_DIR"
unzip -q "$TMP_ZIP" -d "$BUILD_DIR"

echo "PASS — release extracted"

echo
echo "===== 9. HARD-CODED SECRET SCAN ====="

BUILD_DIR="$BUILD_DIR" python3 <<'PY'
from pathlib import Path
import os
import re
import sys

root = Path(os.environ["BUILD_DIR"])

patterns = [
    re.compile(r'(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}'),
    re.compile(r'(?<![A-Za-z0-9_])sk_live_[A-Za-z0-9_-]{20,}'),
    re.compile(r'(?<![A-Za-z0-9_])rk_live_[A-Za-z0-9_-]{20,}'),
    re.compile(r'(?<![A-Za-z0-9_])whsec_[A-Za-z0-9_-]{20,}'),
    re.compile(r'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY'),
]

hits = []

for path in root.rglob("*"):
    if not path.is_file():
        continue

    try:
        data = path.read_text(errors="ignore")
    except Exception:
        continue

    for lineno, line in enumerate(data.splitlines(), 1):
        if any(pattern.search(line) for pattern in patterns):
            hits.append((path.relative_to(root), lineno))

if hits:
    print("FAIL — possible hard-coded secret material found:")
    for path, lineno in hits[:25]:
        print(f"  {path}:{lineno}")
    sys.exit(1)

print("PASS — no obvious hard-coded secret patterns found")
PY

echo
echo "===== 10. SELECT NODE 24 ====="

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"

  if nvm use 24.21.0 >/dev/null 2>&1; then
    :
  elif nvm use 24 >/dev/null 2>&1; then
    :
  else
    fail "Node 24 is not available through NVM"
  fi
else
  fail "NVM is required to select the qualified Node 24 runtime"
fi

case "$(node -v)" in
  v24.*)
    echo "PASS — Node $(node -v)"
    ;;
  *)
    fail "expected Node 24, found $(node -v)"
    ;;
esac

echo "npm $(npm -v)"

echo
echo "===== 11. MOUNT LOCAL ENV FOR BUILD QUALIFICATION ONLY ====="

ln -s "$ENV_FILE" "$BUILD_DIR/.env.local"
[ -L "$BUILD_DIR/.env.local" ] || fail "could not mount .env.local"

echo "PASS — .env.local linked only inside temporary build directory"

cd "$BUILD_DIR"

run_logged \
  "npm ci" \
  "$TMP_ROOT/npm-ci.log" \
  npm ci --no-audit --fund=false

run_logged \
  "test suite" \
  "$TMP_ROOT/tests.log" \
  npm test

run_logged \
  "TypeScript" \
  "$TMP_ROOT/typescript.log" \
  npx tsc --noEmit

run_logged \
  "production build" \
  "$TMP_ROOT/build.log" \
  npm run build

cd "$ROOT_DIR"

echo
echo "===== 12. VERIFY RELEASE ZIP REMAINS ENV-FREE ====="

unzip -Z1 "$TMP_ZIP" > "$ZIP_LIST"

if grep -E '(^|/)\.env($|\.)' "$ZIP_LIST" >/dev/null; then
  fail "environment material entered release ZIP"
fi

echo "PASS — qualification environment was never packaged"

echo
echo "===== 13. COPY QUALIFIED RELEASE TO DOWNLOADS ====="

mkdir -p "$DOWNLOAD_DIR"
rm -f "$FINAL_ZIP"
cp "$TMP_ZIP" "$FINAL_ZIP"

[ -s "$FINAL_ZIP" ] || fail "final Downloads package was not created"

echo "PASS — release copied"

echo
echo "===== 14. RELEASE IDENTITY ====="

SHA256="$(sha256sum "$FINAL_ZIP" | awk '{print $1}')"

ls -lh "$FINAL_ZIP"
echo "SHA-256: $SHA256"

echo
echo "================================================================"
echo "PASS — HOSTINGER RELEASE FULLY QUALIFIED"
echo "================================================================"
echo
echo "Commit:     $SHORT"
echo "Upload:     $FINAL_ZIP"
echo "SHA-256:    $SHA256"
echo
echo "Hostinger next step:"
echo "Redeploy → Upload new files → $(basename "$FINAL_ZIP")"
