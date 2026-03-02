# Phase 2 Design: LINE Mini App + Volunteer Service

> Approved: 2026-03-01

## 1. Product Strategy

### Stakeholder Map

```
Employee (user)     → Convenient sign-up, one-tap in LINE
Department lead     → No more manual form collection & Excel compilation
HR (decision maker) → Auto-aggregated data, compliance records, easy audit
Management          → Higher volunteer participation = better ESG/CSR numbers
```

### Value Proposition for HR

| Layer | Pain Point | ONE TEAM Solution | Impact |
|-------|-----------|-------------------|--------|
| Save effort | Collect from Teams/Google Form/paper → manually compile Excel | System auto-aggregates registration, check-in, export | Save 1-2 hours per event |
| Boost participation | EIP sign-up system has poor UX → low registration rate | One-tap sign-up in LINE, reach rate > EIP | Estimated 30-50% increase |
| Compliance & audit | Volunteer hours, insurance records scattered everywhere | Systematic check-in records + reports, queryable anytime | Audit prep from days to minutes |

### Go-to-Market Strategy

**Entry point**: Find an upcoming volunteer event, run ONE TEAM as a pilot for the full flow.

**Persuasion path**:
1. Show HR: "This event's registration, check-in, and reports — all completed in LINE"
2. After the event: present system-generated report (contrast with manual Excel)
3. HR experiences value → formal adoption → other advanced services gain traction

**Why volunteer service is the best entry**:
- Moderate frequency (not too frequent to cause pressure, not too rare to show value)
- Touches HR core responsibility (hour certification, insurance)
- Low failure cost (event happens regardless of system issues)
- Natural extension: "If volunteers can be managed this way, can other services too?"

## 2. System Architecture

### Overview

```
+-----------------------------------------------------------+
|                    LINE Platform                           |
|                                                            |
|  Rich Menu (basic entry)        Mini App (advanced)        |
|  +--------------------+    +---------------------------+   |
|  | Activate|ID|Service|    | /volunteer  Volunteer      |   |
|  +--+------+----+-----+    | /voting     Voting (future)|   |
|     |       |    |          | /packages   Packages (fut) |   |
|     v       v    v          | /repair     Repair (fut)   |   |
|  Postback  Flex  Flex ----->| /visitor    Visitor (fut)  |   |
|  Handler   Msg   Msg       +-------------+--------------+   |
|                 (svc list)                |                   |
+-------------------------------------------+------------------+
                                            |
                  +-------------------------v----------------+
                  |         API Gateway (existing)           |
                  |  /v1/webhook/line/:tenantId               |
                  |  /v1/admin/...                            |
                  |  /v1/me/...                               |
                  |  /v1/volunteer/...  <-- NEW               |
                  +-------------------------+----------------+
                                            |
                  +-------------------------v----------------+
                  |         Lambda (existing, extended)       |
                  |                                           |
                  |  WebhookEventService    (existing)        |
                  |  VolunteerService       <-- NEW           |
                  +-------------------------+----------------+
                                            |
                  +-------------------------v----------------+
                  |       DynamoDB (existing + new table)     |
                  |                                           |
                  |  employees table        (existing)        |
                  |  volunteer table        <-- NEW           |
                  +------------------------------------------+
```

### Entry Flow

```
Employee taps Rich Menu "Employee Services"
        |
        v
  Postback: action=services_menu
        |
        v
  API returns Flex Message service list
  +-------------------------------+
  |  Employee Services            |
  |                               |
  |  [Volunteer]   [Voting]       |  <-- enabled: full color + Mini App URI
  |  [Packages]    [Repair]       |  <-- disabled: greyed out + "Coming soon"
  |  [Visitor]                    |
  +-------------------------------+
        |
        v (tap "Volunteer")
        |
  Opens Mini App -> /volunteer
```

**Design decisions**:
- Rich Menu keeps existing 3-button layout (activate, ID card, services) — unchanged
- Service list delivered via Flex Message, dynamically controlled by a simple array:
  ```typescript
  const enabledServices = ['volunteer'];
  ```
