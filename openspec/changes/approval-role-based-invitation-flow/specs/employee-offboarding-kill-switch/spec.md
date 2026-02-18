## MODIFIED Requirements

### Requirement: HR offboarding action MUST transition employee to revoked state immediately
The system SHALL provide an offboarding action that can be triggered by a tenant admin or an approved employee with `canRemove=true`, and SHALL transition employee status to `OFFBOARDED` while preventing new privileged employee interactions.

#### Scenario: Admin offboarding request succeeds
- **WHEN** a tenant admin triggers offboarding for an active employee
- **THEN** the employee status is updated to `OFFBOARDED` and further employee-only actions are denied

#### Scenario: Delegated remover offboarding request succeeds
- **WHEN** an approved employee with `canRemove=true` triggers offboarding for an active employee
- **THEN** the employee status is updated to `OFFBOARDED` and actor identity is captured for audit

#### Scenario: Unauthorized remover is rejected
- **WHEN** an employee without remove permission triggers offboarding
- **THEN** the system rejects the request with forbidden outcome and does not change target employee status

#### Scenario: Repeated offboarding is idempotent
- **WHEN** an authorized actor repeats offboarding for an already offboarded employee
- **THEN** the system returns success without creating conflicting state
