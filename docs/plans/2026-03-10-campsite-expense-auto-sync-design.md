# Campsite Expense Auto-Sync Design

## Overview

Automatically sync campsite data into the expense list via confirmation dialogs when creating, editing, or deleting campsites. Unify settlement calculation to use only expenses (remove separate campsite cost calculation).

## Data Model Changes

### ExpenseRecord

Add optional field `campSiteId?: string` to link an expense back to a campsite.

```typescript
interface ExpenseRecord {
  // ... existing fields
  campSiteId?: string; // Links expense to originating campsite
}
```

DynamoDB: store as a regular attribute on EXPENSE records.

## UI Behavior

### Confirmation Dialogs (campsites-tab.tsx)

| Campsite Action | Dialog Message | On Confirm |
|----------------|---------------|------------|
| **Create** | 是否將營位費用帶入費用清單？ | Create expense with campSiteId |
| **Edit** | 是否更新對應的費用？ | Find expense by campSiteId and update |
| **Delete** | 是否一併刪除對應的費用？ | Find expense by campSiteId and delete |

### Expense Field Mapping

| Expense Field | Value |
|--------------|-------|
| description | `營位-${campsite.name}` |
| amount | `campsite.cost` |
| paidByParticipantId | `campsite.paidByParticipantId` |
| splitType | `CUSTOM` |
| splitAmong | `campsite.memberParticipantIds` |
| campSiteId | `campsite.campSiteId` |

### Finding Linked Expenses

Frontend filters the already-loaded expense list by `campSiteId` to find the corresponding expense. No new API endpoint needed.

## Settlement Calculation Changes (Breaking)

### Remove campsite cost calculation from `calculateSettlement`

Currently `calculateSettlement` processes campsites and expenses separately:
- Campsites: divided by headcount (ignores splitWeight)
- Expenses: divided by weight (ALL) or equally among specified members (CUSTOM)

**Change:** Remove the campsite cost loop entirely. All costs go through expenses.

This is safe because:
- CUSTOM split with `splitAmong = memberParticipantIds` produces identical results to headcount-based campsite splitting
- Already-settled trips are frozen and unaffected
- POC stage — no need for migration of existing OPEN trips

### Test Updates

All tests in `camping-settlement.test.ts` that include campsites need to be rewritten to use expense records instead.

## What We Keep

- Campsite entity and CRUD operations (still useful for tracking who stays where)
- `cost` and `paidByParticipantId` on CampSiteRecord (UI display, source of truth for sync)
- Campsite member assignment UI

## What We Don't Do

- No automatic sync without user confirmation
- No migration for existing OPEN trips (POC acceptable)
- No new API endpoints (reuse existing expense CRUD)
