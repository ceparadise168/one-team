## MODIFIED Requirements

### Requirement: Offboarding MUST revoke active authentication sessions
The system SHALL revoke all active refresh sessions and MUST invalidate all tracked active access token identifiers (jti) for the offboarded employee at offboarding time.

#### Scenario: Active session use is rejected after offboarding
- **WHEN** an offboarded employee attempts to use a session or token issued before offboarding
- **THEN** the system rejects access with revoked-session outcome

#### Scenario: Active jti identifiers are revoked during offboarding
- **WHEN** offboarding processes an employee with active unexpired access tokens
- **THEN** the system writes those jti identifiers to revocation storage so subsequent token validation is rejected as revoked
