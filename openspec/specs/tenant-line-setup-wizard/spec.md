# Capability: tenant-line-setup-wizard

## Purpose
TBD - Synced from change mvp-line-identity-digital-id-killswitch.

## Requirements


### Requirement: Tenant LINE credentials MUST be stored and validated securely
The system SHALL allow tenant administrators to submit LINE Channel ID and Channel Secret, and SHALL validate the credentials before marking the tenant as connected. Secrets MUST be stored outside application code and MUST NOT be returned in API responses.

#### Scenario: Valid credentials are accepted
- **WHEN** an admin submits valid LINE Channel ID and Channel Secret
- **THEN** the system stores the secret in managed secret storage and marks the tenant LINE connection as active

#### Scenario: Invalid credentials are rejected
- **WHEN** an admin submits invalid LINE credentials
- **THEN** the system rejects the connection request and does not persist an active connection state

### Requirement: LINE resource provisioning MUST be idempotent
The system SHALL auto-provision required LINE resources (LIFF app, Rich Menu, webhook endpoint metadata) for a connected tenant. Re-running provisioning for the same tenant MUST NOT create duplicate resources.

#### Scenario: First provisioning creates resources
- **WHEN** an admin runs setup for a tenant with no provisioned LINE resources
- **THEN** the system creates required LINE resources and records their resource identifiers

#### Scenario: Re-provisioning does not duplicate resources
- **WHEN** an admin retries setup for a tenant that already has provisioned resources
- **THEN** the system reuses existing resource identifiers or updates in place without creating duplicates

### Requirement: Webhook verification MUST complete before setup is marked done
The system SHALL provide a tenant-specific webhook URL and SHALL require verification before setup status is marked complete.

#### Scenario: Webhook verification succeeds
- **WHEN** LINE sends a valid verification request to the tenant webhook URL
- **THEN** the system marks webhook status as verified and setup status as completed

#### Scenario: Webhook verification fails
- **WHEN** webhook verification cannot be completed
- **THEN** the system keeps setup status in incomplete state and returns actionable failure information to the admin