- Disabled services shown greyed out with "Coming soon" label; tapping shows text reply
- Adding/removing services = change one array, no rich menu rebuild needed

### Mini App Channel

| Item | Value |
|------|-------|
| Channel type | LINE Mini App |
| Endpoint URL | `https://miniapp.{domain}/` |
| LIFF SDK | `@line/liff ^2.27.x` (unchanged) |
| Initial status | Unverified (no review, publish immediately) |
| Verification timing | After MVP pilot is stable |
| Hosting | S3 + CloudFront (CDK managed) |

### Auth Integration (Critical)

Mini App creates a new channel with a different channel ID than the existing LINE Login channel. Current auth flow validates ID tokens using tenant's `loginChannelId`.

**Solution**: Configure the Mini App channel as the tenant's `loginChannelId`, OR add `miniAppChannelId` to tenant credentials and support multiple valid channel IDs during token verification.

The auth flow itself is unchanged:
1. `liff.init({ liffId: miniAppLiffId })`
2. `liff.getIDToken()` → send to `/v1/public/auth/line-login`
3. Server verifies ID token via LINE API using configured channel ID
4. Returns session token (access + refresh)

### Frontend Structure

Stays in `liff-web/` (no rename). Internal restructure only:

```
apps/liff-web/src/
  main.tsx                    <-- Add React Router
  features/
    registration/             <-- Existing (moved here)
    digital-id/               <-- Existing (moved here)
    volunteer/                <-- NEW
      activity-list.tsx
      activity-detail.tsx
      create-activity.tsx
      check-in.tsx
      use-volunteer.ts        <-- Single hook for API calls
```

**Principles**:
- Flat structure per feature (no nested pages/hooks/components dirs)
- No shared `common/` abstraction yet — inline `liff` + `fetch` in each feature
- Extract shared code when the second feature (voting) arrives and duplication emerges

### Backend Structure

Single new service file, following existing Service -> Repository -> Domain pattern:

```
apps/api/src/
  services/
    volunteer-service.ts      <-- All volunteer logic (CRUD, registration, check-in, report)
  repositories/
    volunteer-repository.ts   <-- DynamoDB access for volunteer table
```

No pre-split of check-in-service or report-service. Split when complexity warrants it.

### Relationship to Phase 1

| Component | Phase 1 (keep) | Phase 2 (change) |
|-----------|----------------|-------------------|
| Rich Menu | 3 buttons unchanged | Unchanged |
| `services_menu` postback | Simple menu | **Change to**: Flex Message with Mini App links |
| Employee ID card | Flex Message | Keep Flex Message (also accessible from Mini App) |
| Registration | Inline chat | Keep (also accessible from Mini App) |
| API Lambda | Existing routes | **Extend**: add `/v1/volunteer/*` |
| DynamoDB | employees, tenants, audit-events... | **Add**: volunteer table |
| Frontend hosting | Not formally deployed | **Add**: S3 + CloudFront via CDK |

### Tenant Architecture: Frozen

- Phase 1 tenant code untouched (tested, stable)
- Set `DEFAULT_TENANT_ID` environment variable
- New APIs omit tenantId from URL path; server fills it automatically
  - Old: `/v1/admin/tenants/:tenantId/employees`
  - New: `/v1/volunteer/activities`
- New DynamoDB items include `tenantId` as a data field (for future-proofing) but NOT in pk/sk/GSI

## 3. Data Model

### New Table: `one-team-{stage}-volunteer`

Config: PAY_PER_REQUEST billing, point-in-time recovery enabled (consistent with existing tables).

#### Schema

```
pk                      sk                       Item Type
--------------------------------------------------------------
ACTIVITY#{activityId}   DETAIL                   Activity
ACTIVITY#{activityId}   REG#{employeeId}         Registration
ACTIVITY#{activityId}   CHECKIN#{employeeId}     Check-in
```

#### Activity

