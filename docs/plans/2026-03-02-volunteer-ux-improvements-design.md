# Volunteer UX Improvements Design

Date: 2026-03-02
Status: Approved

## Goal

Improve the volunteer registration system UX, focusing on participant experience first, with organizer report as a bonus since the API already exists.

## Scope

4 improvements, all additive (no breaking changes):

1. **"My Registrations" tab** — participants see their registered activities
2. **City filter on activity list** — structured city field + filter chips
3. **Organizer report page** — registration list + CSV export
4. **UX polish** — check-in badge, capacity-full handling, navigation fixes

## 1. Data Model Change

Add `city` field to `VolunteerActivity`:

```typescript
interface VolunteerActivity {
  // ... existing fields ...
  city: string | null;  // NEW — e.g. "台北市", null = unspecified
}
```

- Optional field, existing activities get `null`
- 22 Taiwan counties, hardcoded list in frontend
- No new DynamoDB GSI needed (client-side filter, activity count is low)

## 2. API Changes

### 2.1 `POST /v1/volunteer/activities` — accept `city`

Add optional `city` field to request body. Validate against allowed county list server-side.

### 2.2 `GET /v1/volunteer/my-activities` — enriched response

Current: returns flat `Registration[]`.
New: joins each registration with activity details and check-in status.

```json
{
  "registrations": [
    {
      "activityId": "abc123",
      "employeeId": "E-001",
      "registeredAt": "2026-03-01T...",
      "status": "REGISTERED",
      "activity": {
        "title": "海灘淨灘",
        "activityDate": "2026-06-01",
        "startTime": "09:00",
        "endTime": "17:00",
        "location": "台北海灘",
        "city": "台北市",
        "status": "OPEN"
      },
      "checkedIn": false
    }
  ]
}
```

### 2.3 `GET /v1/volunteer/activities/{id}` — add `myCheckIn`

Extend response to include current user's check-in status when authenticated:

```json
{
  "activity": { ... },
  "registrationCount": 3,
  "myRegistration": { "status": "REGISTERED", "registeredAt": "..." },
  "myCheckIn": { "checkedInAt": "2026-06-01T09:15:00Z", "mode": "organizer-scan" }
}
```

`myCheckIn` is `null` if not checked in, `undefined` if not authenticated.

## 3. Frontend Pages

### 3.1 Activity List — Tab + City Filter

```
┌──────────────────────────────┐
│ 志工活動                       │
│                               │
│ [全部活動] [我的報名]     [+ 建立]│
│                               │
│ 縣市: [全部] [台北市] [新北市]... │
│                               │
│ ┌────────────────────────────┐│
│ │ 🏷 台北市                    ││
│ │ 海灘淨灘活動                 ││
│ │ 2026-06-01 09:00–17:00     ││
│ │ 台北海灘  |  3/10 已報名     ││
│ └────────────────────────────┘│
└──────────────────────────────┘
```

- Tab bar: "全部活動" (default) / "我的報名"
- City chips: horizontal scroll, tap to toggle, "全部" clears filter
- Cards: add city badge, show registration count / capacity

### 3.2 "My Registrations" Tab

Same card layout, but sourced from `my-activities` API. Each card shows:
- Activity title, date/time, city badge
- Registration status badge: 已報名 / 已取消
- Check-in status badge: 已打卡 ✓ / 未打卡

Click navigates to activity detail.

### 3.3 Organizer Report Page `/volunteer/:activityId/report`

```
┌──────────────────────────────┐
│ ← 返回活動                     │
│                               │
│ 報名名單 — 海灘淨灘活動          │
│ 已報名 3 人 / 已打卡 1 人       │
│                               │
│ [匯出 CSV]                    │
│                               │
│ ┌─────────┬─────────┬───────┐│
│ │ 員工ID   │ 報名時間  │ 打卡  ││
│ ├─────────┼─────────┼───────┤│
│ │ E-001   │ 03/01   │ ✓9:15 ││
│ │ E-002   │ 03/01   │ —     ││
│ │ E-003   │ 03/02   │ —     ││
│ └─────────┴─────────┴───────┘│
└──────────────────────────────┘
```

- Uses existing `GET /report` endpoint
- Summary bar: registered count / checked-in count
- "匯出 CSV" button: fetches `/report/export`, triggers browser download
- Accessible from activity detail (creator-only "查看報名名單" button)

## 4. UX Fixes

| Fix | Where | Description |
|-----|-------|-------------|
| 已打卡 badge | activity-detail | Show "已打卡 ✓" when user has checked in |
| 返回活動 button | check-in page | After success, show "返回活動詳情" link |
| 已額滿 handling | activity-detail | When register returns 409 "full", show "已額滿" message |
| Creator report link | activity-detail | Creator sees "查看報名名單" button |

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/domain/volunteer.ts` | MODIFY | Add `city` to `VolunteerActivity` |
| `apps/api/src/services/volunteer-service.ts` | MODIFY | Accept `city` in create, enrich my-activities, add myCheckIn to detail |
| `apps/api/src/lambda.ts` | MODIFY | Pass `city` in create, return enriched my-activities |
| `apps/liff-web/src/features/volunteer/use-volunteer.ts` | MODIFY | Update types, add `useReport` hook |
| `apps/liff-web/src/features/volunteer/activity-list.tsx` | REWRITE | Add tabs, city filter, enriched cards |
| `apps/liff-web/src/features/volunteer/activity-detail.tsx` | MODIFY | Add check-in badge, report link, capacity-full handling |
| `apps/liff-web/src/features/volunteer/create-activity.tsx` | MODIFY | Add city dropdown |
| `apps/liff-web/src/features/volunteer/report.tsx` | CREATE | Organizer report page |
| `apps/liff-web/src/features/volunteer/check-in.tsx` | MODIFY | Add "返回活動" button after success |
| `apps/liff-web/src/main.tsx` | MODIFY | Add report route |

## Out of Scope

- Activity edit/update after creation
- Activity close (OPEN → CLOSED transition)
- Volunteer hours tracking / statistics
- Real-time check-in dashboard (WebSocket)
- Pagination (activity count is still low)
