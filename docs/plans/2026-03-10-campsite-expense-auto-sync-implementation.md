# Campsite Expense Auto-Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-sync campsite data into expenses via confirmation dialogs on create/edit/delete, and remove campsite cost calculation from settlement (unified expense-only calculation).

**Architecture:** Add `campSiteId` to ExpenseRecord for linking. Frontend shows confirmation dialogs after campsite CRUD and calls existing expense APIs. Settlement calculation drops the campsite cost loop entirely.

**Tech Stack:** TypeScript, React, node:test, DynamoDB single-table

---

### Task 1: Add `campSiteId` to ExpenseRecord (backend types)

**Files:**
- Modify: `apps/api/src/domain/camping.ts:37-46`

**Step 1: Update the ExpenseRecord interface**

In `apps/api/src/domain/camping.ts`, add `campSiteId` to the interface:

```typescript
export interface ExpenseRecord {
  tripId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: ExpenseSplitType;
  splitAmong: string[] | null;  // participantIds, required when CUSTOM
  createdAt: string;
  campSiteId?: string;          // Links expense to originating campsite
}
```

**Step 2: Verify no build errors**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/domain/camping.ts
git commit -m "feat: add campSiteId field to ExpenseRecord"
```

---

### Task 2: Remove campsite cost calculation from settlement

**Files:**
- Modify: `apps/api/src/domain/camping-settlement.ts:16-70`
- Modify: `apps/api/src/domain/camping-settlement.test.ts`

**Step 1: Update the test for campsite-only settlement**

In `camping-settlement.test.ts`, the test `'splits campsite fees by headcount (ignoring weight)'` (lines 83-106) currently passes campSites and expects settlement from campsite data alone. Since campsites will no longer contribute to settlement, update this test to verify that campsites are ignored:

```typescript
  it('ignores campsite data (costs should come from expenses)', () => {
    const participants = [
      makeParticipant('A', 'Alice'),
      makeParticipant('B', 'Bob'),
      makeParticipant('C', 'Charlie'),
    ];
    const campSites: CampSiteRecord[] = [
      {
        tripId: 'trip-1',
        campSiteId: 'cs1',
        name: 'Site A',
        cost: 1200,
        paidByParticipantId: 'A',
        memberParticipantIds: ['A', 'B'],
      },
    ];

    const result = calculateSettlement(participants, campSites, []);

    // Campsites alone no longer generate transfers
    assert.equal(result.transfers.length, 0);
  });
