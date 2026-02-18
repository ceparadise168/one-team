## 1. Repository and baseline setup

- [x] 1.1 Initialize monorepo structure for `apps/admin-web`, `apps/liff-web`, `apps/api`, `packages/shared-types`, and `infra/cdk`
- [x] 1.2 Configure TypeScript, linting, formatting, and workspace scripts for build/test/check
- [x] 1.3 Add CI pipeline with GitHub Actions OIDC deployment role assumption for AWS

## 2. Infrastructure and environment foundations

- [x] 2.1 Define CDK stacks for API Gateway, Lambda, DynamoDB tables, SQS queues, SES integration, and Secrets Manager
- [x] 2.2 Create environment configuration for `dev`, `staging`, and `prod` with region `ap-northeast-1`
- [x] 2.3 Add observability primitives (CloudWatch log groups, metrics, alarms) and WAF/rate-limit defaults

## 3. Tenant setup wizard and LINE integration

- [x] 3.1 Implement tenant onboarding APIs for LINE credential submission and secure secret persistence
- [x] 3.2 Implement idempotent LINE provisioning flow for LIFF, Rich Menu, and webhook metadata
- [x] 3.3 Build Admin Setup Wizard UI with connection, provision, and webhook verification states

## 4. Invitation and binding lifecycle

- [x] 4.1 Implement invitation token issuance with tenant scoping, TTL, and usage-limit enforcement
- [x] 4.2 Implement batch invitation email ingestion and async dispatch with per-recipient status tracking
- [x] 4.3 Implement binding flow (`bind/start`, `bind/complete`) requiring LINE auth + employee ID + one-time binding code
- [x] 4.4 Enforce uniqueness and anti-abuse controls for LINE-user and employee-identity bindings

## 5. Authentication and session security

- [x] 5.1 Implement access JWT issuance (10-minute TTL) and refresh session store (7-day TTL)
- [x] 5.2 Implement token/session revocation checks using session state + jti revocation list
- [x] 5.3 Implement authorization middleware that always validates tenant scope and employment status

## 6. Digital employee ID and scanner verification

- [x] 6.1 Implement dynamic digital ID payload generation with 30-second rotation and signed metadata
- [x] 6.2 Build LIFF digital ID view to render rotating QR and handle refresh lifecycle
- [x] 6.3 Implement scanner verification API with signature, expiry window, and employment/blacklist checks
- [x] 6.4 Standardize verification result reason codes for scanner integration handling

## 7. Offboarding kill switch and audit trail

- [ ] 7.1 Implement HR offboarding command and employee status transition to OFFBOARDED
- [ ] 7.2 Implement async Rich Menu unlink workflow with retry/backoff and failure alerting
- [ ] 7.3 Implement immediate global session and token revocation on offboarding
- [ ] 7.4 Implement append-only audit events for offboarding actions and execution outcomes

## 8. Validation, testing, and release readiness

- [ ] 8.1 Add unit tests for invitation lifecycle, binding-code lockout, token/session revocation, and digital ID rotation
- [ ] 8.2 Add integration tests for LINE webhook verification, bind flow, scanner verify API, and offboarding pipeline
- [ ] 8.3 Add end-to-end tests covering setup wizard, employee binding journey, digital ID verification, and kill switch effect
- [ ] 8.4 Define pilot release checklist with feature flags, rollback steps, and acceptance KPI verification