```typescript
{
  pk: 'ACTIVITY#a1b2c3',
  sk: 'DETAIL',
  entityType: 'VOLUNTEER_ACTIVITY',
  tenantId: 'default-tenant',        // frozen, stored for future
  activityId: 'a1b2c3',
  title: 'Beach Cleanup Volunteer',
  description: '...',
  location: 'Wanli, New Taipei',
  activityDate: '2026-04-15',
  startTime: '09:00',
  endTime: '16:00',
  capacity: 30,                       // null = unlimited
  checkInMode: 'organizer-scan',      // 'organizer-scan' | 'self-scan'
  selfScanPayload: '...',            // Pre-generated QR payload (self-scan mode only)
  status: 'OPEN',                     // OPEN | CLOSED | CANCELLED
  createdBy: 'E001',
  createdAt: '2026-03-15T10:00:00Z',

  // GSI projection attributes
  gsi_status: 'OPEN',
  activity_date: '2026-04-15',
}
```

Note: No `registrationCount` field. Count is derived on read via `sk begins_with REG#` query.

#### Registration

```typescript
{
  pk: 'ACTIVITY#a1b2c3',
  sk: 'REG#E001',
  entityType: 'VOLUNTEER_REGISTRATION',
  tenantId: 'default-tenant',
  activityId: 'a1b2c3',
  employeeId: 'E001',
  registeredAt: '2026-03-16T08:30:00Z',
  status: 'REGISTERED',               // REGISTERED | CANCELLED

  // GSI projection attributes
  employee_id: 'E001',
  registered_at: '2026-03-16T08:30:00Z',
}
```

#### CheckIn

```typescript
{
  pk: 'ACTIVITY#a1b2c3',
  sk: 'CHECKIN#E001',
  entityType: 'VOLUNTEER_CHECKIN',
  tenantId: 'default-tenant',
  activityId: 'a1b2c3',
  employeeId: 'E001',
  checkedInAt: '2026-04-15T09:05:00Z',
  checkedInBy: 'E002',               // Only set in organizer-scan mode
  mode: 'organizer-scan',
}
```

#### GSIs

| GSI Name | pk | sk | Purpose |
|----------|----|----|---------|
| `gsi-status-date` | `gsi_status` | `activity_date` | List upcoming activities |
| `gsi-employee` | `employee_id` | `registered_at` | My registrations |

#### Access Patterns

| Access Pattern | Query |
|---------------|-------|
| List upcoming activities | GSI `gsi-status-date`: pk=OPEN, sk > today |
| Activity detail | pk=ACTIVITY#{id}, sk=DETAIL |
| Registration count | pk=ACTIVITY#{id}, sk begins_with REG#, count items |
| All registrations for activity | pk=ACTIVITY#{id}, sk begins_with REG# |
| All check-ins for activity | pk=ACTIVITY#{id}, sk begins_with CHECKIN# |
| My registrations | GSI `gsi-employee`: pk=employeeId |
| HR report (full activity data) | pk=ACTIVITY#{id} (returns DETAIL + REG + CHECKIN in one query) |

## 4. API Design

All endpoints require authenticated employee (session token). No tenantId in URL.

```
Activity Management
----------------------------------------------------
GET    /v1/volunteer/activities              List activities (?status=OPEN&from=2026-04-01)
POST   /v1/volunteer/activities              Create activity
GET    /v1/volunteer/activities/:id          Activity detail (includes registration count)
PATCH  /v1/volunteer/activities/:id          Update activity (creator only)
DELETE /v1/volunteer/activities/:id          Cancel activity (creator only)

Registration
----------------------------------------------------
POST   /v1/volunteer/activities/:id/register     Register
DELETE /v1/volunteer/activities/:id/register     Cancel registration
GET    /v1/volunteer/my-activities               My registrations

Check-in
----------------------------------------------------
POST   /v1/volunteer/activities/:id/check-in         Self-scan check-in
POST   /v1/volunteer/activities/:id/scan-check-in    Organizer scans employee

Reports
----------------------------------------------------
GET    /v1/volunteer/activities/:id/report           Activity report (registrations + check-ins)
GET    /v1/volunteer/activities/:id/report/export    Export CSV
```

