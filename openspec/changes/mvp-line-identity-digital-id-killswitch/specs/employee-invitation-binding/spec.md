## ADDED Requirements

### Requirement: Invitation tokens MUST enforce expiration and usage limits
The system SHALL issue invitation tokens with tenant scope, expiration time (TTL), and usage limit. The system MUST reject tokens that are expired, revoked, or over usage limit.

#### Scenario: Valid invitation token is accepted
- **WHEN** an employee opens a non-expired invitation token with remaining usage
- **THEN** the system allows binding flow to start for that tenant

#### Scenario: Expired or exhausted token is rejected
- **WHEN** an employee uses an expired token or a token with no remaining usage
- **THEN** the system blocks binding flow and returns an invitation-invalid result

### Requirement: Batch invitation email sending MUST be supported
The system SHALL allow admins to upload invitation recipients in batch and SHALL dispatch invitation emails asynchronously with per-recipient delivery status.

#### Scenario: Batch invitation send succeeds
- **WHEN** an admin uploads a valid recipient batch
- **THEN** the system queues email jobs and records invitation delivery status per recipient

#### Scenario: Invalid recipients are isolated
- **WHEN** a batch contains invalid recipient entries
- **THEN** the system marks only invalid entries as failed and continues processing valid recipients

### Requirement: Binding MUST require LINE authentication, employee ID, and one-time binding code
The system SHALL require successful LINE login plus employee-provided employee ID and one-time binding code before completing account binding.

#### Scenario: Binding succeeds with valid factors
- **WHEN** an employee completes LINE login and submits valid employee ID and matching one-time binding code
- **THEN** the system creates the binding, issues authenticated session credentials, and links employee Rich Menu

#### Scenario: Invalid one-time code triggers protection
- **WHEN** an employee repeatedly submits invalid one-time binding codes
- **THEN** the system increments failure counters and enforces temporary lockout after threshold breaches

### Requirement: Employee identity bindings MUST be unique
The system SHALL prevent one LINE user from binding to multiple employee identities and SHALL prevent one employee identity from binding to multiple LINE users at the same time.

#### Scenario: Existing LINE binding is blocked from rebinding
- **WHEN** a LINE user ID already bound to an active employee attempts a new binding
- **THEN** the system rejects the request as duplicate LINE binding

#### Scenario: Existing employee binding is blocked from duplicate claim
- **WHEN** an employee identity already bound to an active LINE user is claimed by another LINE account
- **THEN** the system rejects the request as duplicate employee binding
