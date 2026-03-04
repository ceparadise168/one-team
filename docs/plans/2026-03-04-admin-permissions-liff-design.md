# Admin Permissions & LIFF Management Page Design

Date: 2026-03-04
Status: Approved

## Goal

Enable authorized employees to manage approvals and permissions directly from LINE, replacing the current admin-only postback message with a full LIFF management page.

## Scope

3 changes, all additive:

1. **Permission management API** — endpoints for granting/revoking `canInvite`/`canRemove` via admin token or authorized employee
2. **LIFF admin page** — new `/admin` page in liff-web with pending approvals + employee permission management
3. **LINE services menu update** — change "管理後台" from postback to URI action opening LIFF admin page

## 1. API Changes

### 1.1 `PUT /v1/admin/tenants/{tenantId}/employees/{employeeId}/permissions`

Admin-token-authenticated endpoint to set permissions on any employee.

```json
// Request
{ "canInvite": true, "canRemove": false }

// Response 200
{ "ok": true }
```

### 1.2 `PUT /v1/liff/tenants/{tenantId}/employees/{employeeId}/permissions`

Employee-authenticated endpoint. Caller must have `canInvite` permission.

```json
// Request
{ "canInvite": true, "canRemove": false }

// Response 200
{ "ok": true }
```

Validation:
- Caller must be APPROVED with `canInvite === true`
- Cannot modify own permissions (prevent self-lockout)
- Target must be APPROVED (can't grant permissions to pending/rejected)

### 1.3 `POST /v1/liff/tenants/{tenantId}/employees/{employeeId}/access-decision`

Employee-authenticated endpoint for approve/reject. Caller must have `canInvite` permission.

```json
// Request
{ "decision": "APPROVE" }
// or
{ "decision": "REJECT" }

// Response 200
{ "ok": true }
```

### 1.4 `GET /v1/liff/tenants/{tenantId}/employees`

Employee-authenticated endpoint to list employees. Caller must have `canInvite` or `canRemove` permission.

```json
// Response 200
{
  "employees": [
    {
      "employeeId": "E-001",
      "nickname": "王小明",
      "accessStatus": "PENDING",
      "accessRequestedAt": "2026-03-04T...",
      "permissions": { "canInvite": false, "canRemove": false }
    }
  ]
}
```

Query params: `?status=PENDING` or `?status=APPROVED` to filter.

## 2. LINE Services Menu Update

Change "管理後台" button from postback action to URI action:

```
Current: { type: 'postback', data: 'action=admin_dashboard' }
New:     { type: 'uri', uri: 'https://{liffDomain}/admin?accessToken={token}&tenantId={tenantId}&refreshToken={refreshToken}' }
```

This opens the LIFF admin page directly inside LINE's in-app browser.

## 3. LIFF Admin Page

### 3.1 Route: `/admin`

New page in liff-web, accessible only to employees with `canInvite` or `canRemove` permission.

### 3.2 Layout

```
┌──────────────────────────────┐
│ ← 返回服務                     │
│                               │
│ 管理後台                       │
│                               │
│ [待審核 (3)]  [全部員工]        │
│                               │
│ ┌────────────────────────────┐│
│ │ 王小明                      ││
│ │ E-001 · 2026-03-04 申請     ││
│ │                             ││
│ │  [核准]         [拒絕]      ││
│ └────────────────────────────┘│
│                               │
│ ┌────────────────────────────┐│
│ │ 張美玲                      ││
│ │ E-003 · 2026-03-03 申請     ││
│ │                             ││
│ │  [核准]         [拒絕]      ││
│ └────────────────────────────┘│
└──────────────────────────────┘

── "全部員工" tab ──

┌──────────────────────────────┐
│ ┌────────────────────────────┐│
│ │ 李大華  E-002              ││
│ │ 已核准                      ││
│ │                             ││
│ │ ☑ 可審核邀請  ☐ 可移除員工  ││
│ └────────────────────────────┘│
│ ┌────────────────────────────┐│
│ │ 陳志明  E-004              ││
│ │ 已核准                      ││
│ │                             ││
│ │ ☐ 可審核邀請  ☐ 可移除員工  ││
│ └────────────────────────────┘│
└──────────────────────────────┘
```

### 3.3 Features

**待審核 tab:**
- Lists employees with `accessStatus === 'PENDING'`
- Each card: nickname, employeeId, request date
- Two buttons: 核准 (green) / 拒絕 (red outline)
- Badge showing count of pending items
- After action: card animates out, count updates

**全部員工 tab:**
- Lists employees with `accessStatus === 'APPROVED'`
- Each card: nickname, employeeId, status
- Two toggle checkboxes: 可審核邀請 (canInvite) / 可移除員工 (canRemove)
- Toggle calls PUT permissions endpoint immediately
- Cannot modify own permissions (checkboxes disabled with tooltip)

### 3.4 Styling

Consistent with existing liff-web pages (volunteer, digital ID):
- LINE green (#1DB446) as primary color
- Rounded cards (borderRadius: 12)
- Tab bar matching activity list style
- Inline styles (React.CSSProperties)
- Mobile-first, max-width 480px

## 4. Permission Check Flow

```
User taps "管理後台" in LINE
  → Opens LIFF /admin?accessToken=...&tenantId=...
  → Frontend calls GET /v1/liff/tenants/{tenantId}/employees
  → API checks caller has canInvite or canRemove
  → If unauthorized: show "您沒有管理權限" message
  → If authorized: show admin page with tabs
```

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/lambda.ts` | MODIFY | Add 3 new LIFF endpoints (list, decide, permissions) |
| `apps/api/src/services/employee-access-governance-service.ts` | MODIFY | Add `updatePermissions()` method |
| `apps/api/src/line/flex-message-templates.ts` | MODIFY | Change admin button from postback to URI |
| `apps/api/src/services/webhook-event-service.ts` | MODIFY | Pass LIFF domain to services menu builder |
| `apps/liff-web/src/features/admin/admin-page.tsx` | CREATE | Admin management page |
| `apps/liff-web/src/features/admin/use-admin.ts` | CREATE | Data hooks for admin page |
| `apps/liff-web/src/main.tsx` | MODIFY | Add /admin route |

## Out of Scope

- admin-web beautification (keep as-is for now)
- canRemove action (offboarding flow) — just the permission toggle
- Role-based access beyond canInvite/canRemove
- Audit log for permission changes
