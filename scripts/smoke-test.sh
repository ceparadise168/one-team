#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

    if [[ -n "${!key+x}" ]]; then
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
require_env API_URL

API_URL="${API_URL%/}"
if [[ "$API_URL" == *"<"* || "$API_URL" == *">"* ]]; then
  echo "API_URL still contains placeholder markers. Replace it with a real execute-api URL." >&2
  exit 1
fi

ADMIN_TOKEN="${ADMIN_TOKEN:-admin-token}"
SCANNER_API_KEY="${SCANNER_API_KEY:-dev-scanner-key}"
CHANNEL_ID="${CHANNEL_ID:-${MESSAGING_CHANNEL_ID:-1234567890}}"
CHANNEL_SECRET="${CHANNEL_SECRET:-${MESSAGING_CHANNEL_SECRET:-1234567890abcdef}}"
LOGIN_CHANNEL_ID="${LOGIN_CHANNEL_ID:-${LINE_LOGIN_CHANNEL_ID:-$CHANNEL_ID}}"
LOGIN_CHANNEL_SECRET="${LOGIN_CHANNEL_SECRET:-${LINE_LOGIN_CHANNEL_SECRET:-$CHANNEL_SECRET}}"
WEBHOOK_VERIFY_TOKEN="${WEBHOOK_VERIFY_TOKEN:-line-verify-1234567890}"
LINE_ID_TOKEN="${LINE_ID_TOKEN:-line-id:U1001}"
TENANT_NAME="${TENANT_NAME:-ACME}"
ADMIN_EMAIL="${ADMIN_EMAIL:-hr@acme.test}"
RECIPIENT_EMAIL="${RECIPIENT_EMAIL:-user@acme.test}"
EMPLOYEE_ID="${EMPLOYEE_ID:-E001}"
TTL_MINUTES="${TTL_MINUTES:-60}"
RUN_OFFBOARD_CHECK="${RUN_OFFBOARD_CHECK:-true}"
OFFBOARD_VERIFY_RETRIES="${OFFBOARD_VERIFY_RETRIES:-10}"
OFFBOARD_VERIFY_INTERVAL_SECONDS="${OFFBOARD_VERIFY_INTERVAL_SECONDS:-2}"

api_post_admin() {
  local path="$1"
  local body="$2"
  api_json_request "POST" "$path" "$body" "Authorization: Bearer $ADMIN_TOKEN"
}

api_post_public() {
  local path="$1"
  local body="$2"
  api_json_request "POST" "$path" "$body"
}

api_get_authorized() {
  local path="$1"
  local authorization_header="$2"
  api_json_request "GET" "$path" "" "Authorization: $authorization_header"
}

api_post_scanner() {
  local payload="$1"
  api_json_request "POST" "/v1/scanner/verify" "{\"payload\":\"$payload\"}" "x-scanner-api-key: $SCANNER_API_KEY"
}

api_json_request() {
  local method="$1"
  local path="$2"
  local body="$3"
  local extra_header="${4:-}"
  local tmp_body
  local http_code

  tmp_body="$(mktemp)"
  local curl_args=(
    -sS
    -o "$tmp_body"
    -w "%{http_code}"
    -X "$method"
    "$API_URL$path"
    -H "Content-Type: application/json"
  )

  if [[ -n "$extra_header" ]]; then
    curl_args+=(-H "$extra_header")
  fi

  if [[ "$method" == "POST" || "$method" == "PUT" || "$method" == "PATCH" ]]; then
    curl_args+=(-d "$body")
  fi

  http_code="$(curl "${curl_args[@]}")"

  if [[ ! "$http_code" =~ ^2 ]]; then
    echo "Request failed: $method $path (HTTP $http_code)" >&2
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

echo "[1/8] Creating tenant..."
TENANT_ID="$(
  api_post_admin "/v1/admin/tenants" \
    "{\"tenantName\":\"$TENANT_NAME\",\"adminEmail\":\"$ADMIN_EMAIL\"}" |
    jq -er '.tenantId'
)"
echo "  tenantId=$TENANT_ID"

echo "[2/8] Connecting LINE channel..."
api_post_admin "/v1/admin/tenants/$TENANT_ID/line/connect" \
  "{
    \"channelId\":\"$CHANNEL_ID\",
    \"channelSecret\":\"$CHANNEL_SECRET\",
    \"loginChannelId\":\"$LOGIN_CHANNEL_ID\",
    \"loginChannelSecret\":\"$LOGIN_CHANNEL_SECRET\"
  }" >/dev/null

