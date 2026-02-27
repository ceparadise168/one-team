# One-Team: Roadmap & Project Specification

## Vision

用 LINE 解放所有負責員工福利的台灣企業 HR — Use LINE, Taiwan's most ubiquitous platform (~21M users, 90%+ penetration), to liberate every HR professional managing employee benefits.

## Problem

Taiwan's ~970K companies (mostly SMEs < 200 employees) still manage employee benefits via spreadsheets, paper forms, and fragmented vendor relationships. HR teams spend disproportionate time on manual benefit tracking, enrollment communication, reimbursement processing, and compliance reporting. Employees resist downloading standalone HR apps — adoption rates for traditional employee apps hover around 20-30%.

## Insight

LINE is already where employees communicate. By embedding identity, benefits, and HR workflows directly into LINE, adoption friction drops to near zero. HR gets a single platform to manage the full employee benefit lifecycle.

---

## Phase Overview

| Phase | Name | Objective |
|-------|------|-----------|
| 0 | **Foundation** (done) | Identity + offboarding core |
| 1 | **Production Hardening** | Ship-ready reliability |
| 2 | **Employee Portal** | Self-service employee experience via LIFF |
| 3 | **Benefits Engine** | Flexible benefit management + perks wallet |
| 4 | **HR Command Center** | Admin dashboard + analytics + vendor integrations |
| 5 | **Platform & Scale** | Multi-tenant SaaS, billing, marketplace |

---

## Phase 0: Foundation (Complete)

### What Exists Today

**Core Capabilities**:
- Tenant setup wizard (5-min LINE channel connection + Rich Menu/LIFF provisioning)
- Employee invitation & binding (link/QR/batch-email → LINE Login + employee ID + one-time code)
- Dynamic digital employee ID (30-second rotating HMAC-signed payload)
- Scanner verification API
- Offboarding kill switch (session revocation, Rich Menu unlink, blacklist, audit trail)
- Approval-based access governance (canInvite, canRemove permissions)
- Delegated administration (approved employees can invite/offboard)

**Architecture**:
- Node.js Lambda + API Gateway + DynamoDB (6 tables) + SQS (provisioned, not wired)
- Dual-mode: in-memory (dev/CI) ↔ DynamoDB (prod)
- Pluggable LINE clients: stub (testing) ↔ real (production)
- 22 API routes, 6 domain services, 11 repository interfaces
- Comprehensive test coverage (unit + integration + E2E + smoke)

**Known Gaps Carried Forward**:
- SQS queues provisioned but not consumed (email dispatch, async offboarding)
- Email sending stubbed (not yet integrated with external mail service)
- Webhook event handling is signature-only (no business logic)
- Admin auth is static bearer token
- Frontend 80% stubbed
- No i18n

---

## Phase 1: Production Hardening

**Objective**: Make the MVP production-grade — reliable, secure, and observable enough to onboard pilot customers.

### 1.1 Wire Async Processing (SQS) + Pluggable Email

Connect SQS queues to Lambda consumers and build a pluggable email adapter.

- **Email adapter interface** (pluggable, same pattern as LINE client):
  - `MockEmailAdapter` — logs to console/file for local dev and CI
  - `ExternalEmailAdapter` — integrates with external mail service (e.g., Resend, SendGrid, Mailgun)
  - Adapter selected via env var `EMAIL_ADAPTER_MODE=mock|external`
- **Invitation email worker**: SQS → Lambda → Email adapter with invitation link
  - Template: zh-TW email with tenant name, invite link, QR code, expiry
  - DLQ retry with backoff
- **Offboarding worker**: SQS → Lambda → Rich Menu unlink + cleanup
  - Replaces current synchronous offboarding job retry
  - Exponential backoff, max 5 attempts

### 1.2 Webhook Event Handling

Process LINE webhook events beyond signature validation.

- **Follow event**: Auto-send welcome Flex Message with binding instructions
- **Unfollow event**: Log analytics event, mark employee as LINE-disconnected
- **Postback event**: Route Rich Menu button taps to LIFF URLs or API actions
- Idempotency guard (event dedup by webhook event ID)

### 1.3 Security Hardening

Replace dev-grade auth with production-ready mechanisms.

- **Admin auth**: Replace static `ADMIN_TOKEN` with JWT-based admin sessions (email + password or SSO)
- **IAM least-privilege**: Scope Lambda roles per resource (table-level, secret-level)
- **Secret rotation**: Automated rotation for LINE channel secrets via Secrets Manager rotation Lambda
- **Rate limiting**: Per-tenant throttling beyond global WAF rules
- **CORS & CSP**: Proper headers for LIFF and admin-web origins

