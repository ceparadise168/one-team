#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SHOW_HELP=false
OPEN_BROWSER=false
WRITE_ENV=false
PRINT_AUTH_URL_ONLY=false
AUTH_CODE_INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      SHOW_HELP=true
      shift
      ;;
    --open)
      OPEN_BROWSER=true
      shift
      ;;
    --write-env)
      WRITE_ENV=true
      shift
      ;;
    --print-auth-url)
      PRINT_AUTH_URL_ONLY=true
      shift
      ;;
    --code)
      AUTH_CODE_INPUT="${2:-}"
      if [[ -z "$AUTH_CODE_INPUT" ]]; then
        echo "Missing value for --code" >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$SHOW_HELP" == "true" ]]; then
  cat <<'EOF'
Usage:
  ./scripts/get-line-id-token.sh [options]

Options:
  --open            Open authorization URL in default browser (macOS/Linux desktops).
  --code <value>    Provide authorization code (or full callback URL) non-interactively.
  --write-env       Write LINE_ID_TOKEN to .env after successful exchange.
  --print-auth-url  Print authorization URL and exit.
  --help            Show this help.

Required env vars (from shell or .env):
  LOGIN_CHANNEL_ID (or LINE_LOGIN_CHANNEL_ID)
  LOGIN_CHANNEL_SECRET (or LINE_LOGIN_CHANNEL_SECRET)
  LINE_LOGIN_REDIRECT_URI
EOF
  exit 0
fi

load_env_file() {
  local env_file="$1"
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *"="* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"

    key="$(echo "$key" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    value="$(echo "$value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    if [[ "$value" =~ ^\".*\"$ ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$env_file"
}

if [[ -f "$ROOT_DIR/.env" ]]; then
  load_env_file "$ROOT_DIR/.env"
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd python3
require_cmd openssl

LOGIN_CHANNEL_ID="${LOGIN_CHANNEL_ID:-${LINE_LOGIN_CHANNEL_ID:-}}"
LOGIN_CHANNEL_SECRET="${LOGIN_CHANNEL_SECRET:-${LINE_LOGIN_CHANNEL_SECRET:-}}"
LINE_LOGIN_REDIRECT_URI="${LINE_LOGIN_REDIRECT_URI:-}"

require_env LOGIN_CHANNEL_ID
require_env LOGIN_CHANNEL_SECRET
require_env LINE_LOGIN_REDIRECT_URI

if [[ "$LINE_LOGIN_REDIRECT_URI" == *"<"* || "$LINE_LOGIN_REDIRECT_URI" == *">"* ]]; then
  echo "LINE_LOGIN_REDIRECT_URI still contains placeholder markers." >&2
  exit 1
fi

STATE="$(openssl rand -hex 16)"
NONCE="$(openssl rand -hex 16)"
SCOPE="openid profile"
REDIRECT_URI_ENCODED="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$LINE_LOGIN_REDIRECT_URI")"
SCOPE_ENCODED="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SCOPE")"

AUTH_URL="https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${LOGIN_CHANNEL_ID}&redirect_uri=${REDIRECT_URI_ENCODED}&state=${STATE}&scope=${SCOPE_ENCODED}&nonce=${NONCE}"

echo "Authorization URL:"
echo "$AUTH_URL"

if [[ "$PRINT_AUTH_URL_ONLY" == "true" ]]; then
  exit 0
fi

