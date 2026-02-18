## MODIFIED Requirements

### Requirement: Batch invitation email sending MUST be supported
The system SHALL allow admins to upload invitation recipients in batch and SHALL dispatch invitation emails asynchronously with per-recipient delivery status. Valid recipients MUST be persisted with `QUEUED` status before dispatch and transitioned to `SENT` or `FAILED` by dispatch execution.

#### Scenario: Batch invitation send succeeds
- **WHEN** an admin uploads a valid recipient batch
- **THEN** the system queues email jobs and records invitation delivery status per recipient

#### Scenario: Queued recipients are dispatched
- **WHEN** dispatch execution runs for a queued batch job
- **THEN** each queued recipient transitions from `QUEUED` to `SENT` or `FAILED` with reason metadata when failed

#### Scenario: Invalid recipients are isolated
- **WHEN** a batch contains invalid recipient entries
- **THEN** the system marks only invalid entries as failed and continues processing valid recipients

### Requirement: Binding MUST require LINE authentication, employee ID, and one-time binding code
The system SHALL require successful LINE login plus employee-provided employee ID and one-time binding code before completing account binding. The system MUST link employee Rich Menu during successful binding completion.

#### Scenario: Binding succeeds with valid factors
- **WHEN** an employee completes LINE login and submits valid employee ID and matching one-time binding code
- **THEN** the system creates the binding, links employee Rich Menu, and issues authenticated session credentials

#### Scenario: Rich Menu link failure blocks completion
- **WHEN** the binding factors are valid but Rich Menu linking fails
- **THEN** the system returns binding failure and does not issue authenticated session credentials

#### Scenario: Invalid one-time code triggers protection
- **WHEN** an employee repeatedly submits invalid one-time binding codes
- **THEN** the system increments failure counters and enforces temporary lockout after threshold breaches