### 1.4 Observability

Structured logging, metrics, and alerting for production operations.

- Structured JSON logging (request ID, tenant ID, action, latency)
- CloudWatch custom metrics: binding rate, offboarding latency, digital ID verify rate
- Alarms: 5xx spike, SQS DLQ depth, offboarding backlog
- X-Ray tracing for Lambda + DynamoDB

### 1.5 i18n Foundation

Internationalization framework for zh-TW primary, en secondary.

- Message catalog system (JSON-based, lazy-loaded)
- All user-facing strings extracted: error messages, email templates, Rich Menu labels, LIFF UI
- LINE Flex Messages templated with locale support

### Success Metrics (Phase 1)
- Email delivery rate ≥ 98%
- Offboarding async p95 ≤ 30 seconds
- Zero unhandled webhook event drops
- Admin login with per-user audit trail
- All CloudWatch alarms configured

---

## Phase 2: Employee Portal (LIFF)

**Objective**: Build the employee-facing experience — everything an employee interacts with lives inside LINE via LIFF pages.

### 2.1 Employee Profile & Onboarding

Self-service employee profile management after binding.

- **Profile page** (LIFF): Display name, department, position, photo, employment date
- **Profile editing**: Update display name, photo (cropped avatar)
- **Onboarding checklist**: Guided steps after first binding (complete profile, view digital ID, enroll benefits)
- **Employee directory**: Search colleagues by name/department (privacy-controlled)

**Data model**:
```
EmployeeProfileRecord {
  tenantId, employeeId
  displayName, displayNameEn
  department, position
  avatarUrl
  joinDate
  profileCompletedAt
}
```

**LINE integration**:
- Rich Menu "我的資料" (My Profile) button → LIFF profile page
- Push message on first binding: welcome + onboarding checklist

### 2.2 Digital ID Enhanced

Upgrade the digital ID card from minimal to polished.

- **Visual ID card**: Company logo, employee photo, name, department, QR code (dynamic)
- **Offline mode**: Cached last-valid card for brief connectivity gaps
- **Apple Wallet / Google Wallet**: Export static ID to mobile wallet (supplementary)
- **NFC tap**: Future-ready payload format for NFC badge readers

### 2.3 Announcement & Communication Hub

HR sends targeted messages to employees via LINE.

- **Announcements** (LIFF page): Scrollable announcement feed with read receipts
- **Targeted push**: By department, position, or custom segment
- **Flex Message templates**: Rich card layouts for announcements, reminders, surveys
- **Read tracking**: Analytics on open rates per announcement

**Data model**:
```
AnnouncementRecord {
  tenantId, announcementId
  title, body, category
  targetSegment (all | department:X | custom:[ids])
  publishedAt, expiresAt
  createdBy
}

AnnouncementReadRecord {
  tenantId, announcementId, employeeId
  readAt
}
```

**LINE integration**:
- Push Flex Message with announcement preview + "查看詳情" (View Details) CTA → LIFF
- Rich Menu "公告" (Announcements) button → LIFF announcement feed

### 2.4 Leave & Absence Quick Actions

Lightweight leave requests via LINE (not a full HRIS replacement).

- **Quick leave request**: Select leave type, date range, reason → submit for approval
- **Leave balance**: View remaining PTO, sick leave, special leave
- **Manager approval**: LINE push notification → approve/reject via Flex Message button
- **Calendar view**: Team absence calendar (LIFF page)

**Data model**:
```
LeaveRequestRecord {
  tenantId, requestId
  employeeId, approverEmployeeId
  leaveType (annual | sick | personal | marriage | funeral | maternity | paternity)
  startDate, endDate, reason
  status (PENDING | APPROVED | REJECTED | CANCELLED)
  decidedAt, decidedBy
}

LeaveBalanceRecord {
  tenantId, employeeId
  leaveType, totalDays, usedDays, year
}
```

**LINE integration**:
- Rich Menu "請假" (Leave) button → LIFF leave request form
- Push notification to approver with approve/reject Flex Message buttons
- Postback handler for quick-approve actions

### 2.5 Rich Menu Evolution

Context-aware Rich Menu that adapts to employee state.

- **State machine**: Unbound → Pending → Approved → has specific role permissions
- **Menu layouts**:
  - Pending: "申請開通" | "數位員工證" | "聯繫 HR"
  - Approved: "福利中心" | "數位員工證" | "請假" | "公告" | "我的資料" | "更多"
  - Manager: adds "團隊管理" (Team Management) section