if [[ "$OPEN_BROWSER" == "true" ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$AUTH_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$AUTH_URL" >/dev/null 2>&1 || true
  fi
fi

parse_code_input() {
  python3 - "$1" <<'PY'
import sys, urllib.parse

raw = sys.argv[1].strip()
if not raw:
    print("")
    raise SystemExit(0)

def from_query_string(text: str) -> str:
    query = text[1:] if text.startswith("?") else text
    params = urllib.parse.parse_qs(query, keep_blank_values=True)
    return params.get("code", [""])[0]

if raw.startswith("http://") or raw.startswith("https://"):
    parsed = urllib.parse.urlparse(raw)
    print(from_query_string(parsed.query))
    raise SystemExit(0)

if "code=" in raw:
    print(from_query_string(raw))
    raise SystemExit(0)

print(raw)
PY
}

AUTH_CODE="${AUTH_CODE_INPUT:-}"
if [[ -z "$AUTH_CODE" ]]; then
  echo
  echo "After login, paste callback URL (or just code):"
  read -r AUTH_CODE_RAW
  AUTH_CODE="$(parse_code_input "$AUTH_CODE_RAW")"
else
  AUTH_CODE="$(parse_code_input "$AUTH_CODE")"
fi

if [[ -z "$AUTH_CODE" ]]; then
  echo "Could not parse authorization code." >&2
  exit 1
fi

request_form_json() {
  local endpoint="$1"
  shift
  local tmp_body
  local http_code
  tmp_body="$(mktemp)"

  http_code="$(curl -sS -o "$tmp_body" -w "%{http_code}" -X POST "$endpoint" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    "$@")"

  if [[ ! "$http_code" =~ ^2 ]]; then
    echo "LINE request failed: $endpoint (HTTP $http_code)" >&2
    if jq -e . "$tmp_body" >/dev/null 2>&1; then
      jq . "$tmp_body" >&2
    else
      cat "$tmp_body" >&2
    fi
    rm -f "$tmp_body"
    exit 1
  fi

  cat "$tmp_body"
  rm -f "$tmp_body"
}

TOKEN_JSON="$(request_form_json "https://api.line.me/oauth2/v2.1/token" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$AUTH_CODE" \
  --data-urlencode "redirect_uri=$LINE_LOGIN_REDIRECT_URI" \
  --data-urlencode "client_id=$LOGIN_CHANNEL_ID" \
  --data-urlencode "client_secret=$LOGIN_CHANNEL_SECRET")"

ID_TOKEN="$(echo "$TOKEN_JSON" | jq -er '.id_token')"

VERIFY_JSON="$(request_form_json "https://api.line.me/oauth2/v2.1/verify" \
  --data-urlencode "id_token=$ID_TOKEN" \
  --data-urlencode "client_id=$LOGIN_CHANNEL_ID")"

AUD="$(echo "$VERIFY_JSON" | jq -r '.aud // \"\"')"
SUB="$(echo "$VERIFY_JSON" | jq -r '.sub // \"\"')"
EXP="$(echo "$VERIFY_JSON" | jq -r '.exp // 0')"
EXP_HUMAN="$(python3 - <<'PY' "$EXP"
import datetime, sys
try:
    exp = int(sys.argv[1])
except Exception:
    exp = 0
if exp <= 0:
    print("unknown")
else:
    dt = datetime.datetime.utcfromtimestamp(exp).replace(microsecond=0)
    print(dt.isoformat() + "Z")
PY
)"

echo
echo "LINE id_token fetched successfully."
echo "aud: $AUD"
if [[ -n "$SUB" ]]; then
  echo "sub: ${SUB:0:8}..."
fi
echo "exp: $EXP_HUMAN"
echo
echo "Use this in current shell:"
echo "export LINE_ID_TOKEN='$ID_TOKEN'"

upsert_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"

  if [[ -f "$file" ]] && rg -n "^${key}=" "$file" >/dev/null 2>&1; then
    sed "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp"
  else
    if [[ -f "$file" ]]; then
      cat "$file" > "$tmp"
      if [[ -s "$tmp" ]]; then
        printf "\n" >> "$tmp"
      fi
    fi
    printf "%s=%s\n" "$key" "$value" >> "$tmp"
  fi

  mv "$tmp" "$file"
}

if [[ "$WRITE_ENV" == "true" ]]; then
  upsert_env_value "$ROOT_DIR/.env" "LINE_ID_TOKEN" "$ID_TOKEN"
  echo "Updated $ROOT_DIR/.env with LINE_ID_TOKEN."
fi
