# one-team

Turn LINE into an employee super app.

`one-team` is a monorepo for a LINE-based employee identity and perks platform. It includes:

- Admin setup wizard APIs and UI modules
- Invitation and binding lifecycle
- Dynamic digital employee ID (rotating payload)
- Offboarding kill switch with audit trail
- AWS CDK baseline infrastructure

This README is written for open-source contributors so you can set up, develop, validate, and deploy with repeatable steps.

Additional runbooks:

- Development AWS + LINE setup: `docs/release/dev-line-aws-setup-runbook.md`

## Repository Status

The application domain logic and tests are implemented, and the infrastructure baseline is deployable.

Current runtime/deployment state in this repository:

- API logic exists in `apps/api` and is tested via Lambda event harness.
- CDK deploys platform resources plus API Gateway routes for `/health` and `/v1/*`.
- LINE integration now supports both `stub` and `real` modes (runtime switch via env).
- Runtime repositories support DynamoDB-backed persistence (`USE_DYNAMODB_REPOSITORIES=true`) for deploy environments.

You can deploy and operate a baseline environment now, and then harden to full LINE production mode by following the "Production LINE Integration" section.

## Monorepo Layout

```
one-team/
  apps/
    admin-web/        # Admin setup wizard React module
    liff-web/         # LIFF digital ID React module
    api/              # Lambda-style API + domain services + tests
  infra/
    cdk/              # AWS CDK stack(s)
  packages/
    shared-types/
  docs/
    release/
```

## Prerequisites

- Node.js 20.x
- `pnpm` 9.15.4
- AWS CLI v2
- AWS CDK v2 CLI (`pnpm --filter @one-team/infra-cdk exec cdk --version`)
- `jq` (used in smoke-test snippets)
- An AWS account for each stage you use (`dev`, `staging`, `prod`)

## 1. Project Setup

```bash
git clone <your-fork-or-repo-url>
cd one-team

corepack enable
corepack prepare pnpm@9.15.4 --activate

pnpm install
pnpm check

cp .env.example .env
# edit .env values for your environment
```

`pnpm check` runs:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## 2. Local Development Workflow

### 2.1 Run all quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 2.2 API local smoke test (Lambda harness)

There is no dedicated local HTTP dev server yet. Use the Lambda test harness to execute routes locally.

```bash
pnpm --filter @one-team/api build

node -e "import('./apps/api/dist/testing/lambda-test-client.js').then(async (m) => { const r = await m.invokeLambda({ method: 'GET', path: '/health' }); console.log(JSON.stringify(r)); })"
```

Expected result:

```json
{"statusCode":200,"body":{"ok":true}}
```

### 2.3 Run API tests only

```bash
pnpm --filter @one-team/api test
```

## 3. Runtime Environment Variables

`apps/api/src/lambda.ts` reads these variables:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AWS_REGION` | no | `ap-northeast-1` | AWS region for secret store client |
| `USE_AWS_SECRETS_MANAGER` | no | `false` | Use AWS Secrets Manager for LINE credentials |
| `USE_DYNAMODB_REPOSITORIES` | no | `false` | Use DynamoDB-backed repositories instead of in-memory stores |
| `LINE_INTEGRATION_MODE` | no | `stub` | `stub` for local/CI, `real` for live LINE APIs |
| `LINE_API_BASE_URL` | no | `https://api.line.me` | LINE API base URL override |
| `LINE_WEBHOOK_VERIFY_TOKEN_PREFIX` | no | `line-verify-` | Backward-compatible webhook verify token prefix |
| `LINE_SECRET_PREFIX` | no | `one-team/dev/tenants` | Secret namespace prefix |
| `TENANTS_TABLE_NAME` | no | `one-team-dev-tenants` | DynamoDB table for tenant setup state |
| `INVITATIONS_TABLE_NAME` | no | `one-team-dev-invitations` | DynamoDB table for invitations, batch jobs, binding sessions |
| `EMPLOYEES_TABLE_NAME` | no | `one-team-dev-employees` | DynamoDB table for enrollments, bindings, blacklist state |
| `SESSIONS_TABLE_NAME` | no | `one-team-dev-sessions` | DynamoDB table for refresh sessions |
| `TOKEN_REVOCATIONS_TABLE_NAME` | no | `one-team-dev-token-revocations` | DynamoDB table for revoked access token JTIs |
| `AUDIT_EVENTS_TABLE_NAME` | no | `one-team-dev-audit-events` | DynamoDB table for audit events and offboarding jobs |
| `PUBLIC_API_BASE_URL` | no | `https://api.example.com` | Used for webhook URL generation |
| `INVITE_BASE_URL` | no | `https://app.example.com/invite` | Invitation link base URL |
| `DIGITAL_ID_SIGNING_SECRET` | no | `digital-id-dev-secret` | Dynamic ID signature key |
| `ACCESS_TOKEN_SECRET` | no | `dev-secret-change-me` | Access JWT signing key |
| `SCANNER_API_KEY` | no | `dev-scanner-key` | Scanner verification API key |
| `ADMIN_TOKEN` | no | `admin-token` | Admin API bearer token used for `/v1/admin/*` routes |

