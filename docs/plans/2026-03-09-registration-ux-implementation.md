# Registration UX Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the employee registration UX by directing users to LIFF form instead of chat-based input, adding optional nickname, and showing a clear post-submission status page.

**Architecture:** Reuse existing LIFF `/register` page. Add nickname field to form and backend. Change rich menu "申請開通" button from postback to URI action opening LIFF page. Improve success screen with next-step guidance and close button.

**Tech Stack:** React (inline styles), LINE LIFF SDK, Zod validation, node:test

---

### Task 1: Backend — Accept nickname in self-register endpoint

**Files:**
- Modify: `apps/api/src/lambda.ts:170-174` (selfRegisterSchema)
- Modify: `apps/api/src/services/self-registration-service.ts:13-17` (SelfRegisterInput)
- Modify: `apps/api/src/services/self-registration-service.ts:45-51` (register method)
- Modify: `apps/api/src/services/self-registration-service.ts:58-105` (processRegistration)
- Modify: `apps/api/src/services/self-registration-service.ts:108-136` (reRegister)
- Test: `apps/api/src/services/self-registration-service.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/self-registration-service.test.ts`:

```typescript
it('stores nickname when provided during registration', async () => {
  const { service, employeeBindingRepo } = await createContext();

  await service.register({
    tenantId: 'tenant-1',
    lineIdToken: 'line-id:U-nick-user',
    employeeId: 'E-nick',
    nickname: '小花'
  });

  const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E-nick');
  assert.ok(binding);
  assert.equal(binding.nickname, '小花');
});

it('registers successfully without nickname', async () => {
  const { service, employeeBindingRepo } = await createContext();

  await service.register({
    tenantId: 'tenant-1',
    lineIdToken: 'line-id:U-no-nick',
    employeeId: 'E-no-nick'
  });

  const binding = await employeeBindingRepo.findByEmployeeId('tenant-1', 'E-no-nick');
  assert.ok(binding);
  assert.equal(binding.nickname, undefined);
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx tsx --test src/services/self-registration-service.test.ts`
Expected: TypeScript error — `nickname` not in `SelfRegisterInput`

**Step 3: Implement**

In `apps/api/src/services/self-registration-service.ts`:
- Add `nickname?: string` to `SelfRegisterInput` interface
- Add `nickname?: string` to `SelfRegisterByLineUserInput` interface
- Pass `nickname` through `register()` → `processRegistration()`
- Add `nickname` parameter to `processRegistration(tenantId, lineUserId, employeeId, nickname?)`
- Include `nickname` in the `employeeBindingRepository.upsert()` call in both `processRegistration` and `reRegister`

In `apps/api/src/lambda.ts:170-174`:
- Add `nickname: z.string().max(50).optional()` to `selfRegisterSchema`

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx tsx --test src/services/self-registration-service.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/lambda.ts apps/api/src/services/self-registration-service.ts apps/api/src/services/self-registration-service.test.ts
git commit -m "feat(registration): accept optional nickname in self-register endpoint"
```

---

### Task 2: Frontend — Add nickname field and improve success page

**Files:**
- Modify: `apps/liff-web/src/features/registration/registration-form.tsx`
- Modify: `apps/liff-web/src/features/registration/use-registration.ts:38-66` (submit function body)
- Modify: `apps/liff-web/src/features/registration/types.ts`

**Step 1: Update types**

In `apps/liff-web/src/features/registration/types.ts`:
- Add `nickname?: string` to `RegistrationFormData`
- Add `nickname?: string` to `SelfRegisterRequest`

**Step 2: Update use-registration hook**

In `apps/liff-web/src/features/registration/use-registration.ts`:
- Include `nickname: data.nickname` in the `fetch` body (only if truthy, to avoid sending empty string)

**Step 3: Update registration form**

In `apps/liff-web/src/features/registration/registration-form.tsx`:

Add nickname state: `const [nickname, setNickname] = useState('');`

Add nickname input field after employee ID field:
```tsx
<div style={{ marginBottom: 16 }}>
  <label>
    暱稱（選填）
    <br />
    <input
      value={nickname}
      onChange={(e) => setNickname(e.target.value)}
      placeholder="你期望怎麼被稱呼呢？"
      disabled={!isLiffReady || isSubmitting}
      style={{ width: '100%' }}
    />
  </label>
