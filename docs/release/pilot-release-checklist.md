# Pilot Release Checklist (Phase 1 MVP)

## Feature Flags

- [ ] `SETUP_WIZARD` enabled for pilot tenants only
- [ ] `INVITATION_BINDING` enabled for pilot tenants only
- [ ] `DIGITAL_ID` enabled for pilot tenants only
- [ ] `KILL_SWITCH` enabled for pilot tenants only

## Pre-Deploy

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm --filter @one-team/infra-cdk cdk:synth`

## Deploy

- [ ] Deploy API and infra to `dev`
- [ ] Run setup wizard smoke test in `dev`
- [ ] Deploy API and infra to `staging`
- [ ] Execute integration + e2e flows in `staging`
- [ ] Promote to `prod` with pilot tenant allowlist

## Acceptance KPI Verification

- [ ] Binding success rate >= 95%
- [ ] Digital ID verify success rate >= 99% for valid requests
- [ ] Kill switch p95 effective time <= 60 seconds

## Rollback

- [ ] Disable pilot feature flags in order: `KILL_SWITCH` -> `DIGITAL_ID` -> `INVITATION_BINDING` -> `SETUP_WIZARD`
- [ ] Roll back Lambda alias to previous stable version
- [ ] Pause offboarding retry jobs if external LINE API incident is active
- [ ] Notify pilot customers and provide incident timeline

## Post-Release Audit

- [ ] Export offboarding audit events for pilot period
- [ ] Review auth revocation failures and scanner rejection reason codes
- [ ] Record lessons learned and backlog items for enterprise phase
