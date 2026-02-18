#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
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
ADMIN_TOKEN="${ADMIN_TOKEN:-admin-token}"
SCANNER_API_KEY="${SCANNER_API_KEY:-dev-scanner-key}"
CHANNEL_ID="${CHANNEL_ID:-1234567890}"
CHANNEL_SECRET="${CHANNEL_SECRET:-1234567890abcdef}"
WEBHOOK_VERIFY_TOKEN="${WEBHOOK_VERIFY_TOKEN:-line-verify-1234567890}"
LINE_ID_TOKEN="${LINE_ID_TOKEN:-line-id:U1001}"
TENANT_NAME="${TENANT_NAME:-ACME}"
ADMIN_EMAIL="${ADMIN_EMAIL:-hr@acme.test}"
RECIPIENT_EMAIL="${RECIPIENT_EMAIL:-user@acme.test}"
EMPLOYEE_ID="${EMPLOYEE_ID:-E001}"
TTL_MINUTES="${TTL_MINUTES:-60}"
RUN_OFFBOARD_CHECK="${RUN_OFFBOARD_CHECK:-true}"

api_post_admin() {
  local path="$1"
  local body="$2"
  curl -sS -X POST "$API_URL$path" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body"
}

api_post_public() {
  local path="$1"
  local body="$2"
  curl -sS -X POST "$API_URL$path" \
    -H "Content-Type: application/json" \
    -d "$body"
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
  "{\"channelId\":\"$CHANNEL_ID\",\"channelSecret\":\"$CHANNEL_SECRET\"}" >/dev/null

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
  curl -sS "$API_URL/v1/liff/tenants/$TENANT_ID/me/digital-id" \
    -H "Authorization: Bearer $ACCESS_TOKEN" |
    jq -er '.payload'
)"
VERIFY_BEFORE="$(
  curl -sS -X POST "$API_URL/v1/scanner/verify" \
    -H "x-scanner-api-key: $SCANNER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"payload\":\"$DIGITAL_PAYLOAD\"}"
)"
VALID_BEFORE="$(echo "$VERIFY_BEFORE" | jq -er '.valid')"
echo "  scanner valid before offboard: $VALID_BEFORE"

if [[ "$RUN_OFFBOARD_CHECK" == "true" ]]; then
  echo "[8/8] Offboarding and re-verifying scanner..."
  api_post_admin "/v1/admin/tenants/$TENANT_ID/employees/$EMPLOYEE_ID/offboard" \
    '{"actorId":"hr-admin"}' >/dev/null

  VERIFY_AFTER="$(
    curl -sS -X POST "$API_URL/v1/scanner/verify" \
      -H "x-scanner-api-key: $SCANNER_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"payload\":\"$DIGITAL_PAYLOAD\"}"
  )"
  VALID_AFTER="$(echo "$VERIFY_AFTER" | jq -er '.valid')"
  REASON_AFTER="$(echo "$VERIFY_AFTER" | jq -er '.reasonCode')"
  echo "  scanner valid after offboard: $VALID_AFTER (reason=$REASON_AFTER)"
else
  echo "[8/8] Offboard check skipped (RUN_OFFBOARD_CHECK=false)."
fi

echo
echo "Smoke test completed successfully."
echo "tenantId=$TENANT_ID employeeId=$EMPLOYEE_ID"
