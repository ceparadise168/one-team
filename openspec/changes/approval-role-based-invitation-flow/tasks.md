## 1. Access Governance Data Model

- [x] 1.1 Extend employee binding domain/repository models with `accessStatus`, `permissions`, and access-review metadata.
- [x] 1.2 Add service helpers to read/write access governance defaults safely for legacy records.
- [x] 1.3 Add unit tests for access governance model serialization (in-memory + DynamoDB repositories).

## 2. Access Request and Approval APIs

- [x] 2.1 Add employee endpoint to submit/get access request status.
- [x] 2.2 Add admin endpoint to approve/reject employee access with `canInvite` and `canRemove` flags.
- [x] 2.3 Implement permission-based authorization helper for privileged employee actions.
- [x] 2.4 Add integration tests covering request -> approve/reject -> permission enforcement.

## 3. Rich Menu State Switching

- [x] 3.1 Extend tenant LINE resources to store pending/approved rich menu IDs with backward compatibility alias.
- [x] 3.2 Update LINE provisioning flow to create/upload both pending and approved rich menus idempotently.
- [x] 3.3 Update binding and approval flows to link pending/approved rich menu based on access status transitions.
- [x] 3.4 Add tests for provisioning payload, menu linking transitions, and failure handling.

## 4. Invite and Offboard Authorization Alignment

- [x] 4.1 Update invite creation/batch routes to allow admin token or approved employee with invite permission.
- [x] 4.2 Add endpoint for authorized inviters to generate one-time invite share payload (URL + QR content).
- [x] 4.3 Update offboard route to allow admin token or approved employee with remove permission.
- [x] 4.4 Add regression tests and smoke-test updates for delegated inviter/remover flow.

## 5. Verification and Documentation

- [x] 5.1 Run targeted unit/integration/e2e tests and fix regressions.
- [x] 5.2 Update demo/runbook documentation with request-approval-role demo script.
- [x] 5.3 Mark OpenSpec tasks complete and prepare commit.
