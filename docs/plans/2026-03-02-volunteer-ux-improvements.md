# Volunteer UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add "my registrations" tab, city filter, organizer report page, and UX polish to the volunteer system.

**Architecture:** Frontend-heavy changes (4 new/modified React pages) backed by 3 API changes (add `city` field, enrich `my-activities` response, add `myCheckIn` to detail). All backend changes extend existing service methods — no new endpoints needed.

**Tech Stack:** React 19 + React Router, node:test, DynamoDB single-table, Vite.

---

### Task 1: Add `city` field to domain model and repository

**Files:**
- Modify: `apps/api/src/domain/volunteer.ts:1-16`
- Modify: `apps/api/src/repositories/volunteer-repository.ts` (no changes needed — stores full object)

**Step 1: Add `city` to `VolunteerActivity` interface**

In `apps/api/src/domain/volunteer.ts`, add `city` after `location` (line 6):

```typescript
export interface VolunteerActivity {
  tenantId: string;
  activityId: string;
  title: string;
  description: string;
  location: string;
  city: string | null;  // NEW
  activityDate: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  checkInMode: 'organizer-scan' | 'self-scan';
  selfScanPayload: string | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
}
```

**Step 2: Update `createActivity` in volunteer-service.ts**

In `apps/api/src/services/volunteer-service.ts`, add `city` to the input type (line 27) and activity object (line 54):

Input type — add after `location: string`:
```typescript
city: string | null;
```

Activity object — add after `location: input.location`:
```typescript
city: input.city,
```

**Step 3: Pass `city` in lambda.ts create endpoint**

In `apps/api/src/lambda.ts:717-727`, add `city` to the body extraction:

```typescript
const result = await volunteerService.createActivity({
  title: body.title as string,
  description: body.description as string,
  location: body.location as string,
  city: (body.city as string) ?? null,  // NEW
  activityDate: body.activityDate as string,
  startTime: body.startTime as string,
  endTime: body.endTime as string,
  capacity: body.capacity as number | null,
  checkInMode: body.checkInMode as 'organizer-scan' | 'self-scan',
  createdBy: principal.employeeId,
});
```

**Step 4: Fix any existing tests that create activities without `city`**

Search for `createActivity` calls in test files. Each needs `city: null` or a city value added to the input object.

Run: `pnpm --filter @one-team/api test`
Fix any failures by adding `city: null` to test activity objects.

**Step 5: Run full check**

Run: `pnpm check`
Expected: All 174+ tests pass, no lint/typecheck errors.

**Step 6: Commit**

```
feat: add city field to volunteer activity model
```

---

### Task 2: Enrich `my-activities` API with activity details and check-in status

**Files:**
- Modify: `apps/api/src/services/volunteer-service.ts:139-142`
- Modify: `apps/api/src/lambda.ts:732-737`
- Test: `apps/api/src/volunteer.integration.test.ts`

**Step 1: Update `myActivities` service method**

Replace the `myActivities` method in `volunteer-service.ts` (lines 139-142):

```typescript
async myActivities(employeeId: string): Promise<
  Array<
    VolunteerRegistration & {
      activity: VolunteerActivity | null;
      checkedIn: boolean;
    }
  >
> {
  const registrations = await this.volunteerRepo.listRegistrationsByEmployee(employeeId);
  const active = registrations.filter((r) => r.status === 'REGISTERED');

  return Promise.all(
    active.map(async (reg) => {
      const activity = await this.volunteerRepo.findActivityById(reg.activityId);
      const checkIn = await this.volunteerRepo.findCheckIn(reg.activityId, reg.employeeId);
      return { ...reg, activity, checkedIn: checkIn !== null };
    })
  );
}
```

**Step 2: Update integration test to verify enriched response**

In `volunteer.integration.test.ts`, the existing "Step 5: Participant's my-activities" test (around line 124-133) should verify the enriched fields:

```typescript
// Step 5: Participant's my-activities includes activity details
const myRes = await invokeLambda({
  method: 'GET',
  path: '/v1/volunteer/my-activities',
  headers: partHeaders
});
assert.equal(myRes.statusCode, 200);
const registrations = (
  myRes.body as { registrations: Array<{ activityId: string; activity: { title: string }; checkedIn: boolean }> }
).registrations;
assert.ok(registrations.some((r) => r.activityId === activityId));
const myReg = registrations.find((r) => r.activityId === activityId)!;
assert.ok(myReg.activity);
assert.equal(myReg.activity.title, `Cleanup-${suffix}`);
assert.equal(myReg.checkedIn, false);
```

**Step 3: Run tests**

Run: `pnpm check`
Expected: All tests pass.

**Step 4: Commit**

```
feat: enrich my-activities response with activity details and check-in status
```

