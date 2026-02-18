## MODIFIED Requirements

### Requirement: Batch invitation email sending MUST be supported
The system SHALL allow invitation batches to be submitted by either tenant admins or approved employees with `canInvite=true`, and SHALL dispatch invitation emails asynchronously with per-recipient delivery status. Valid recipients MUST be persisted with `QUEUED` status before dispatch and transitioned to `SENT` or `FAILED` by dispatch execution.

#### Scenario: Authorized inviter submits batch successfully
- **WHEN** a tenant admin or approved employee with `canInvite=true` uploads a valid recipient batch
- **THEN** the system queues email jobs and records invitation delivery status per recipient

#### Scenario: Unauthorized inviter is rejected
- **WHEN** an employee without invite permission uploads a recipient batch
- **THEN** the system rejects the request with forbidden outcome and does not create a batch job

#### Scenario: Queued recipients are dispatched
- **WHEN** dispatch execution runs for a queued batch job
- **THEN** each queued recipient transitions from `QUEUED` to `SENT` or `FAILED` with reason metadata when failed

#### Scenario: Invalid recipients are isolated
- **WHEN** a batch contains invalid recipient entries
- **THEN** the system marks only invalid entries as failed and continues processing valid recipients

### Requirement: Binding MUST require LINE authentication, employee ID, and one-time binding code
The system SHALL require successful LINE login plus employee-provided employee ID and one-time binding code before completing account binding. The system MUST link the tenant pending/restricted Rich Menu during successful binding completion until access approval is granted.

#### Scenario: Binding succeeds with valid factors
- **WHEN** an employee completes LINE login and submits valid employee ID and matching one-time binding code
- **THEN** the system creates the binding, links pending/restricted Rich Menu, and issues authenticated session credentials

#### Scenario: Rich Menu link failure blocks completion
- **WHEN** the binding factors are valid but pending Rich Menu linking fails
- **THEN** the system returns binding failure and does not issue authenticated session credentials

#### Scenario: Invalid one-time code triggers protection
- **WHEN** an employee repeatedly submits invalid one-time binding codes
- **THEN** the system increments failure counters and enforces temporary lockout after threshold breaches

## ADDED Requirements

### Requirement: Authorized inviters MUST be able to generate one-time invite share payloads
The system SHALL provide an endpoint for authorized inviters to generate one-time invitation share payloads that include invitation URL and QR-compatible content.

#### Scenario: Authorized inviter generates share payload
- **WHEN** a tenant admin or approved employee with invite permission requests a new share payload
- **THEN** the system returns invitation token, invitation URL, and QR payload content bound to tenant policy

#### Scenario: Generated payload enforces TTL and usage rules
- **WHEN** an invitee uses a share payload token after TTL expiry or usage exhaustion
- **THEN** the system rejects binding start with invitation-invalid result
