## ADDED Requirements

### Requirement: HR offboarding action MUST transition employee to revoked state immediately
The system SHALL provide an admin offboarding action that transitions employee status to OFFBOARDED and prevents new privileged employee interactions.

#### Scenario: Offboarding request succeeds
- **WHEN** an authorized HR admin triggers offboarding for an active employee
- **THEN** the employee status is updated to OFFBOARDED and further employee-only actions are denied

#### Scenario: Repeated offboarding is idempotent
- **WHEN** an admin repeats offboarding for an already offboarded employee
- **THEN** the system returns success without creating conflicting state

### Requirement: Rich Menu unlink MUST execute with retry and completion target
The system SHALL attempt to unlink employee Rich Menu from LINE and SHALL retry transient failures until completion or configured retry exhaustion. The default operational target MUST complete successful unlink within 60 seconds in normal conditions.

#### Scenario: Rich Menu unlink succeeds on first attempt
- **WHEN** offboarding is triggered and LINE API is available
- **THEN** the system unlinks Rich Menu and records completion in audit logs

#### Scenario: Rich Menu unlink retries on transient failure
- **WHEN** LINE API returns transient failure during unlink
- **THEN** the system schedules retry attempts with backoff and records retry activity

### Requirement: Offboarding MUST revoke active authentication sessions
The system SHALL revoke all active refresh sessions and invalidate active access token identifiers (jti) for the offboarded employee.

#### Scenario: Active session use is rejected after offboarding
- **WHEN** an offboarded employee attempts to use a session or token issued before offboarding
- **THEN** the system rejects access with revoked-session outcome

### Requirement: Offboarding events MUST produce immutable audit records
The system SHALL persist append-only audit events containing actor identity, target employee, action, timestamp, and execution outcome.

#### Scenario: Successful offboarding emits audit event
- **WHEN** offboarding completes successfully
- **THEN** the system stores an audit event with action `EMPLOYEE_OFFBOARDED` and outcome `SUCCESS`

#### Scenario: Failed unlink emits audit event
- **WHEN** Rich Menu unlink fails after retries
- **THEN** the system stores an audit event with action `RICH_MENU_UNLINK` and outcome `FAILED`