### Success Metrics (Phase 2)
- Profile completion rate ≥ 80% within first week
- Announcement read rate ≥ 70%
- Leave request submission via LINE ≥ 60% of total requests
- LIFF page load time p95 ≤ 2 seconds

---

## Phase 3: Benefits Engine

**Objective**: The core value proposition — a flexible benefits management system that replaces spreadsheets, forms, and email chains. **Priority**: Reimbursement flow first (highest HR pain point), then catalog and flex points.

### 3.1 Reimbursement Flow (Priority)

Employees submit benefit reimbursement claims with receipts. This is the most time-consuming manual process for HR today — paper receipts, email chains, spreadsheet tracking.

- **Claim submission**: Photo of receipt + amount + category → LIFF form
- **Approval workflow**: Auto-approve under threshold, manager approval above threshold
- **Receipt OCR**: Extract amount, date, vendor from receipt photo (future: AI-assisted)
- **Status tracking**: SUBMITTED → UNDER_REVIEW → APPROVED → PAID / REJECTED
- **Export**: HR exports approved claims for payroll integration (CSV)
- **Policy rules**: Per-category monthly/annual caps, required receipt for amounts > threshold

**Data model**:
```
ReimbursementClaimRecord {
  tenantId, claimId
  employeeId, benefitId (optional)
  amount, currency (TWD)
  category, description
  receiptUrl (S3)
  status (SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED | PAID)
  submittedAt, reviewedAt, reviewedBy, paidAt
  rejectionReason
}

ReimbursementPolicyRecord {
  tenantId, policyId
  category (MEAL | TRANSPORT | HEALTH | TRAINING | OTHER)
  monthlyCapTwd, annualCapTwd
  autoApproveThresholdTwd
  requiresReceipt: boolean
  requiresManagerApproval: boolean
}
```

**Infrastructure**:
- S3 bucket for receipt uploads (with lifecycle policies)
- Pre-signed URL generation for secure upload/download

**LINE integration**:
- Rich Menu "報銷" (Reimbursement) button → LIFF claim submission form
- Push notification to approver with claim details + approve/reject Flex Message
- Push notification to employee on status change
- Monthly summary: "本月已報銷 NT$X,XXX / 額度 NT$X,XXX"

### 3.2 Benefits Catalog

HR defines available benefits; employees browse and enroll.

- **Benefit types**:
  - 固定福利 (Fixed): group insurance, health check subsidies, meal allowance
  - 彈性福利 (Flexible): chosen from catalog up to a budget (flex points)
  - 節日福利 (Holiday): lunar new year bonus, dragon boat, mid-autumn
  - 生命事件 (Life events): wedding, birth, funeral subsidies
- **Enrollment periods**: Open enrollment windows with deadlines
- **Eligibility rules**: By tenure, department, position, employment type

**Data model**:
```
BenefitRecord {
  tenantId, benefitId
  name, nameEn, description
  category (FIXED | FLEX | HOLIDAY | LIFE_EVENT)
  pointCost (for flex benefits)
  eligibility { minTenureMonths, departments[], positions[], employmentTypes[] }
  enrollmentWindow { opensAt, closesAt }
  maxEnrollments
  vendorId (optional)
  status (ACTIVE | ARCHIVED)
}

BenefitEnrollmentRecord {
  tenantId, enrollmentId
  employeeId, benefitId
  enrolledAt, status (ACTIVE | CANCELLED | EXPIRED)
  year
}
```

**LINE integration**:
- Rich Menu "福利中心" (Benefits Center) → LIFF benefits catalog
- Push reminder before enrollment deadline
- Flex Message card per benefit with "立即申請" (Apply Now) CTA

### 3.3 Perks Wallet (Flex Points)

Each employee gets an annual flexible benefit budget expressed as points.

- **Point allocation**: HR sets annual budget per employee (or by tier/department)
- **Point spending**: Employees allocate points to catalog benefits
- **Balance tracking**: Real-time point balance, transaction history
- **Expiration**: Points expire at fiscal year end (configurable)
- **Top-up**: HR can issue bonus points (recognition, special events)

**Data model**:
```
PerksWalletRecord {
  tenantId, employeeId
  year, totalPoints, usedPoints, expiredPoints
  lastUpdatedAt
}

PointTransactionRecord {
  tenantId, transactionId
  employeeId, amount (positive = credit, negative = debit)
  type (ANNUAL_ALLOCATION | BENEFIT_SPEND | BONUS | EXPIRATION | REVERSAL)
  referenceId (benefitEnrollmentId or adminAction)
  createdAt, note
}
```