For production, set all security-sensitive values explicitly and rotate them regularly.

## 4. LINE Setup Modes

### 4.1 Stub mode (default)

By default this repo uses stubbed LINE clients:

- `StubLineAuthClient`
- `StubLinePlatformClient`

This mode is suitable for development, CI, and internal dry-runs.

Stub input rules:

- `lineIdToken` format: `line-id:<lineUserId>`
- Webhook verification token must start with `line-verify-`
- Certain synthetic IDs intentionally fail to test retry/error paths

### 4.2 Real LINE integration mode

Enable real LINE APIs by setting:

```bash
LINE_INTEGRATION_MODE=real
USE_AWS_SECRETS_MANAGER=true
USE_DYNAMODB_REPOSITORIES=true
```

Real mode behavior:

1. `LineAuthClient` validates LINE ID token via LINE verify endpoint.
2. `LinePlatformClient` calls real LINE APIs to:
   - validate channel credentials
   - set webhook endpoint
   - create rich menu (if not existing)
   - upload a default rich menu image during provisioning
   - link/unlink rich menu per LINE user
3. Webhook callback signature validation remains enforced.

## 5. AWS Deployment (dev/staging/prod)

Stage configuration source: `infra/cdk/src/environments.ts`

- region is fixed to `ap-northeast-1`
- accounts come from env vars: `AWS_ACCOUNT_ID_DEV`, `AWS_ACCOUNT_ID_STAGING`, `AWS_ACCOUNT_ID_PROD`

### 5.1 Export stage account variables

```bash
export AWS_ACCOUNT_ID_DEV="111111111111"
export AWS_ACCOUNT_ID_STAGING="222222222222"
export AWS_ACCOUNT_ID_PROD="333333333333"
```

### 5.2 Bootstrap CDK (once per account/region)

```bash
pnpm --filter @one-team/infra-cdk exec cdk bootstrap aws://${AWS_ACCOUNT_ID_DEV}/ap-northeast-1
pnpm --filter @one-team/infra-cdk exec cdk bootstrap aws://${AWS_ACCOUNT_ID_STAGING}/ap-northeast-1
pnpm --filter @one-team/infra-cdk exec cdk bootstrap aws://${AWS_ACCOUNT_ID_PROD}/ap-northeast-1
```

### 5.3 Synthesize CloudFormation

```bash
pnpm --filter @one-team/infra-cdk cdk:synth
```

### 5.4 Deploy stage stacks

Build infra app first:

```bash
pnpm --filter @one-team/infra-cdk build
```

Dev:

```bash
DEPLOY_STAGE=dev \
pnpm --filter @one-team/infra-cdk exec cdk deploy \
  -a "node dist/app.js" \
  OneTeamDevStack \
  --require-approval never
```

Staging:

```bash
DEPLOY_STAGE=staging \
pnpm --filter @one-team/infra-cdk exec cdk deploy \
  -a "node dist/app.js" \
  OneTeamStagingStack \
  --require-approval never
```

Prod:

```bash
DEPLOY_STAGE=prod \
pnpm --filter @one-team/infra-cdk exec cdk deploy \
  -a "node dist/app.js" \
  OneTeamProdStack \
  --require-approval never
```

### 5.5 Validate deployed outputs

```bash
aws cloudformation describe-stacks --stack-name OneTeamDevStack \
  --query "Stacks[0].Outputs"
```

Use `ApiUrl` output to call health:

```bash
curl -sS "<ApiUrl>/health"
```

### 5.6 End-to-end smoke test against deployed API (stub LINE mode)

One-command option:

```bash
cp .env.example .env
# edit API_URL and any credentials/tokens in .env

./scripts/smoke-test.sh
```

The default smoke script now runs a full governance flow:

1. Create tenant + connect/provision/verify LINE
2. Bind a manager employee
3. Submit access request
4. Admin approves `canInvite` + `canRemove`
5. Manager generates one-time invite payload
6. Invitee binds with invite link + one-time binding code
7. Manager offboards invitee
8. Scanner verify flips from valid to invalid

Optional env flags for smoke flow:
- `RUN_DELEGATED_FLOW=true|false` (default `true`)
- `INVITEE_EMAIL`, `INVITEE_EMPLOYEE_ID`, `INVITEE_LINE_ID_TOKEN`

If Messaging API and LINE Login use separate channels, set both pairs in `.env`:
- `CHANNEL_ID` / `CHANNEL_SECRET` (Messaging API)
- `LOGIN_CHANNEL_ID` / `LOGIN_CHANNEL_SECRET` (LINE Login)

For real LINE mode, defaults like `1234567890` and `line-id:U1001` will fail. Set real values for:
- `CHANNEL_ID`, `CHANNEL_SECRET`
- `LOGIN_CHANNEL_ID`, `LOGIN_CHANNEL_SECRET`
- `LINE_ID_TOKEN` (issued by LINE Login channel)

Quick helper to fetch `LINE_ID_TOKEN`:

```bash
# .env must include:
# LOGIN_CHANNEL_ID, LOGIN_CHANNEL_SECRET, LINE_LOGIN_REDIRECT_URI

./scripts/get-line-id-token.sh --write-env
```

The script prints an authorization URL, asks you to paste callback URL (or code), exchanges token, verifies `id_token`, and writes `LINE_ID_TOKEN` into `.env`.

Manual step-by-step option:

Set your API URL and any admin bearer token:

```bash
export API_URL="https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/dev"
export ADMIN_TOKEN="admin-token"
```

Create tenant:

```bash
TENANT_ID=$(curl -sS -X POST "$API_URL/v1/admin/tenants" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"ACME","adminEmail":"hr@acme.test"}' | jq -r '.tenantId')
```

Connect + provision + verify webhook:

```bash
# If LINE Login uses a different channel than Messaging API, set these too:
# export LOGIN_CHANNEL_ID="YOUR_LOGIN_CHANNEL_ID"
# export LOGIN_CHANNEL_SECRET="your-login-channel-secret"

curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/line/connect" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"channelId\":\"1234567890\",
    \"channelSecret\":\"1234567890abcdef\",
    \"loginChannelId\":\"${LOGIN_CHANNEL_ID:-1234567890}\",
    \"loginChannelSecret\":\"${LOGIN_CHANNEL_SECRET:-1234567890abcdef}\"
  }" > /dev/null

curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/line/provision" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null

curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/line/webhook/verify" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verificationToken":"line-verify-1234567890"}' > /dev/null
```

Create and dispatch batch invites:

```bash
BATCH_JSON=$(curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/invites/batch-email" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlMinutes":60,"recipients":[{"email":"user@acme.test","employeeId":"E001"}]}')

JOB_ID=$(echo "$BATCH_JSON" | jq -r '.jobId')
INVITATION_TOKEN=$(echo "$BATCH_JSON" | jq -r '.recipients[0].invitationToken')
BINDING_CODE=$(echo "$BATCH_JSON" | jq -r '.recipients[0].oneTimeBindingCode')
EMPLOYEE_ID=$(echo "$BATCH_JSON" | jq -r '.recipients[0].employeeId')

curl -sS -X POST "$API_URL/v1/admin/tenants/$TENANT_ID/invites/batch-jobs/$JOB_ID/dispatch" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null
```

