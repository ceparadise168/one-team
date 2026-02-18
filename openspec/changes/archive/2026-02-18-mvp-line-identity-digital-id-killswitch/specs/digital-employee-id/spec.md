## ADDED Requirements

### Requirement: Digital employee ID payload MUST rotate every 30 seconds
The system SHALL generate a signed dynamic employee ID payload for LIFF that changes every 30 seconds and includes expiration metadata.

#### Scenario: New payload is issued on new time window
- **WHEN** an active employee requests digital ID payloads across two adjacent 30-second windows
- **THEN** the system returns different payload values with updated expiration times

#### Scenario: Payload includes verifiable metadata
- **WHEN** the system issues a digital ID payload
- **THEN** the payload includes tenant identifier, employee identifier, issued timestamp, expiry timestamp, and signature data

### Requirement: Verification API MUST validate signature, time window, and employment status
The system SHALL provide an online verification endpoint that validates payload integrity and rejects payloads for inactive, offboarded, or blacklisted employees.

#### Scenario: Active employee payload verifies successfully
- **WHEN** scanner service submits a valid unexpired payload for an active employee
- **THEN** verification returns valid status and employee identity metadata allowed for scanner use

#### Scenario: Offboarded employee payload is rejected
- **WHEN** scanner service submits a payload for an offboarded or blacklisted employee
- **THEN** verification returns invalid status with rejection reason indicating access revoked

### Requirement: Verification responses MUST return machine-readable reason codes
The system SHALL return a normalized verification result with reason codes to support scanner-side handling.

#### Scenario: Expired payload response contains reason code
- **WHEN** scanner service submits an expired payload
- **THEN** verification returns invalid status with reason code `EXPIRED`

#### Scenario: Signature mismatch response contains reason code
- **WHEN** scanner service submits a tampered payload
- **THEN** verification returns invalid status with reason code `SIGNATURE_INVALID`