**LINE integration**:
- "我的點數" (My Points) section in LIFF
- Push notification on point allocation and spending
- Monthly balance summary Flex Message

### 3.4 Recognition & Rewards

Peer-to-peer and manager-to-employee recognition with tangible rewards.

- **Kudos**: Employees send recognition messages to peers (visible in company feed)
- **Manager rewards**: Managers award bonus points for exceptional work
- **Leaderboard**: Monthly recognition leaderboard (opt-in)
- **Badges**: Achievement badges (tenure milestones, recognition count)

**Data model**:
```
RecognitionRecord {
  tenantId, recognitionId
  fromEmployeeId, toEmployeeId
  message, category (TEAMWORK | INNOVATION | SERVICE | LEADERSHIP | CUSTOM)
  pointsAwarded (0 for kudos, >0 for rewards)
  createdAt
}
```

**LINE integration**:
- Push notification when recognized
- Flex Message with recognition card (sender, message, badge)
- Rich Menu "讚美同事" (Recognize Colleague) → LIFF recognition form

### Success Metrics (Phase 3)
- Benefit enrollment rate ≥ 85%
- Points utilization rate ≥ 70% by year end
- Reimbursement claim processing time p50 ≤ 3 business days
- Recognition participation ≥ 40% of employees monthly

---

## Phase 4: HR Command Center

**Objective**: Give HR a powerful admin dashboard — the control plane for the entire platform.

### 4.1 Admin Web Application

Full-featured admin SPA (React) replacing API-only administration.

- **Dashboard**: Active employees, pending approvals, benefit utilization, recent activity
- **Employee management**: List, search, filter, view profile, edit permissions, offboard
- **Invitation management**: Create/revoke invitations, track binding status
- **Access governance**: Approval queue with bulk actions
- **Audit log viewer**: Searchable, filterable audit trail

### 4.2 Benefits Administration

HR creates, manages, and monitors benefit programs.

- **Benefit builder**: Create/edit benefits with eligibility rules, enrollment windows
- **Points management**: Set annual budgets, issue bonus points, view utilization
- **Enrollment reports**: Who enrolled in what, by department, by period
- **Reimbursement queue**: Review/approve claims, export for payroll
- **Vendor management**: Link benefits to vendor partners

### 4.3 Analytics & Reporting

Data-driven insights for HR decision-making.

- **Utilization dashboard**: Benefit usage rates, points burn rate, popular benefits
- **Cost analysis**: Total benefit cost by department, category, period
- **Employee engagement**: Announcement read rates, recognition activity, LIFF usage
- **Compliance reports**: Enrollment compliance, mandatory benefit coverage
- **Export**: CSV/PDF report generation

### 4.4 Vendor Integration Framework

Connect benefit vendors to the platform.

- **Vendor portal**: Vendors register, list offerings, track redemptions
- **API integration**: Standardized webhook for benefit redemption/verification
- **Categories**: Restaurants (meal subsidies), gyms (fitness), clinics (health check), insurance, training providers
- **Settlement**: Monthly settlement reports per vendor

**Data model**:
```
VendorRecord {
  vendorId, tenantId (null for platform-wide)
  name, category, contactEmail
  apiEndpoint (optional), apiKey (optional)
  status (ACTIVE | SUSPENDED)
}

RedemptionRecord {
  tenantId, redemptionId
  employeeId, vendorId, benefitId
  amount, redeemedAt
  vendorConfirmationId
  status (PENDING | CONFIRMED | FAILED)
}
```

### Success Metrics (Phase 4)
- HR admin task completion time reduced by 60%
- Report generation ≤ 10 seconds for standard reports
- Vendor integration setup ≤ 30 minutes
- Admin dashboard daily active usage ≥ 80% of HR users

---

## Phase 5: Platform & Scale

**Objective**: Transform One-Team from a product into a multi-tenant SaaS platform.

### 5.1 Multi-Tenant SaaS

Self-service tenant onboarding with subscription billing.

- **Signup flow**: Company registers → selects plan → connects LINE → onboards
- **Tenant isolation**: Data partitioning, compute isolation, custom domains
- **Plan tiers**:
  - **Starter** (免費 / Free): ≤ 30 employees, basic identity + digital ID
  - **Professional** (專業版): ≤ 200 employees, full benefits + analytics
  - **Enterprise** (企業版): Unlimited, SSO, custom integrations, dedicated support

### 5.2 Billing & Subscription

Usage-based billing with self-service payment.

