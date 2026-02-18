## 1. Invitation Queue and Binding Rich Menu Alignment

- [x] 1.1 Refactor batch invitation creation to persist valid recipients as `QUEUED` and keep invalid recipients isolated as `FAILED`
- [x] 1.2 Add batch invitation dispatch execution flow that transitions queued recipients to `SENT` or `FAILED`
- [x] 1.3 Update binding completion flow to call LINE Rich Menu link before session issuance
- [x] 1.4 Expose API route for batch dispatch execution and update contracts/types accordingly

## 2. Offboarding jti Revocation Alignment

- [x] 2.1 Extend auth session model to track active issued jti identifiers per refresh session
- [x] 2.2 Revoke tracked active jti identifiers when revoking one session or all principal sessions
- [x] 2.3 Ensure offboarding path triggers both session revoke and jti revoke behavior

## 3. Documentation and Verification Updates

- [x] 3.1 Update runtime architecture decision docs to reflect Node.js Lambda modular service implementation (not NestJS)
- [x] 3.2 Update and add unit/integration/E2E tests for queued invitation dispatch, Rich Menu link on bind, and jti revocation on offboarding
- [ ] 3.3 Run lint, typecheck, test, and build to verify no regressions