---

### Task 3: Add `myCheckIn` to activity detail API

**Files:**
- Modify: `apps/api/src/services/volunteer-service.ts:76-93`
- Modify: `apps/api/src/lambda.ts:740-755`

**Step 1: Extend `getActivityDetail` to return `myCheckIn`**

In `volunteer-service.ts`, update the return type and logic (lines 76-93):

```typescript
async getActivityDetail(
  activityId: string,
  employeeId?: string
): Promise<{
  activity: VolunteerActivity;
  registrationCount: number;
  myRegistration?: { status: string; registeredAt: string } | null;
  myCheckIn?: { checkedInAt: string; mode: string } | null;
} | null> {
  const activity = await this.volunteerRepo.findActivityById(activityId);
  if (!activity) return null;
  const registrationCount = await this.volunteerRepo.countActiveRegistrations(activityId);
  let myRegistration: { status: string; registeredAt: string } | null | undefined;
  let myCheckIn: { checkedInAt: string; mode: string } | null | undefined;
  if (employeeId) {
    const reg = await this.volunteerRepo.findRegistration(activityId, employeeId);
    myRegistration = reg ? { status: reg.status, registeredAt: reg.registeredAt } : null;
    const checkIn = await this.volunteerRepo.findCheckIn(activityId, employeeId);
    myCheckIn = checkIn ? { checkedInAt: checkIn.checkedInAt, mode: checkIn.mode } : null;
  }
  return { activity, registrationCount, myRegistration, myCheckIn };
}
```

**Step 2: Run tests**

Run: `pnpm check`
Expected: All tests pass (lambda handler already passes `employeeId` through).

**Step 3: Commit**

```
feat: add myCheckIn to activity detail API response
```

---

### Task 4: Add city dropdown to create activity form

**Files:**
- Modify: `apps/liff-web/src/features/volunteer/create-activity.tsx`

**Step 1: Add city constant and state**

At the top of the file, add the Taiwan counties list:

```typescript
const CITIES = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣',
  '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '台東縣', '澎湖縣', '金門縣', '連江縣',
];
```

Add state: `const [city, setCity] = useState('');`

**Step 2: Add city dropdown to form**

After the location input, add:

```tsx
<label style={styles.label}>
  縣市
  <select
    value={city}
    onChange={(e) => setCity(e.target.value)}
    style={styles.input}
  >
    <option value="">不指定</option>
    {CITIES.map((c) => (
      <option key={c} value={c}>{c}</option>
    ))}
  </select>
</label>
```

**Step 3: Include `city` in submit body**

In `handleSubmit`, add to `JSON.stringify`:
```typescript
city: city || null,
```

**Step 4: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 5: Commit**

```
feat: add city dropdown to create activity form
```

---

### Task 5: Rewrite activity list with tabs and city filter

**Files:**
- Rewrite: `apps/liff-web/src/features/volunteer/activity-list.tsx`
- Modify: `apps/liff-web/src/features/volunteer/use-volunteer.ts`

**Step 1: Update types in use-volunteer.ts**

Add enriched registration type and update `useMyActivities` return type:

```typescript
interface EnrichedRegistration extends Registration {
  activity: VolunteerActivity | null;
  checkedIn: boolean;
}

export type { VolunteerActivity, ActivityDetail, Registration, EnrichedRegistration };
```

Update `useMyActivities`:

```typescript
export function useMyActivities(apiBaseUrl: string, accessToken: string) {
  const [registrations, setRegistrations] = useState<EnrichedRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    fetch(`${apiBaseUrl}/v1/volunteer/my-activities`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => setRegistrations(data.registrations))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  return { registrations, loading };
}
```

**Step 2: Rewrite activity-list.tsx**

Full rewrite with:
- Tab bar: "全部活動" / "我的報名"
- City filter chips (horizontal scroll, from CITIES constant)
- Updated activity cards showing city badge
- My-registrations tab using `useMyActivities` with registration/check-in status badges

The "全部活動" tab uses `useActivities` + client-side city filter.
The "我的報名" tab uses `useMyActivities`.

Same `CITIES` constant as create-activity.tsx — extract to a shared constant file `apps/liff-web/src/constants.ts` to avoid duplication.

**Step 3: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 4: Commit**

```
feat: add tabs and city filter to activity list page
```

---

### Task 6: Add organizer report page

**Files:**
- Create: `apps/liff-web/src/features/volunteer/report.tsx`
- Modify: `apps/liff-web/src/features/volunteer/use-volunteer.ts` (add `useReport` hook)
- Modify: `apps/liff-web/src/main.tsx:32` (add route)

**Step 1: Add `useReport` hook in use-volunteer.ts**