- **Payment**: Credit card (Stripe/TapPay for Taiwan), bank transfer for Enterprise
- **Billing cycle**: Monthly or annual (annual = 2 months free)
- **Usage metering**: Employee count, message volume, storage
- **Invoice generation**: Taiwan-compliant 電子發票 (e-invoice) integration

### 5.3 Benefits Marketplace

Platform-wide vendor marketplace (not per-tenant).

- **Curated vendors**: Pre-negotiated corporate rates for common benefits
- **Employee discovery**: Browse vendors by category, location, rating
- **Group buying**: Aggregate demand across tenants for better pricing
- **Reviews & ratings**: Employee feedback on vendor experiences

### 5.4 Advanced LINE Integration

Deeper LINE ecosystem leverage.

- **LINE Pay**: Direct benefit redemption payment via LINE Pay
- **LINE Notify**: Lightweight notification channel for non-critical alerts
- **LINE MINI App**: Richer app experience beyond LIFF limitations
- **LINE Beacon**: Physical presence detection for office/venue check-in
- **LINE Things**: IoT integration for smart office benefits

### 5.5 Enterprise Features

Features required by larger organizations.

- **SSO integration**: SAML/OIDC with corporate identity providers
- **HRIS sync**: Bidirectional sync with common Taiwan HRIS (104, 1111, Nueip, Apollo)
- **Custom workflows**: Configurable approval chains
- **API access**: Tenant API keys for custom integrations
- **Data residency**: Taiwan-local data storage guarantee
- **SLA**: 99.9% uptime commitment

### Success Metrics (Phase 5)
- Self-service tenant onboarding ≤ 15 minutes
- Monthly recurring revenue growth ≥ 20% MoM
- Vendor marketplace ≥ 50 active vendors
- Enterprise pipeline ≥ 10 companies

---

## Cross-Cutting Concerns

### Security & Compliance

| Concern | Approach |
|---------|----------|
| 個資法 (PDPA) compliance | Data minimization, consent management, right to deletion, breach notification SOP |
| Data encryption | At-rest (DynamoDB SSE, S3 SSE), in-transit (TLS 1.2+), field-level for PII |
| Access control | RBAC with roles (super-admin, tenant-admin, HR, manager, employee) |
| Audit trail | Immutable audit log for all state changes, 7-year retention |
| Penetration testing | Annual pentest, OWASP Top 10 checklist per release |
| Secret management | AWS Secrets Manager with automated rotation |

### i18n Strategy

- Primary: zh-TW (Traditional Chinese)
- Secondary: en
- All user-facing strings in message catalogs
- LINE messages, LIFF UI, admin-web, email templates
- Date/currency formatting: Taiwan conventions (民國 year optional, TWD)

### Testing Strategy Evolution

| Phase | Testing |
|-------|---------|
| 1 | SQS consumer integration tests, webhook E2E tests, load testing baseline |
| 2 | LIFF component tests (React Testing Library), visual regression tests |
| 3 | Benefits engine property-based tests, reimbursement workflow E2E |
| 4 | Admin dashboard Cypress E2E, analytics accuracy tests |
| 5 | Multi-tenant isolation tests, billing integration tests, chaos testing |

### Infrastructure Evolution

| Phase | Changes |
|-------|---------|
| 1 | Wire SQS → Lambda, pluggable email adapter (mock/external), X-Ray, CloudWatch dashboards |
| 2 | S3 for assets, CloudFront for LIFF/admin-web hosting, EventBridge for scheduled tasks |
| 3 | S3 for receipts, DynamoDB Streams for aggregation, Step Functions for approval workflows |
| 4 | Athena/QuickSight for analytics, or custom aggregation pipeline |
| 5 | Multi-account strategy, custom domains (Route 53), Stripe/TapPay integration, CDN edge |

---

## Monetization Model

### Revenue Streams

1. **SaaS subscription** (core): Per-employee-per-month pricing
   - Starter: Free (≤ 30 employees) — lead generation
   - Professional: ~NT$30/employee/month (~US$1)
   - Enterprise: Custom pricing, starts ~NT$50/employee/month
2. **Marketplace commission**: 5-10% on vendor transactions
3. **Premium features**: Advanced analytics, custom integrations, priority support
4. **Setup fee**: Enterprise onboarding + HRIS integration (one-time)

### TAM Estimate

- Taiwan companies with 10-500 employees: ~150K companies
- Average 80 employees per company
- At NT$30/employee/month: ~NT$4.3B/year TAM (~US$140M)
- Serviceable: 1% penetration year 1 = ~NT$43M (~US$1.4M ARR)
