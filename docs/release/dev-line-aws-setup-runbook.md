# one-team Dev Environment Runbook (AWS + LINE)

Last updated: 2026-02-18

This runbook records the full setup flow for deploying and validating a development environment for `one-team`.
It is written for step-by-step execution with both Manual and CLI options.

## 0. Current Repository Constraints (Read First)

These constraints are from current codebase state and affect webhook go-live:

1. Webhook URL pattern is implemented in:
   - `apps/api/src/services/tenant-onboarding-service.ts`
   - Pattern: `{PUBLIC_API_BASE_URL}/v1/line/webhook/{tenantId}`
2. CDK stack currently exposes only `GET /health` on API Gateway:
   - `infra/cdk/src/stacks/platform-stack.ts`
3. API runtime currently does not include `POST /v1/line/webhook/{tenantId}` route:
   - `apps/api/src/lambda.ts`

Result:
- You can complete AWS foundation and LINE channel setup now.
- To receive real LINE webhook events, API webhook route + signature validation + API runtime deployment wiring must be added.

## 1. Accounts and Access Checklist

Complete all items before deployment:

1. AWS Account (dev) and admin access to IAM
2. Deployment identity (IAM User or IAM Role) for non-root usage
3. GitHub repository admin access (for OIDC secret if CI deploy is needed)
4. LINE Business ID
5. LINE Official Account (OA)
6. LINE Developers Provider
7. LINE Messaging API Channel

Required values to collect:

1. AWS Account ID (12 digits)
2. AWS region (`ap-northeast-1` in this repo)
3. LINE Channel ID
4. LINE Channel Secret
5. LINE Channel Access Token (for webhook endpoint API calls)

## 2. Get AWS Account ID

### Manual
1. Open AWS Console.
2. Click top-right account menu.
3. Copy the 12-digit Account ID.

### CLI
```bash
aws sts get-caller-identity --query Account --output text
```

Expected:
- Command returns a 12-digit string.

## 3. Create Deployment Identity (Do Not Deploy with Root)

### Manual
1. Open IAM Console.
2. Create user `one-team-deployer-dev` (or your own name).
3. Attach policy:
   - Dev quickstart: `AdministratorAccess` (dev account only).
4. Create access key for CLI.

### CLI
```bash
aws iam create-user --user-name one-team-deployer-dev
aws iam attach-user-policy \
  --user-name one-team-deployer-dev \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam create-access-key --user-name one-team-deployer-dev
```

Expected:
- You receive `AccessKeyId` and `SecretAccessKey`.

## 4. Configure AWS CLI Profile

### Manual
1. Run `aws configure --profile one-team-dev`.
2. Fill access key, secret, region, output format.

### CLI
```bash
aws configure --profile one-team-dev
export AWS_PROFILE=one-team-dev
aws sts get-caller-identity
```

Expected:
- Returned identity ARN should not be root ARN.

## 5. Prepare Project Locally

### CLI
```bash
cd /Users/erictu/worksapce/vibe-coding/one-team
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm check
cp .env.example .env
```

### Manual
Edit `.env` and set at least:

1. `AWS_REGION=ap-northeast-1`
2. `AWS_ACCOUNT_ID_DEV=<your-12-digit-id>`
3. `ACCESS_TOKEN_SECRET=<strong-random-secret>`
4. `DIGITAL_ID_SIGNING_SECRET=<strong-random-secret>`
5. `SCANNER_API_KEY=<strong-random-key>`

Note:
- `PUBLIC_API_BASE_URL` can be filled after stack deploy.

## 6. CDK Bootstrap (Once per Account/Region)

### CLI
```bash
export AWS_ACCOUNT_ID_DEV=$(aws sts get-caller-identity --query Account --output text)
pnpm --filter @one-team/infra-cdk exec cdk bootstrap aws://${AWS_ACCOUNT_ID_DEV}/ap-northeast-1
```

Expected:
- `CDKToolkit` stack exists in CloudFormation.

## 7. Deploy Dev Stack