```typescript
interface ReportData {
  activity: VolunteerActivity;
  registrations: Array<{
    activityId: string;
    employeeId: string;
    registeredAt: string;
    status: string;
  }>;
  checkIns: Array<{
    employeeId: string;
    checkedInAt: string;
    mode: string;
  }>;
}

export function useReport(apiBaseUrl: string, accessToken: string, activityId: string) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/v1/volunteer/activities/${activityId}/report`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load report');
        return r.json();
      })
      .then((data) => setReport(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, activityId]);

  return { report, loading, error };
}
```

**Step 2: Create report.tsx**

Create `apps/liff-web/src/features/volunteer/report.tsx`:

- Uses `useReport` hook to fetch data
- Summary bar: "已報名 X 人 / 已打卡 Y 人"
- Table: employeeId, registeredAt (formatted), check-in status + time
- "匯出 CSV" button that fetches `/report/export` and triggers download via:
  ```typescript
  const res = await fetch(`${apiBaseUrl}/v1/volunteer/activities/${activityId}/report/export`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const csv = await res.text();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${activityId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  ```
- Back link to activity detail

**Step 3: Add route in main.tsx**

After line 34, add:
```tsx
import { Report } from './features/volunteer/report';
// ...
<Route path="/volunteer/:activityId/report" element={<Report />} />
```

**Step 4: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 5: Commit**

```
feat: add organizer report page with CSV export
```

---

### Task 7: UX polish — badges, navigation, error handling

**Files:**
- Modify: `apps/liff-web/src/features/volunteer/activity-detail.tsx`
- Modify: `apps/liff-web/src/features/volunteer/check-in.tsx:110-135`
- Modify: `apps/liff-web/src/features/volunteer/use-volunteer.ts` (update `ActivityDetail` type)

**Step 1: Update ActivityDetail type for myCheckIn**

In `use-volunteer.ts`, update the `ActivityDetail` interface:

```typescript
interface ActivityDetail {
  activity: VolunteerActivity;
  registrationCount: number;
  myRegistration?: { status: string; registeredAt: string } | null;
  myCheckIn?: { checkedInAt: string; mode: string } | null;
}
```

**Step 2: Update activity-detail.tsx**

Add these elements:

1. **已打卡 badge** — after the 已報名 badge:
   ```tsx
   {detail.myCheckIn && (
     <div style={styles.checkedInBadge}>已打卡 ✓</div>
   )}
   ```

2. **Creator report link** — after the scan button section:
   ```tsx
   {isCreator && (
     <Link
       to={`/volunteer/${activityId}/report`}
       style={{ ...styles.secondaryBtn, display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 8 }}
     >
       查看報名名單
     </Link>
   )}
   ```

3. **已額滿 handling** — in `handleRegister` catch:
   ```typescript
   const errorMsg = (e as Error).message;
   if (errorMsg.includes('full')) {
     setActionMessage('已額滿，無法報名');
   } else {
     setActionMessage(errorMsg);
   }
   ```

4. Add `checkedInBadge` style:
   ```typescript
   checkedInBadge: {
     display: 'inline-block',
     marginTop: 4,
     marginLeft: 8,
     padding: '6px 16px',
     borderRadius: 20,
     backgroundColor: '#e8f5e9',
     color: '#2e7d32',
     fontSize: 14,
     fontWeight: 'bold',
   },
   ```

**Step 3: Update check-in.tsx — add "返回活動" button**

After the success box (line 114), add:
```tsx
{status === 'success' && (
  <Link
    to={`/volunteer/${activityId}`}
    style={{ ...styles.retryBtn, display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 12 }}
  >
    返回活動詳情
  </Link>
)}
```

Add `Link` to the imports at the top of check-in.tsx.

**Step 4: Typecheck**

Run: `pnpm --filter @one-team/liff-web exec tsc --noEmit`

**Step 5: Commit**

```
feat: add check-in badge, report link, capacity-full handling, and navigation fixes
```

---

### Task 8: Final integration test and deploy

**Step 1: Run full check suite**

Run: `pnpm check`
Expected: All tests pass, lint clean, typecheck clean.

**Step 2: Manual verification checklist**

- [ ] Create activity with city → city appears in response
- [ ] List activities → city field returned
- [ ] My activities → enriched with activity details + checkedIn
- [ ] Activity detail with auth → myCheckIn returned
- [ ] Activity detail without auth → myCheckIn absent

**Step 3: Build and deploy**

Follow the deploy skill:
1. `pnpm build`
2. CDK deploy
3. Rebuild liff-web with `VITE_API_BASE_URL`
4. Upload to S3 + invalidate CloudFront
5. Smoke test

**Step 4: Commit tag**

```
chore: volunteer UX improvements complete
```