</div>
```

Update `onSubmit` to pass nickname:
```typescript
await submit({ employeeId, nickname: nickname.trim() || undefined });
```

Replace the success `<section>` with a clear status page:
```tsx
<section style={{ textAlign: 'center', padding: 32 }}>
  <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
  <h2 style={{ marginBottom: 8 }}>申請已送出</h2>
  <p style={{ color: '#666', lineHeight: 1.6, marginBottom: 24 }}>
    管理員已收到您的申請通知，<br />
    審核通過後您會收到 LINE 訊息。
  </p>
  <button
    type="button"
    onClick={() => {
      try { liff.closeWindow(); } catch { window.close(); }
    }}
    style={{
      padding: '12px 32px',
      fontSize: 16,
      backgroundColor: '#06C755',
      color: 'white',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer'
    }}
  >
    關閉
  </button>
</section>
```

Note: Import `liff` from `@line/liff` at the top of `registration-form.tsx`.

**Step 4: Verify locally**

Run: `cd apps/liff-web && npx vite --port 5173`
Open: `http://localhost:5173/register?tenantId=demo`
Verify: Form shows both fields, nickname is optional, submit works.

**Step 5: Commit**

```bash
git add apps/liff-web/src/features/registration/
git commit -m "feat(registration): add nickname field and improve success page"
```

---

### Task 3: Rich Menu — Change "申請開通" from postback to URI action

**Files:**
- Modify: `scripts/update-richmenu.mjs:151-171` (buildPendingMenu function)

**Step 1: Update buildPendingMenu**

Change the first area action from:
```javascript
action: { type: 'postback', data: 'action=request_access', displayText: '申請開通' }
```
to:
```javascript
action: {
  type: 'uri',
  uri: `${liffBase}/register?tenantId=__TENANT_ID__`
}
```

Note: Since all 9 dev tenants share one LINE channel but have different tenantIds, and the rich menu is shared across all tenants, we need a strategy. The simplest approach: use the LIFF URL without tenantId, and have the LIFF page detect it from LIFF context or show a fallback. However, looking at the current flow, the welcome message's "開始申請" button already includes the tenantId via postback data.

Better approach: Since the pending rich menu is per-tenant (each tenant stores its own `pendingRichMenuId` in DynamoDB), we can generate tenant-specific menus. But currently `buildPendingMenu()` creates a single menu shared across all tenants.

Simplest fix: The LIFF registration page already reads `tenantId` from query params. Since all 9 dev tenants currently share the same channel, use a hardcoded default tenantId, OR better — update the script to create one pending menu per tenant with the correct URI.

**Recommended approach:** Since the script already iterates over tenants, create per-tenant pending menus by passing tenantId into `buildPendingMenu(tenantId)`:

```javascript
function buildPendingMenu(tenantId) {
  return {
    size: { width: 2500, height: 843 },
    selected: true,
    name: `one-team-pending-${tenantId}`,
    chatBarText: '申請開通',
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: {
          type: 'uri',
          uri: `${liffBase}/register?tenantId=${encodeURIComponent(tenantId)}`
        }
      },
      {
        bounds: { x: 833, y: 0, width: 834, height: 843 },
        action: { type: 'postback', data: 'action=digital_id', displayText: '員工證' }
      },
      {
        bounds: { x: 1667, y: 0, width: 833, height: 843 },
        action: { type: 'postback', data: 'action=contact_admin', displayText: '聯絡管理員' }
      }
    ]
  };
}
```

Then in `main()`, update the flow to create one pending menu per tenant (instead of one shared pending menu). For the approved menu, it can remain shared since it doesn't need tenant-specific URLs.

If all 9 tenants share the same channel and the same tenantId pattern, a simpler alternative: just hardcode or use a single tenantId. Check with the actual data — if they all use different tenantIds, per-tenant menus are needed.

**Step 2: Test with DRY_RUN**

Run: `DRY_RUN=true node scripts/update-richmenu.mjs`
Verify: The pending menu area[0] action is now `type: 'uri'` with the LIFF URL.

**Step 3: Commit**

```bash
git add scripts/update-richmenu.mjs
git commit -m "feat(richmenu): change pending menu to open LIFF registration form"
```

---

### Task 4: Deploy and verify

**Step 1: Deploy backend**

Run: `cd infra/cdk && npx cdk deploy --all`

**Step 2: Deploy frontend**

```bash
cd apps/liff-web && npm run build
aws s3 sync dist/ s3://YOUR_LIFF_WEB_S3_BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_CLOUDFRONT_DISTRIBUTION_ID --paths "/*"
```

**Step 3: Update rich menus**

Run: `node scripts/update-richmenu.mjs`

**Step 4: Verify**

- Open LINE → tap "申請開通" on rich menu → should open LIFF registration form (not bot message)
- Enter employee ID + optional nickname → submit
- Success page shows ✅, next steps explanation, and close button
- Close button closes the LIFF window
- Admin receives notification with employee ID (and nickname if provided)
- After admin approves, employee receives LINE message and rich menu switches

**Step 5: Commit any fixes, then final commit**

```bash
git commit -m "chore: deploy registration UX improvements"
```