Total: 10 endpoints.

### Report Permissions

- Activity creator (`createdBy`) can access their own activity's report
- Admin (existing `permissions.canInvite || permissions.canRemove`) can access all reports
- No new permission fields needed

### CSV Export

Zero-dependency CSV generation (no library needed):
```typescript
const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
// Return with Content-Type: text/csv
```

Fields: Employee ID, Name, Registration Time, Check-in Time, Check-in Mode.

## 5. Check-in Flows

### Organizer-Scan Mode (strict)

```
Organizer                       Employee                    Server
  |                               |                           |
  |  Open Mini App check-in page  |                           |
  |-----------------------------> |                           |
  |                               |  Show Digital ID QR       |
  |                               |  (existing mechanism)     |
  |  Scan employee QR ---------------------------------------->|
  |                               |         Verify Digital ID |
  |                               |        + Confirm registered|
  |                               |        + Write check-in   |
  |  <---------------------------------------- Check-in OK ---|
  |  Display: E001 Wang ✓         |                           |
```

**API**: `POST /v1/volunteer/activities/:id/scan-check-in`
```json
{ "digitalIdPayload": "base64url.signature" }
```
Reuses existing `DigitalIdService.verifyDynamicPayload()`.

### Self-Scan Mode (free attendance)

```
Organizer                       Employee                    Server
  |                               |                           |
  |  Display activity QR          |                           |
  |  (or print/post it)          |                           |
  |                               |  Open Mini App            |
  |                               |  Scan activity QR ------->|
  |                               |         Verify QR + auth  |
  |                               |        + Confirm registered|
  |                               |        + Write check-in   |
  |                               |  <----------- Check-in OK |
  |                               |  Display: ✓ Checked in    |
```

**Activity QR payload**: Pre-generated at activity creation, stored in Activity item.

```typescript
{
  v: 1,
  type: 'activity-checkin',
  activityId: 'a1b2c3',
  validFrom: '2026-04-15T08:30:00Z',   // 30 min before start
  validUntil: '2026-04-15T16:30:00Z',  // 30 min after end
}
// -> base64url(payload).base64url(hmac-sha256-signature)
```

**API**: `POST /v1/volunteer/activities/:id/check-in`
```json
{ "activityQrPayload": "base64url.signature" }
```

**Security note**: Self-scan QR is valid for the full event duration. Screenshot sharing is possible — this is by design for loosely-managed events. Organizers choosing this mode accept this trade-off.

## 6. Notification Design

### New Activity Created

**MVP approach**: No system push notification. Organizer uses `liff.shareTargetPicker()` to share the activity link to LINE groups/chats. Reasons:
- Avoids full-employee broadcast complexity
- LINE push messages have monthly quota and cost
- Organizer knows which groups are relevant
- ShareTargetPicker is a built-in LIFF feature, zero development cost

### Activity Cancelled

System sends `pushMessage()` to each registered employee (same pattern as existing admin notification):
```typescript
for (const registration of registrations) {
  try {
    await linePlatformClient.pushMessage({
      tenantId, lineUserId: registration.lineUserId,
      messages: [buildActivityCancelledFlexMessage(activity)]
    });
  } catch { /* best-effort */ }
}
```

## 7. Infrastructure Changes (CDK)

### New Resources

1. **DynamoDB table**: `one-team-{stage}-volunteer` with 2 GSIs
2. **S3 bucket**: `one-team-{stage}-miniapp` for Mini App static assets
3. **CloudFront distribution**: HTTPS + caching for Mini App
4. **Lambda environment variables**: `VOLUNTEER_TABLE_NAME`, `DEFAULT_TENANT_ID`

### Deployment

```bash
# Build Mini App
pnpm --filter @one-team/liff-web build

# Deploy infrastructure (includes S3 + CloudFront)
DEPLOY_STAGE=dev pnpm --filter @one-team/infra-cdk exec cdk deploy

# Deploy Mini App static assets
aws s3 sync apps/liff-web/dist/ s3://one-team-dev-miniapp/ --delete
```