```

**Step 2: Update the Excel example test**

The test `'reproduces the Excel example'` (lines 202-232) uses both campSites and expenses. Convert the campsite data into equivalent CUSTOM expenses:

```typescript
  it('reproduces the Excel example (campsites as expenses)', () => {
    const participants = [
      makeParticipant('bigS', '大S', 1, { householdId: 'h-bigS', isHead: true, settle: true }),
      makeParticipant('bigS-spouse', 'S太太', 1, { householdId: 'h-bigS', isHead: false, settle: true }),
      makeParticipant('bigS-kid1', 'S小孩', 0.5, { householdId: 'h-bigS', isHead: false, settle: true }),
      makeParticipant('bigS-kid2', 'S小孩2', 0.5, { householdId: 'h-bigS', isHead: false, settle: true }),
      makeParticipant('alex', 'Alex'),
      makeParticipant('can', 'Can'),
    ];

    const campSites: CampSiteRecord[] = [];

    const expenses: ExpenseRecord[] = [
      // Campsite expenses (converted from campsite data)
      { tripId: 'trip-1', expenseId: 'cs-e1', description: '營位-雨棚A', amount: 1224, paidByParticipantId: 'can', splitType: 'CUSTOM', splitAmong: ['bigS', 'bigS-spouse', 'bigS-kid1', 'bigS-kid2'], createdAt: '2026-01-01T00:00:00.000Z', campSiteId: 'cs1' },
      { tripId: 'trip-1', expenseId: 'cs-e2', description: '營位-非雨棚B', amount: 1020, paidByParticipantId: 'can', splitType: 'CUSTOM', splitAmong: ['alex', 'can'], createdAt: '2026-01-01T00:00:00.000Z', campSiteId: 'cs2' },
      // Regular expense
      { tripId: 'trip-1', expenseId: 'e1', description: '食材', amount: 3000, paidByParticipantId: 'can', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const result = calculateSettlement(participants, campSites, expenses);

    const summaryMap = new Map(result.participantSummaries.map(s => [s.participantId, s]));

    const bigSSummary = summaryMap.get('bigS');
    assert.ok(bigSSummary);
    // Household total: 雨棚A 1224/4=306 each × 4 members = 1224, plus 食材 (1+1+0.5+0.5)w/5w × 3000 = 1800
    // Total owed = 1224 + 1800 = 3024
    assert.equal(bigSSummary.totalOwed, 3024);

    const canSummary = summaryMap.get('can');
    assert.ok(canSummary);
    // Can paid: 1224 + 1020 + 3000 = 5244
    assert.equal(canSummary.totalPaid, 5244);
  });
```

**Step 3: Run tests to verify they fail**

Run: `cd apps/api && npx tsx --test src/domain/camping-settlement.test.ts`
Expected: 2 tests fail (the updated ones expect new behavior, but code still has old logic)

**Step 4: Remove the campsite cost loop from `calculateSettlement`**

In `apps/api/src/domain/camping-settlement.ts`, remove lines 27-40 (the campsite fees section). The function signature keeps `campSites` parameter for compatibility but ignores it:

```typescript
export function calculateSettlement(
  participants: TripParticipantRecord[],
  _campSites: CampSiteRecord[],
  expenses: ExpenseRecord[],
): Omit<SettlementRecord, 'tripId' | 'settledAt'> {
  const ledger = new Map<string, OwedPaid>();
  for (const p of participants) {
    ledger.set(p.participantId, { owed: 0, paid: 0, breakdownParts: [] });
  }

  // --- Expenses (unified: includes campsite-generated expenses) ---
  for (const expense of expenses) {
```

Keep everything else the same (expense loop, household merging, greedy matching, summaries).

**Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx tsx --test src/domain/camping-settlement.test.ts`
Expected: All 8 tests pass

**Step 6: Verify full build**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/api/src/domain/camping-settlement.ts apps/api/src/domain/camping-settlement.test.ts
git commit -m "feat: remove campsite cost from settlement, unify via expenses"
```

---

### Task 3: Add `campSiteId` to frontend types

**Files:**
- Modify: `apps/liff-web/src/features/camping/use-camping.ts:36-45`

**Step 1: Add `campSiteId` to the frontend `Expense` interface**

```typescript
export interface Expense {
  tripId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: 'ALL' | 'CUSTOM';
  splitAmong: string[] | null;
  createdAt: string;
  campSiteId?: string;
}
```

**Step 2: Verify no build errors**

Run: `cd apps/liff-web && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/liff-web/src/features/camping/use-camping.ts
git commit -m "feat: add campSiteId to frontend Expense type"
```

---

### Task 4: Add confirmation dialogs to CampSitesTab

**Files:**
- Modify: `apps/liff-web/src/features/camping/campsites-tab.tsx`
- Modify: `apps/liff-web/src/features/camping/trip-detail.tsx:287-301`

**Step 1: Update CampSitesTab Props to include expense callbacks**

In `campsites-tab.tsx`, update the Props interface to receive expense operations and expense list:

```typescript
import type { CampSite, Expense, TripParticipant } from './use-camping';

interface Props {
  campSites: CampSite[];
  expenses: Expense[];
  participants: TripParticipant[];
  isOpen: boolean;
  onAdd: (input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<void>;
  onRemove: (campSiteId: string) => Promise<void>;
  onUpdate?: (campSiteId: string, input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<void>;
  onAddExpense: (input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null; campSiteId: string }) => Promise<void>;
  onUpdateExpense: (expenseId: string, input: { description: string; amount: number; paidByParticipantId: string; splitType: 'ALL' | 'CUSTOM'; splitAmong: string[] | null }) => Promise<void>;
  onRemoveExpense: (expenseId: string) => Promise<void>;
}
```

**Step 2: Add dialog state and confirmation logic**

Add state for tracking pending confirmations after campsite operations:

```typescript
const [confirmDialog, setConfirmDialog] = useState<{
  type: 'add' | 'update' | 'delete';
  campSiteId: string;
  campSiteName: string;
  campSiteCost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
} | null>(null);
```

**Step 3: Modify `handleSubmit` (add campsite) to show dialog after success**

After `await onAdd(...)` succeeds, show a confirmation dialog. We need to capture the campSiteId from the response. However, the current `onAdd` doesn't return the campSiteId.

Instead, approach it differently: after `onAdd` succeeds and `refresh()` runs, the new campsite will appear in the `campSites` list. We can compare before/after to find the new one, OR we can use a simpler approach — show the dialog immediately with the form data and let the dialog handler create the expense.

**Simpler approach:** After campsite add succeeds, show dialog. The dialog's "confirm" calls `onAddExpense` with the campsite data. We need the `campSiteId` — since `onAdd` is wrapped with `withRefresh` in trip-detail.tsx, we need to make it return the campSiteId.

**Simplest approach:** Look at how the API creates campsites — it returns `{ campSiteId }`. Update the flow:

In `trip-detail.tsx`, change the `onAdd` callback to return the campSiteId:

```typescript
onAdd={async (input) => {
  const result = await mutations.post('/campsites', input);
  refresh();
  return result.campSiteId;
}}
```

Update `CampSitesTab` props:
```typescript
onAdd: (input: { name: string; cost: number; paidByParticipantId: string; memberParticipantIds: string[] }) => Promise<string>;
```

Wait — `onAdd` is wrapped with `withRefresh` which swallows the return value. We need to handle this differently.

**Better approach:** Don't use `withRefresh` for campsite operations. Handle refresh manually in `trip-detail.tsx` and return the campSiteId.

In `trip-detail.tsx`, change the campsites tab wiring:

```typescript
{activeTab === 'campsites' && (
  <CampSitesTab
    campSites={detail.campSites}
    expenses={detail.expenses}
    participants={detail.participants}
    isOpen={isOpen}
    onAdd={async (input) => {
      setMutationError(null);
      try {
        const result = await mutations.post('/campsites', input);
        refresh();
        return result.campSiteId as string;
      } catch (err) {
        setMutationError((err as Error).message);
        throw err;
      }
    }}
    onRemove={withRefresh(async (campSiteId) => {
      await mutations.del(`/campsites/${campSiteId}`);
    })}
    onUpdate={withRefresh(async (campSiteId, input) => {
      await mutations.put(`/campsites/${campSiteId}`, input);
    })}
    onAddExpense={withRefresh(async (input) => {
      await mutations.post('/expenses', input);
    })}
    onUpdateExpense={withRefresh(async (expenseId, input) => {
      await mutations.put(`/expenses/${expenseId}`, input);
    })}
    onRemoveExpense={withRefresh(async (expenseId) => {
      await mutations.del(`/expenses/${expenseId}`);
    })}
  />
)}
```

**Step 4: Implement dialog in CampSitesTab**

Update `handleSubmit` to show dialog after add:

```typescript
const handleSubmit = async () => {
  if (!name.trim() || !cost || !paidBy || selectedMembers.size === 0) return;
  setSubmitting(true);
  try {
    const campSiteId = await onAdd({
      name: name.trim(),
      cost: Number(cost),
      paidByParticipantId: paidBy,
      memberParticipantIds: [...selectedMembers],
    });
    setConfirmDialog({
      type: 'add',
      campSiteId,
      campSiteName: name.trim(),
      campSiteCost: Number(cost),
      paidByParticipantId: paidBy,
      memberParticipantIds: [...selectedMembers],
    });
    resetForm();
  } finally { setSubmitting(false); }
};
```

Update `handleUpdate` to show dialog after edit:

```typescript
const handleUpdate = async () => {
  if (!editingId || !name.trim() || !cost || !paidBy || selectedMembers.size === 0) return;
  setSubmitting(true);
  try {
    await onUpdate!(editingId, {
      name: name.trim(),
      cost: Number(cost),
      paidByParticipantId: paidBy,
      memberParticipantIds: [...selectedMembers],
    });
    setConfirmDialog({
      type: 'update',
      campSiteId: editingId,
      campSiteName: name.trim(),
      campSiteCost: Number(cost),
      paidByParticipantId: paidBy,
      memberParticipantIds: [...selectedMembers],
    });
    resetForm();
  } finally { setSubmitting(false); }
};
```

Add delete handler with dialog:

```typescript
const handleRemove = async (campSiteId: string) => {
  const site = campSites.find(s => s.campSiteId === campSiteId);
  await onRemove(campSiteId);
  const linkedExpense = expenses.find(e => e.campSiteId === campSiteId);
  if (linkedExpense && site) {
    setConfirmDialog({
      type: 'delete',
      campSiteId,
      campSiteName: site.name,
      campSiteCost: site.cost,
      paidByParticipantId: site.paidByParticipantId,
      memberParticipantIds: site.memberParticipantIds,
    });
  }
};
```

Update the delete button in the JSX to use `handleRemove`:

```tsx
<button onClick={() => handleRemove(site.campSiteId)} style={cs.removeBtn}>刪除</button>
```

**Step 5: Add the confirmation dialog JSX**

At the end of the CampSitesTab return, before the closing `</div>`, add:

```tsx
{confirmDialog && (
  <div style={dialogStyles.overlay}>
    <div style={dialogStyles.dialog}>
      <div style={dialogStyles.title}>
        {confirmDialog.type === 'add' && '是否將營位費用帶入費用清單？'}
        {confirmDialog.type === 'update' && '是否更新對應的費用？'}
        {confirmDialog.type === 'delete' && '是否一併刪除對應的費用？'}
      </div>
      <div style={dialogStyles.detail}>
        營位-{confirmDialog.campSiteName}，${confirmDialog.campSiteCost.toLocaleString()}
      </div>
      <div style={dialogStyles.actions}>
        <button onClick={() => setConfirmDialog(null)} style={cs.cancelBtn}>否</button>
        <button
          onClick={async () => {
            const d = confirmDialog;
            setConfirmDialog(null);
            if (d.type === 'add') {
              await onAddExpense({
                description: `營位-${d.campSiteName}`,
                amount: d.campSiteCost,
                paidByParticipantId: d.paidByParticipantId,
                splitType: 'CUSTOM',
                splitAmong: d.memberParticipantIds,
                campSiteId: d.campSiteId,
              });
            } else if (d.type === 'update') {
              const linkedExpense = expenses.find(e => e.campSiteId === d.campSiteId);
              if (linkedExpense) {
                await onUpdateExpense(linkedExpense.expenseId, {
                  description: `營位-${d.campSiteName}`,
                  amount: d.campSiteCost,
                  paidByParticipantId: d.paidByParticipantId,
                  splitType: 'CUSTOM',
                  splitAmong: d.memberParticipantIds,
                });
              }
            } else if (d.type === 'delete') {
              const linkedExpense = expenses.find(e => e.campSiteId === d.campSiteId);
              if (linkedExpense) {
                await onRemoveExpense(linkedExpense.expenseId);
              }
            }
          }}
          style={cs.confirmBtn}
        >
          是
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 6: Add dialog styles**

```typescript
const dialogStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  dialog: {
    backgroundColor: '#fff', borderRadius: 12, padding: 24,
    maxWidth: 320, width: '90%', textAlign: 'center' as const,
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  detail: { fontSize: 14, color: '#666', marginBottom: 20 },
  actions: { display: 'flex', gap: 12, justifyContent: 'center' },
};
```

**Step 7: Verify build**

Run: `cd apps/liff-web && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add apps/liff-web/src/features/camping/campsites-tab.tsx apps/liff-web/src/features/camping/trip-detail.tsx
git commit -m "feat: add campsite-expense sync confirmation dialogs"
```

---

### Task 5: Support `campSiteId` in expense API handlers

**Files:**
- Modify: API expense create/update handlers in `apps/api/src/lambda.ts` (around the expense routes)
- Modify: `apps/api/src/services/camping-split-service.ts` (expense create/update methods)

**Step 1: Find the expense create handler**

Search for the expense creation route in `lambda.ts` and the `addExpense` method in `camping-split-service.ts`. The `campSiteId` needs to be accepted in the request body and stored.

**Step 2: Update `addExpense` in camping-split-service.ts**

The service method that creates expenses should accept and pass through `campSiteId`:

Find the `addExpense` method signature and add `campSiteId?: string` to the input parameter. Pass it through to the `ExpenseRecord`.

**Step 3: Update the Lambda handler for expense creation**

In the POST `/expenses` handler, extract `campSiteId` from the request body and pass it to the service.

**Step 4: Update `updateExpense` similarly**

The update handler should also accept `campSiteId` (though for updates triggered by campsite edits, the campSiteId doesn't change).

**Step 5: Verify build and existing tests**

Run: `cd apps/api && npx tsc --noEmit && npx tsx --test src/domain/camping-settlement.test.ts`
Expected: All pass

**Step 6: Commit**

```bash
git add apps/api/src/lambda.ts apps/api/src/services/camping-split-service.ts
git commit -m "feat: accept campSiteId in expense create/update API"
```

---

### Task 6: End-to-end verification

**Step 1: Run all backend tests**

Run: `cd apps/api && npx tsx --test src/**/*.test.ts`
Expected: All pass

**Step 2: Build frontend**

Run: `cd apps/liff-web && npx tsc --noEmit`
Expected: No errors

**Step 3: Manual test checklist**

- [ ] Create a campsite → dialog appears asking to add expense → confirm → expense appears in expense list
- [ ] Edit the campsite → dialog appears asking to update expense → confirm → expense is updated
- [ ] Delete the campsite → dialog appears asking to delete expense → confirm → expense is removed
- [ ] Create a campsite → dialog appears → click "否" → no expense created
- [ ] Settlement preview only counts expenses (not campsite data directly)

**Step 4: Commit any fixes**

---

### Task 7: Deploy

**Step 1: Deploy backend**

Run: `cd infra/cdk && npx cdk deploy`

**Step 2: Build and deploy frontend**

Run:
```bash
cd apps/liff-web && npm run build
aws s3 sync dist/ s3://YOUR_LIFF_WEB_S3_BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_CLOUDFRONT_DISTRIBUTION_ID --paths "/*"
```

**Step 3: Verify deployment**

- Verify Lambda handler works: curl an endpoint
- Verify frontend bundle contains API URL: grep the JS bundle
- Test the feature in LIFF
