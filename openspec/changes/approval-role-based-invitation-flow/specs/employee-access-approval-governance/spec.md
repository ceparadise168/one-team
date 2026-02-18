## ADDED Requirements

### Requirement: Access requests MUST be recorded with auditable lifecycle states
The system SHALL allow a bound employee to submit an access request and SHALL persist lifecycle state transitions (`PENDING`, `APPROVED`, `REJECTED`) with timestamps and reviewer identity metadata.

#### Scenario: Bound employee submits first access request
- **WHEN** an employee with an active binding submits an access request for their tenant
- **THEN** the system records the request with status `PENDING` and stores `accessRequestedAt`

#### Scenario: Duplicate pending request is idempotent
- **WHEN** the same employee submits another access request while status is already `PENDING`
- **THEN** the system returns the existing pending state without creating duplicate request records

#### Scenario: Offboarded employee cannot request access
- **WHEN** an offboarded or blacklisted employee submits an access request
- **THEN** the system rejects the request with access-revoked outcome

### Requirement: Managers MUST be able to approve or reject with permission flags
The system SHALL allow authorized manager/admin actors to approve or reject pending access requests. Approval SHALL require explicit permission flags `canInvite` and `canRemove`, and the resulting decision MUST be persisted to the employee access profile.

#### Scenario: Manager approves request with invitation permission only
- **WHEN** an authorized approver sets decision `APPROVE` with `canInvite=true` and `canRemove=false`
- **THEN** the employee access status becomes `APPROVED` and only invitation actions are authorized

#### Scenario: Manager approves request with remove permission
- **WHEN** an authorized approver sets decision `APPROVE` with `canRemove=true`
- **THEN** the employee can invoke remove/offboard actions allowed by policy

#### Scenario: Manager rejects request
- **WHEN** an authorized approver sets decision `REJECT`
- **THEN** the employee access status becomes `REJECTED` and no privileged permissions are granted

### Requirement: Access decision MUST drive Rich Menu visibility
The system SHALL map access status to tenant-scoped Rich Menu resources and MUST relink the employee to the matching menu when access status changes.

#### Scenario: Newly bound employee is linked to pending menu
- **WHEN** an employee completes binding and has no approval decision yet
- **THEN** the system links the tenant pending Rich Menu for that LINE user

#### Scenario: Approval switches menu to approved menu
- **WHEN** an employee request transitions from `PENDING` to `APPROVED`
- **THEN** the system relinks the LINE user to tenant approved Rich Menu

#### Scenario: Rejection keeps restricted visibility
- **WHEN** an employee request is `REJECTED`
- **THEN** the employee remains linked to pending/restricted Rich Menu and cannot access approved-only entries

### Requirement: Privileged endpoints MUST enforce granted permissions
The system SHALL authorize privileged employee endpoints only when employee access status is `APPROVED` and the required permission flag is granted.

#### Scenario: Invite endpoint denies approved user without invite permission
- **WHEN** an approved employee without `canInvite` calls invitation creation endpoint
- **THEN** the system returns forbidden

#### Scenario: Offboard endpoint denies approved user without remove permission
- **WHEN** an approved employee without `canRemove` calls offboard endpoint
- **THEN** the system returns forbidden

#### Scenario: Approved user with required permission is authorized
- **WHEN** an approved employee with the required permission calls a privileged endpoint
- **THEN** the system executes the action and records actor identity in audit metadata