Bind employee + get digital ID + scanner verify:

```bash
# Stub mode sample:
BIND_SESSION_TOKEN=$(curl -sS -X POST "$API_URL/v1/public/bind/start" \
  -H "Content-Type: application/json" \
  -d "{\"lineIdToken\":\"line-id:U1001\",\"invitationToken\":\"$INVITATION_TOKEN\"}" | jq -r '.bindSessionToken')

# Real mode: pass LINE Login id_token instead of line-id:* synthetic token.
# LINE_ID_TOKEN="<id_token from LINE Login channel>"
# BIND_SESSION_TOKEN=$(curl -sS -X POST "$API_URL/v1/public/bind/start" \
#   -H "Content-Type: application/json" \
#   -d "{\"lineIdToken\":\"$LINE_ID_TOKEN\",\"invitationToken\":\"$INVITATION_TOKEN\"}" | jq -r '.bindSessionToken')

BIND_COMPLETE=$(curl -sS -X POST "$API_URL/v1/public/bind/complete" \
  -H "Content-Type: application/json" \
  -d "{\"bindSessionToken\":\"$BIND_SESSION_TOKEN\",\"employeeId\":\"$EMPLOYEE_ID\",\"bindingCode\":\"$BINDING_CODE\"}")

ACCESS_TOKEN=$(echo "$BIND_COMPLETE" | jq -r '.auth.accessToken')
DIGITAL_PAYLOAD=$(curl -sS "$API_URL/v1/liff/tenants/$TENANT_ID/me/digital-id" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq -r '.payload')

curl -sS -X POST "$API_URL/v1/scanner/verify" \
  -H "x-scanner-api-key: dev-scanner-key" \
  -H "Content-Type: application/json" \
  -d "{\"payload\":\"$DIGITAL_PAYLOAD\"}" | jq
```

## 6. GitHub Actions + OIDC Setup

CI workflow file: `.github/workflows/ci.yml`

Current pipeline behavior:

- `checks` job on PR/push: lint, typecheck, test, build
- `deploy-dev` on `main` push: OIDC auth + CDK synth

### 6.1 Create IAM role for GitHub OIDC

Create a role in AWS with trust policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID_DEV>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

Attach permissions required for CloudFormation/CDK operations.

### 6.2 Add GitHub secret

Set repository secret:

- `AWS_ROLE_TO_ASSUME_DEV` = created IAM role ARN

### 6.3 Optional: enable real auto-deploy

The current workflow runs synth only in deploy job. To auto-deploy, add a `cdk deploy` step after synth.

## 7. Release Process (Pilot -> Production)

Use `docs/release/pilot-release-checklist.md` as the runbook.

Recommended sequence:

1. `dev` deploy + setup wizard smoke test
2. `staging` deploy + integration/e2e pass
3. production rollout with tenant allowlist
4. KPI verification and post-release audit

Core KPIs from checklist:

- Binding success rate >= 95%
- Digital ID verify success rate >= 99% for valid requests
- Kill switch p95 effective time <= 60s

## 8. Contributor Workflow

### 8.1 Branch and validate

```bash
git checkout -b feature/<topic>
pnpm check
pnpm --filter @one-team/infra-cdk cdk:synth
```

### 8.2 OpenSpec workflow (if changing behavior)

```bash
openspec new change <kebab-case-name>
openspec status --change <name>
openspec instructions apply --change <name> --json
```

Complete tasks, validate, then archive:

```bash
openspec archive <name>
```

## 9. Known Gaps and Next Hardening Steps

For full external production launch, complete these in your fork:

1. Expand webhook event handling beyond signature validation (idempotency, retries, business handlers).
2. Tighten IAM permissions from broad development defaults to least-privilege roles.
3. Add stage-specific secret rotation policy and alarms integration with your on-call channel.
4. Add production-ready rich menu assets and LIFF endpoint lifecycle automation.

## License

MIT (recommended). Add a `LICENSE` file before public release if missing.