echo "[3/8] Provisioning LINE resources..."
api_post_admin "/v1/admin/tenants/$TENANT_ID/line/provision" '{}' >/dev/null

echo "[4/8] Verifying webhook..."
api_post_admin "/v1/admin/tenants/$TENANT_ID/line/webhook/verify" \
  "{\"verificationToken\":\"$WEBHOOK_VERIFY_TOKEN\"}" >/dev/null

echo "[5/8] Creating and dispatching batch invite..."
BATCH_JSON="$(
  api_post_admin "/v1/admin/tenants/$TENANT_ID/invites/batch-email" \
    "{\"ttlMinutes\":$TTL_MINUTES,\"recipients\":[{\"email\":\"$RECIPIENT_EMAIL\",\"employeeId\":\"$EMPLOYEE_ID\"}]}"
)"
JOB_ID="$(echo "$BATCH_JSON" | jq -er '.jobId')"
INVITATION_TOKEN="$(echo "$BATCH_JSON" | jq -er '.recipients[0].invitationToken')"
BINDING_CODE="$(echo "$BATCH_JSON" | jq -er '.recipients[0].oneTimeBindingCode')"
api_post_admin "/v1/admin/tenants/$TENANT_ID/invites/batch-jobs/$JOB_ID/dispatch" '{}' >/dev/null

echo "[6/8] Binding employee..."
BIND_SESSION_TOKEN="$(
  api_post_public "/v1/public/bind/start" \
    "{\"lineIdToken\":\"$LINE_ID_TOKEN\",\"invitationToken\":\"$INVITATION_TOKEN\"}" |
    jq -er '.bindSessionToken'
)"
BIND_COMPLETE="$(
  api_post_public "/v1/public/bind/complete" \
    "{\"bindSessionToken\":\"$BIND_SESSION_TOKEN\",\"employeeId\":\"$EMPLOYEE_ID\",\"bindingCode\":\"$BINDING_CODE\"}"
)"
ACCESS_TOKEN="$(echo "$BIND_COMPLETE" | jq -er '.auth.accessToken')"

echo "[7/8] Fetching digital ID and scanner verify..."
DIGITAL_PAYLOAD="$(
  api_get_authorized "/v1/liff/tenants/$TENANT_ID/me/digital-id" "Bearer $ACCESS_TOKEN" |
    jq -er '.payload'
)"
VERIFY_BEFORE="$(
  api_post_scanner "$DIGITAL_PAYLOAD"
)"
VALID_BEFORE="$(echo "$VERIFY_BEFORE" | jq -er '.valid')"
echo "  scanner valid before offboard: $VALID_BEFORE"

if [[ "$RUN_OFFBOARD_CHECK" == "true" ]]; then
  echo "[8/8] Offboarding and re-verifying scanner..."
  api_post_admin "/v1/admin/tenants/$TENANT_ID/employees/$EMPLOYEE_ID/offboard" \
    '{"actorId":"hr-admin"}' >/dev/null

  VALID_AFTER="true"
  REASON_AFTER="UNKNOWN"
  for ((attempt = 1; attempt <= OFFBOARD_VERIFY_RETRIES; attempt += 1)); do
    VERIFY_AFTER="$(api_post_scanner "$DIGITAL_PAYLOAD")"
    VALID_AFTER="$(echo "$VERIFY_AFTER" | jq -er '.valid')"
    REASON_AFTER="$(echo "$VERIFY_AFTER" | jq -r '.reasonCode // "UNKNOWN"')"

    if [[ "$VALID_AFTER" == "false" ]]; then
      break
    fi

    if [[ "$attempt" -lt "$OFFBOARD_VERIFY_RETRIES" ]]; then
      sleep "$OFFBOARD_VERIFY_INTERVAL_SECONDS"
    fi
  done

  echo "  scanner valid after offboard: $VALID_AFTER (reason=$REASON_AFTER)"
  if [[ "$VALID_AFTER" != "false" ]]; then
    echo "Offboard verification failed: scanner payload still valid after retries." >&2
    exit 1
  fi
else
  echo "[8/8] Offboard check skipped (RUN_OFFBOARD_CHECK=false)."
fi

echo
echo "Smoke test completed successfully."
echo "tenantId=$TENANT_ID employeeId=$EMPLOYEE_ID"