### CLI
```bash
pnpm --filter @one-team/infra-cdk build
DEPLOY_STAGE=dev \
pnpm --filter @one-team/infra-cdk exec cdk deploy \
  -a "node dist/app.js" \
  OneTeamDevStack \
  --require-approval never
```

### Validate
```bash
aws cloudformation describe-stacks --stack-name OneTeamDevStack --query "Stacks[0].Outputs"
```

Extract API URL:
```bash
API_URL=$(aws cloudformation describe-stacks --stack-name OneTeamDevStack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
echo "$API_URL"
curl -sS "$API_URL/health"
```

Expected:
- `/health` returns `{"ok":true}`.

## 8. Create LINE OA + Messaging API Channel

### Manual (Required)
1. Create LINE Official Account.
2. In LINE Developers Console, create Provider.
3. Create Messaging API Channel under that Provider.
4. Record:
   - Channel ID
   - Channel Secret
   - Channel Access Token

Note:
- Initial OA/channel creation is Console-driven.

## 9. Connect Tenant to LINE via one-team Admin APIs

Important:
- This step requires API runtime routes under `/v1/admin/...`.
- If only baseline infra (`/health`) is deployed, this step will return 404.

### CLI
```bash
export ADMIN_TOKEN="admin-token"
export CHANNEL_ID="<line-channel-id>"
export CHANNEL_SECRET="<line-channel-secret>"

TENANT_ID=$(curl -sS -X POST "$API_URL/v1/admin/tenants" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"ACME","adminEmail":"hr@acme.test"}' | jq -r '.tenantId')

curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/line/connect" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"channelId\":\"$CHANNEL_ID\",\"channelSecret\":\"$CHANNEL_SECRET\"}" | jq

curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/line/provision" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq

WEBHOOK_URL=$(curl -sS "$API_URL/v1/admin/tenants/$TENANT_ID/line/setup-status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.line.resources.webhookUrl')

echo "$WEBHOOK_URL"
```

Expected:
- `WEBHOOK_URL` follows `/v1/line/webhook/{tenantId}` pattern.

## 10. Set Webhook URL to LINE

### Manual
1. Open LINE Developers Console > Messaging API.
2. Paste `WEBHOOK_URL`.
3. Enable `Use webhook`.
4. Click `Verify`.

### CLI
```bash
export LINE_CHANNEL_ACCESS_TOKEN="<channel-access-token>"

curl -sS -X PUT "https://api.line.me/v2/bot/channel/webhook/endpoint" \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"endpoint\":\"$WEBHOOK_URL\"}" | jq

curl -sS -X GET "https://api.line.me/v2/bot/channel/webhook/endpoint" \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" | jq

curl -sS -X POST "https://api.line.me/v2/bot/channel/webhook/test" \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

Expected:
- Endpoint query returns the configured URL.
- Test call reports success only if webhook endpoint is reachable and correctly implemented.

## 11. Runtime Gaps to Close Before Real Webhook Validation

To complete real LINE event flow, implement all items:

1. Add API route:
   - `POST /v1/line/webhook/{tenantId}`
2. Verify `x-line-signature` using channel secret (HMAC-SHA256).
3. Deploy real `apps/api` lambda runtime behind API Gateway (not only health lambda).
4. Log webhook event IDs and processing result for traceability.

After implementation:
1. Send message from LINE app to OA.
2. Tail Lambda logs and verify event handling.

## 12. Security Baseline for Dev

1. Do not use root access key for deployment.
2. Keep `.env` local only (`.env` is gitignored).
3. Use strong random secrets for token signing keys.
4. Use least-privilege IAM policy after initial bring-up.
5. Rotate deploy keys and LINE tokens periodically.

## 13. Troubleshooting Quick Map

1. `cdk deploy` denied:
   - Check IAM permissions and `AWS_PROFILE`.
2. `/v1/admin/...` returns 404:
   - API runtime routes not deployed to API Gateway yet.
3. LINE webhook verify fails:
   - Wrong URL, endpoint unreachable, or missing webhook route/signature validation.
4. `401` on admin APIs:
   - Missing/invalid `Authorization: Bearer <token>`.

