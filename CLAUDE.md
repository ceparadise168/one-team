# ONE TEAM

TypeScript monorepo for a LINE enterprise app. DynamoDB single-table design, Lambda API, React frontends.

## Deployment

When deploying, ALWAYS deploy both backend AND frontend:

1. **Backend**: CDK deploy updates Lambda + API Gateway + infra
2. **Frontend**: Must separately upload to S3 + invalidate CloudFront

Frontend apps and their deployment targets:
- `apps/liff-web` → S3: `<YOUR_LIFF_WEB_S3_BUCKET>`, CloudFront: `<YOUR_CLOUDFRONT_DISTRIBUTION_ID>`
- `apps/admin-web` → S3: `<YOUR_ADMIN_WEB_S3_BUCKET>`

**Critical env vars:**
- `VITE_API_BASE_URL` must be set at build time (`.env.production` handles this for liff-web)
- Without it, Vite falls back to `localhost:3000` and all API calls fail silently

**Verification after deploy:**
- Verify Lambda handler entry point matches the bundled filename
- Verify frontend assets exist in S3 bucket
- Grep the JS bundle for the API URL to confirm env var was baked in
- Curl at least one endpoint to confirm non-error response

## Git Operations

- Never checkout main from within a worktree — use the main working directory
- When cleaning sensitive data, always rewrite git history (e.g., `git filter-repo`), not just the current file
- Always verify git history is clean after any sensitive data removal

## AWS / Infrastructure

- Lambda uses CDK `NodejsFunction` which bundles from `.ts` source — no manual zip needed
- S3 is used for frontend hosting — remember to deploy frontend assets when making UI changes
- When user asks to check AWS bill: `aws ce get-cost-and-usage` with appropriate date ranges
- Region: `ap-northeast-1`
