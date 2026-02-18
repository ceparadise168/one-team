## MODIFIED Requirements

### Requirement: LINE resource provisioning MUST be idempotent
The system SHALL auto-provision required LINE resources (LIFF app, webhook endpoint metadata, pending Rich Menu, approved Rich Menu) for a connected tenant. Re-running provisioning for the same tenant MUST NOT create duplicate resources and SHALL preserve existing resource identifiers when already present.

#### Scenario: First provisioning creates dual Rich Menu resources
- **WHEN** an admin runs setup for a tenant with no provisioned LINE resources
- **THEN** the system creates required resources including both pending and approved rich menus and records their identifiers

#### Scenario: Re-provisioning reuses dual menu resources
- **WHEN** an admin retries setup for a tenant with existing pending and approved rich menu identifiers
- **THEN** the system reuses existing identifiers or updates resources in place without creating duplicates

#### Scenario: Provisioning response remains backward compatible
- **WHEN** setup status is queried after provisioning
- **THEN** the response includes both pending/approved rich menu identifiers and a compatibility alias for existing consumers
