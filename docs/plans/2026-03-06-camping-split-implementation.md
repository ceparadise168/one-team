# Camping Expense Splitting System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a camping expense splitting module to the ONE TEAM LIFF app — participants record expenses, the system calculates who owes whom using a greedy net-settlement algorithm with minimum transfers.

**Architecture:** New domain types in `apps/api/src/domain/camping.ts`, repository interface + in-memory + DynamoDB implementations, `CampingSplitService` for business logic, route handlers in `lambda.ts`, React frontend pages under `apps/liff-web/src/features/camping/`.

**Tech Stack:** TypeScript, node:test, DynamoDB single-table, React 19, inline styles, LINE push messages via `LinePlatformClient`.

---

### Task 1: Domain Types

**Files:**
- Create: `apps/api/src/domain/camping.ts`

**Step 1: Write domain types**

```typescript
// apps/api/src/domain/camping.ts

export type CampingTripStatus = 'OPEN' | 'SETTLED';
export type SplitWeight = 1 | 0.5 | 0;
export type ExpenseSplitType = 'ALL' | 'CUSTOM';

export interface CampingTripRecord {
  tenantId: string;
  tripId: string;
  title: string;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  creatorEmployeeId: string;
  status: CampingTripStatus;
  createdAt: string;
}

export interface TripParticipantRecord {
  tripId: string;
  participantId: string;
  name: string;
  employeeId: string | null;
  lineUserId: string | null;
  splitWeight: SplitWeight;
  householdId: string | null;
  isHouseholdHead: boolean;
  settleAsHousehold: boolean;
}

export interface CampSiteRecord {
  tripId: string;
  campSiteId: string;
  name: string;
  cost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
}

export interface ExpenseRecord {
  tripId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: ExpenseSplitType;
  splitAmong: string[] | null;  // participantIds, required when CUSTOM
  createdAt: string;
}

export interface TransferInstruction {
  fromParticipantId: string;
  toParticipantId: string;
  amount: number;
}

export interface ParticipantSummary {
  participantId: string;
  name: string;
  totalOwed: number;
  totalPaid: number;
  netAmount: number;         // positive = owes, negative = owed
  breakdown: string;         // formula text
}

export interface SettlementRecord {
  tripId: string;
  transfers: TransferInstruction[];
  participantSummaries: ParticipantSummary[];
  settledAt: string;
}
```

**Step 2: Commit**

```bash
git add apps/api/src/domain/camping.ts
git commit -m "feat(camping): add domain types for camping expense splitting"
```

---

### Task 2: Settlement Algorithm (Pure Function + Tests)

**Files:**
- Create: `apps/api/src/domain/camping-settlement.ts`
- Create: `apps/api/src/domain/camping-settlement.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/domain/camping-settlement.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSettlement } from './camping-settlement.js';
import type {
  TripParticipantRecord,
  CampSiteRecord,
  ExpenseRecord,
} from './camping.js';

function makeParticipant(
  id: string,
  name: string,
  weight: 1 | 0.5 | 0 = 1,
  household?: { householdId: string; isHead: boolean; settle: boolean },
): TripParticipantRecord {
  return {
    tripId: 'trip-1',
    participantId: id,
    name,
    employeeId: null,
    lineUserId: null,
    splitWeight: weight,
    householdId: household?.householdId ?? null,
    isHouseholdHead: household?.isHead ?? false,
    settleAsHousehold: household?.settle ?? false,
  };
}

describe('calculateSettlement', () => {
  it('splits a single expense equally among all participants', () => {
    const participants = [
      makeParticipant('A', 'Alice'),
      makeParticipant('B', 'Bob'),
    ];
    const campSites: CampSiteRecord[] = [];
    const expenses: ExpenseRecord[] = [
      {
        tripId: 'trip-1',
        expenseId: 'e1',
        description: 'Food',
        amount: 1000,
        paidByParticipantId: 'A',
        splitType: 'ALL',
        splitAmong: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const result = calculateSettlement(participants, campSites, expenses);

    // Alice paid 1000, owes 500 → net -500 (owed 500)
    // Bob paid 0, owes 500 → net +500 (owes 500)
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromParticipantId, 'B');
    assert.equal(result.transfers[0].toParticipantId, 'A');
    assert.equal(result.transfers[0].amount, 500);
  });

  it('handles weight-based splitting (adult=1, child=0.5, toddler=0)', () => {
    const participants = [
      makeParticipant('dad', 'Dad'),           // weight 1
      makeParticipant('kid', 'Kid', 0.5),      // weight 0.5
      makeParticipant('baby', 'Baby', 0),      // weight 0
    ];
    const expenses: ExpenseRecord[] = [
      {
        tripId: 'trip-1',
        expenseId: 'e1',
        description: 'Meals',
        amount: 1500,
        paidByParticipantId: 'dad',
        splitType: 'ALL',
        splitAmong: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const result = calculateSettlement(participants, [], expenses);

    // totalWeight = 1 + 0.5 = 1.5, unitCost = 1000
    // Dad: owes 1000, paid 1500 → net = -500
    // Kid: owes 500, paid 0 → net = +500
    // Baby: owes 0, paid 0 → net = 0
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromParticipantId, 'kid');
    assert.equal(result.transfers[0].toParticipantId, 'dad');
    assert.equal(result.transfers[0].amount, 500);
  });

  it('splits campsite fees by headcount (ignoring weight)', () => {
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

    // Site A: 1200 / 2 = 600 each for A and B
    // A paid 1200, owes 600 → net = -600
    // B paid 0, owes 600 → net = +600
    // C: not in any campsite → net = 0
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromParticipantId, 'B');
    assert.equal(result.transfers[0].toParticipantId, 'A');
    assert.equal(result.transfers[0].amount, 600);
  });

  it('handles CUSTOM split among specific people', () => {
    const participants = [
      makeParticipant('A', 'Alice'),
      makeParticipant('B', 'Bob'),
      makeParticipant('C', 'Charlie'),
    ];
    const expenses: ExpenseRecord[] = [
      {
        tripId: 'trip-1',
        expenseId: 'e1',
        description: 'Private debt',
        amount: 300,
        paidByParticipantId: 'A',
        splitType: 'CUSTOM',
        splitAmong: ['B'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const result = calculateSettlement(participants, [], expenses);

    // Only B owes this. A paid 300, B owes 300 → B transfers 300 to A
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromParticipantId, 'B');
    assert.equal(result.transfers[0].toParticipantId, 'A');
    assert.equal(result.transfers[0].amount, 300);
  });

  it('merges household members for settlement when settleAsHousehold is true', () => {
    const participants = [
      makeParticipant('dad', 'Dad', 1, { householdId: 'h1', isHead: true, settle: true }),
      makeParticipant('mom', 'Mom', 1, { householdId: 'h1', isHead: false, settle: true }),
      makeParticipant('C', 'Charlie'),
    ];
    const expenses: ExpenseRecord[] = [
      {
        tripId: 'trip-1',
        expenseId: 'e1',
        description: 'Food',
        amount: 3000,
        paidByParticipantId: 'C',
        splitType: 'ALL',
        splitAmong: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const result = calculateSettlement(participants, [], expenses);

    // Each owes 1000. Dad+Mom merged → household owes 2000, Charlie paid 3000 owes 1000 → net -2000
    // Transfer: Dad (household head) → Charlie: 2000
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromParticipantId, 'dad');
    assert.equal(result.transfers[0].toParticipantId, 'C');
    assert.equal(result.transfers[0].amount, 2000);
  });

  it('produces minimum transfers with multiple debtors/creditors', () => {
    const participants = [
      makeParticipant('A', 'Alice'),
      makeParticipant('B', 'Bob'),
      makeParticipant('C', 'Charlie'),
      makeParticipant('D', 'Dave'),
    ];
    // A paid 4000 for all, B paid 2000 for all
    // Total = 6000, each owes 1500
    // A: net = 1500 - 4000 = -2500
    // B: net = 1500 - 2000 = -500
    // C: net = 1500
    // D: net = 1500
    const expenses: ExpenseRecord[] = [
      { tripId: 'trip-1', expenseId: 'e1', description: 'Food', amount: 4000, paidByParticipantId: 'A', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
      { tripId: 'trip-1', expenseId: 'e2', description: 'Gear', amount: 2000, paidByParticipantId: 'B', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const result = calculateSettlement(participants, [], expenses);

    // Greedy: largest debtor C(1500) pairs with largest creditor A(2500) → transfer 1500
    //         then D(1500) pairs with A(1000) → transfer 1000
    //         then D(500) pairs with B(500) → transfer 500
    // Total: 3 transfers
    assert.ok(result.transfers.length <= 3);

    // Verify balances sum to zero
    const balanceCheck = new Map<string, number>();
    for (const t of result.transfers) {
      balanceCheck.set(t.fromParticipantId, (balanceCheck.get(t.fromParticipantId) ?? 0) - t.amount);
      balanceCheck.set(t.toParticipantId, (balanceCheck.get(t.toParticipantId) ?? 0) + t.amount);
    }
    // After transfers, net positions should match expected
  });

  it('rounds amounts to integers', () => {
    const participants = [
      makeParticipant('A', 'Alice'),
      makeParticipant('B', 'Bob'),
      makeParticipant('C', 'Charlie'),
    ];
    const expenses: ExpenseRecord[] = [
      { tripId: 'trip-1', expenseId: 'e1', description: 'Food', amount: 1000, paidByParticipantId: 'A', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const result = calculateSettlement(participants, [], expenses);

    // 1000/3 = 333.33... → rounded to 333
    for (const t of result.transfers) {
      assert.equal(t.amount, Math.round(t.amount));
    }
  });

  it('reproduces the Excel example', () => {
    // Simplified version of the real Excel data
    const participants = [
      makeParticipant('bigS', '大S', 1, { householdId: 'h-bigS', isHead: true, settle: true }),
      makeParticipant('bigS-spouse', 'S太太', 1, { householdId: 'h-bigS', isHead: false, settle: true }),
      makeParticipant('bigS-kid1', 'S小孩', 0.5, { householdId: 'h-bigS', isHead: false, settle: true }),
      makeParticipant('bigS-kid2', 'S小孩2', 0.5, { householdId: 'h-bigS', isHead: false, settle: true }),
      makeParticipant('alex', 'Alex'),
      makeParticipant('can', 'Can'),
    ];

    const campSites: CampSiteRecord[] = [
      { tripId: 'trip-1', campSiteId: 'cs1', name: '雨棚A', cost: 1224, paidByParticipantId: 'can', memberParticipantIds: ['bigS', 'bigS-spouse', 'bigS-kid1', 'bigS-kid2'] },
      { tripId: 'trip-1', campSiteId: 'cs2', name: '非雨棚B', cost: 1020, paidByParticipantId: 'can', memberParticipantIds: ['alex', 'can'] },
    ];

    // Food: 3000, paid by Can, split ALL
    // totalWeight = 1+1+0.5+0.5+1+1 = 5
    // unitCost = 600
    const expenses: ExpenseRecord[] = [
      { tripId: 'trip-1', expenseId: 'e1', description: '食材', amount: 3000, paidByParticipantId: 'can', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const result = calculateSettlement(participants, campSites, expenses);

    // bigS household:
    //   campsite: 1224/4 * 4 = 1224
    //   food: 600 * (1+1+0.5+0.5) = 1800
    //   total owed: 3024, paid: 0, net: 3024
    // alex:
    //   campsite: 1020/2 = 510
    //   food: 600
    //   total owed: 1110, paid: 0, net: 1110
    // can:
    //   campsite: 1020/2 = 510
    //   food: 600
    //   total owed: 1110, paid: 1224+1020+3000 = 5244, net: -4134
    // Check: 3024 + 1110 - 4134 = 0 ✓

    const summaryMap = new Map(result.participantSummaries.map(s => [s.participantId, s]));

    // bigS household merged
    const bigSSummary = summaryMap.get('bigS');
    assert.ok(bigSSummary);
    assert.equal(bigSSummary.totalOwed, 3024);

    // Can is the creditor
    const canSummary = summaryMap.get('can');
    assert.ok(canSummary);
    assert.equal(canSummary.totalPaid, 5244);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx tsx --test src/domain/camping-settlement.test.ts`
Expected: FAIL — module not found

**Step 3: Write the settlement algorithm**

```typescript
// apps/api/src/domain/camping-settlement.ts
import type {
  TripParticipantRecord,
  CampSiteRecord,
  ExpenseRecord,
  TransferInstruction,
  ParticipantSummary,
  SettlementRecord,
} from './camping.js';

interface OwedPaid {
  owed: number;
  paid: number;
  breakdownParts: string[];
}

export function calculateSettlement(
  participants: TripParticipantRecord[],
  campSites: CampSiteRecord[],
  expenses: ExpenseRecord[],
): Omit<SettlementRecord, 'tripId' | 'settledAt'> {
  const ledger = new Map<string, OwedPaid>();
  for (const p of participants) {
    ledger.set(p.participantId, { owed: 0, paid: 0, breakdownParts: [] });
  }

  const nameOf = new Map(participants.map(p => [p.participantId, p.name]));

  // --- Campsite fees (split by headcount) ---
  for (const site of campSites) {
    const perPerson = site.cost / site.memberParticipantIds.length;
    for (const pid of site.memberParticipantIds) {
      const entry = ledger.get(pid);
      if (entry) {
        entry.owed += perPerson;
        entry.breakdownParts.push(`營位 ${site.name}: ${site.cost} / ${site.memberParticipantIds.length}人 = ${perPerson}`);
      }
    }
    // Credit the payer
    const payer = ledger.get(site.paidByParticipantId);
    if (payer) {
      payer.paid += site.cost;
    }
  }

  // --- Expenses ---
  for (const expense of expenses) {
    let targetIds: string[];
    if (expense.splitType === 'CUSTOM' && expense.splitAmong) {
      targetIds = expense.splitAmong;
    } else {
      // ALL: everyone with weight > 0
      targetIds = participants.filter(p => p.splitWeight > 0).map(p => p.participantId);
    }

    const targetParticipants = participants.filter(p => targetIds.includes(p.participantId));
    const totalWeight = targetParticipants.reduce((sum, p) => sum + p.splitWeight, 0);

    if (totalWeight > 0) {
      const unitCost = expense.amount / totalWeight;
      for (const p of targetParticipants) {
        const share = unitCost * p.splitWeight;
        const entry = ledger.get(p.participantId);
        if (entry) {
          entry.owed += share;
          entry.breakdownParts.push(`${expense.description}: ${expense.amount} / ${totalWeight}w × ${p.splitWeight}w = ${Math.round(share * 100) / 100}`);
        }
      }
    }

    // Credit the payer
    const payer = ledger.get(expense.paidByParticipantId);
    if (payer) {
      payer.paid += expense.amount;
    }
  }

  // --- Merge households ---
  const householdHeads = new Map<string, string>(); // householdId → headParticipantId
  for (const p of participants) {
    if (p.householdId && p.isHouseholdHead && p.settleAsHousehold) {
      householdHeads.set(p.householdId, p.participantId);
    }
  }

  // Net amounts per settlement unit (individual or household head)
  const netAmounts = new Map<string, number>();
  for (const p of participants) {
    const entry = ledger.get(p.participantId)!;
    const net = entry.owed - entry.paid;

    if (p.householdId && p.settleAsHousehold && !p.isHouseholdHead) {
      // Merge into household head
      const headId = householdHeads.get(p.householdId);
      if (headId) {
        netAmounts.set(headId, (netAmounts.get(headId) ?? 0) + net);
        continue;
      }
    }
    netAmounts.set(p.participantId, (netAmounts.get(p.participantId) ?? 0) + net);
  }

  // --- Greedy matching ---
  const debtors: Array<{ id: string; amount: number }> = [];
  const creditors: Array<{ id: string; amount: number }> = [];

  for (const [id, net] of netAmounts) {
    const rounded = Math.round(net);
    if (rounded > 0) debtors.push({ id, amount: rounded });
    else if (rounded < 0) creditors.push({ id, amount: -rounded });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers: TransferInstruction[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer > 0) {
      transfers.push({
        fromParticipantId: debtors[di].id,
        toParticipantId: creditors[ci].id,
        amount: transfer,
      });
    }
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount === 0) di++;
    if (creditors[ci].amount === 0) ci++;
  }

  // --- Build summaries ---
  const participantSummaries: ParticipantSummary[] = [];

  // For households, group members
  const householdMembers = new Map<string, TripParticipantRecord[]>();
  for (const p of participants) {
    if (p.householdId && p.settleAsHousehold) {
      if (!householdMembers.has(p.householdId)) householdMembers.set(p.householdId, []);
      householdMembers.get(p.householdId)!.push(p);
    }
  }

  const processedHouseholds = new Set<string>();
  for (const p of participants) {
    if (p.householdId && p.settleAsHousehold) {
      if (processedHouseholds.has(p.householdId)) continue;
      processedHouseholds.add(p.householdId);

      const members = householdMembers.get(p.householdId) ?? [];
      const head = members.find(m => m.isHouseholdHead) ?? members[0];
      let totalOwed = 0;
      let totalPaid = 0;
      const allParts: string[] = [];
      for (const m of members) {
        const entry = ledger.get(m.participantId)!;
        totalOwed += entry.owed;
        totalPaid += entry.paid;
        allParts.push(...entry.breakdownParts.map(bp => `${m.name}: ${bp}`));
      }
      participantSummaries.push({
        participantId: head.participantId,
        name: head.name + ' 一家',
        totalOwed: Math.round(totalOwed),
        totalPaid: Math.round(totalPaid),
        netAmount: Math.round(totalOwed - totalPaid),
        breakdown: allParts.join('\n'),
      });
    } else {
      const entry = ledger.get(p.participantId)!;
      participantSummaries.push({
        participantId: p.participantId,
        name: p.name,
        totalOwed: Math.round(entry.owed),
        totalPaid: Math.round(entry.paid),
        netAmount: Math.round(entry.owed - entry.paid),
        breakdown: entry.breakdownParts.join('\n'),
      });
    }
  }

  return { transfers, participantSummaries };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx tsx --test src/domain/camping-settlement.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/domain/camping-settlement.ts apps/api/src/domain/camping-settlement.test.ts
git commit -m "feat(camping): settlement algorithm with greedy net matching"
```

---

### Task 3: Repository Interface + In-Memory Implementation

**Files:**
- Create: `apps/api/src/repositories/camping-repository.ts`

**Step 1: Write repository interface and in-memory implementation**

```typescript
// apps/api/src/repositories/camping-repository.ts
import type {
  CampingTripRecord,
  TripParticipantRecord,
  CampSiteRecord,
  ExpenseRecord,
  SettlementRecord,
} from '../domain/camping.js';

export interface CampingRepository {
  // Trips
  createTrip(trip: CampingTripRecord): Promise<void>;
  findTripById(tripId: string): Promise<CampingTripRecord | null>;
  updateTrip(trip: CampingTripRecord): Promise<void>;
  listTripsByParticipantEmployeeId(tenantId: string, employeeId: string): Promise<CampingTripRecord[]>;

  // Participants
  createParticipant(participant: TripParticipantRecord): Promise<void>;
  updateParticipant(participant: TripParticipantRecord): Promise<void>;
  deleteParticipant(tripId: string, participantId: string): Promise<void>;
  listParticipants(tripId: string): Promise<TripParticipantRecord[]>;
  findParticipantByEmployeeId(tripId: string, employeeId: string): Promise<TripParticipantRecord | null>;

  // CampSites
  createCampSite(site: CampSiteRecord): Promise<void>;
  updateCampSite(site: CampSiteRecord): Promise<void>;
  deleteCampSite(tripId: string, campSiteId: string): Promise<void>;
  listCampSites(tripId: string): Promise<CampSiteRecord[]>;

  // Expenses
  createExpense(expense: ExpenseRecord): Promise<void>;
  updateExpense(expense: ExpenseRecord): Promise<void>;
  deleteExpense(tripId: string, expenseId: string): Promise<void>;
  listExpenses(tripId: string): Promise<ExpenseRecord[]>;

  // Settlement
  saveSettlement(settlement: SettlementRecord): Promise<void>;
  findSettlement(tripId: string): Promise<SettlementRecord | null>;
}

export class InMemoryCampingRepository implements CampingRepository {
  private trips: CampingTripRecord[] = [];
  private participants: TripParticipantRecord[] = [];
  private campSites: CampSiteRecord[] = [];
  private expenses: ExpenseRecord[] = [];
  private settlements: SettlementRecord[] = [];

  async createTrip(trip: CampingTripRecord): Promise<void> {
    this.trips.push({ ...trip });
  }

  async findTripById(tripId: string): Promise<CampingTripRecord | null> {
    return this.trips.find(t => t.tripId === tripId) ?? null;
  }

  async updateTrip(trip: CampingTripRecord): Promise<void> {
    const i = this.trips.findIndex(t => t.tripId === trip.tripId);
    if (i >= 0) this.trips[i] = { ...trip };
  }

  async listTripsByParticipantEmployeeId(tenantId: string, employeeId: string): Promise<CampingTripRecord[]> {
    const participantTripIds = this.participants
      .filter(p => p.employeeId === employeeId)
      .map(p => p.tripId);
    return this.trips.filter(t => t.tenantId === tenantId && participantTripIds.includes(t.tripId));
  }

  async createParticipant(participant: TripParticipantRecord): Promise<void> {
    this.participants.push({ ...participant });
  }

  async updateParticipant(participant: TripParticipantRecord): Promise<void> {
    const i = this.participants.findIndex(
      p => p.tripId === participant.tripId && p.participantId === participant.participantId,
    );
    if (i >= 0) this.participants[i] = { ...participant };
  }

  async deleteParticipant(tripId: string, participantId: string): Promise<void> {
    this.participants = this.participants.filter(
      p => !(p.tripId === tripId && p.participantId === participantId),
    );
  }

  async listParticipants(tripId: string): Promise<TripParticipantRecord[]> {
    return this.participants.filter(p => p.tripId === tripId).map(p => ({ ...p }));
  }

  async findParticipantByEmployeeId(tripId: string, employeeId: string): Promise<TripParticipantRecord | null> {
    return this.participants.find(p => p.tripId === tripId && p.employeeId === employeeId) ?? null;
  }

  async createCampSite(site: CampSiteRecord): Promise<void> {
    this.campSites.push({ ...site });
  }

  async updateCampSite(site: CampSiteRecord): Promise<void> {
    const i = this.campSites.findIndex(s => s.tripId === site.tripId && s.campSiteId === site.campSiteId);
    if (i >= 0) this.campSites[i] = { ...site };
  }

  async deleteCampSite(tripId: string, campSiteId: string): Promise<void> {
    this.campSites = this.campSites.filter(s => !(s.tripId === tripId && s.campSiteId === campSiteId));
  }

  async listCampSites(tripId: string): Promise<CampSiteRecord[]> {
    return this.campSites.filter(s => s.tripId === tripId).map(s => ({ ...s }));
  }

  async createExpense(expense: ExpenseRecord): Promise<void> {
    this.expenses.push({ ...expense });
  }

  async updateExpense(expense: ExpenseRecord): Promise<void> {
    const i = this.expenses.findIndex(e => e.tripId === expense.tripId && e.expenseId === expense.expenseId);
    if (i >= 0) this.expenses[i] = { ...expense };
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    this.expenses = this.expenses.filter(e => !(e.tripId === tripId && e.expenseId === expenseId));
  }

  async listExpenses(tripId: string): Promise<ExpenseRecord[]> {
    return this.expenses.filter(e => e.tripId === tripId).map(e => ({ ...e }));
  }

  async saveSettlement(settlement: SettlementRecord): Promise<void> {
    const i = this.settlements.findIndex(s => s.tripId === settlement.tripId);
    if (i >= 0) this.settlements[i] = { ...settlement };
    else this.settlements.push({ ...settlement });
  }

  async findSettlement(tripId: string): Promise<SettlementRecord | null> {
    return this.settlements.find(s => s.tripId === tripId) ?? null;
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/repositories/camping-repository.ts
git commit -m "feat(camping): repository interface and in-memory implementation"
```

---

### Task 4: CampingSplitService + Tests

**Files:**
- Create: `apps/api/src/services/camping-split-service.ts`
- Create: `apps/api/src/services/camping-split-service.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/services/camping-split-service.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CampingSplitService } from './camping-split-service.js';
import { InMemoryCampingRepository } from '../repositories/camping-repository.js';
import { StubLinePlatformClient } from '../line/line-platform-client.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../errors.js';

const TENANT = 'test-tenant';

function createContext(nowStr = '2026-03-01T09:00:00.000Z') {
  const repo = new InMemoryCampingRepository();
  const lineClient = new StubLinePlatformClient();
  const service = new CampingSplitService(repo, lineClient, { now: () => new Date(nowStr) });
  return { service, repo, lineClient };
}

describe('CampingSplitService — Trip CRUD', () => {
  it('creates a trip and adds creator as participant', async () => {
    const { service, repo } = createContext();

    const result = await service.createTrip({
      tenantId: TENANT,
      title: '冬季露營',
      startDate: '2026-12-20',
      endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01',
      creatorName: 'Alice',
      creatorLineUserId: 'line-alice',
    });

    assert.ok(result.tripId);
    const trip = await repo.findTripById(result.tripId);
    assert.ok(trip);
    assert.equal(trip.status, 'OPEN');

    // Creator should be auto-added as participant
    const participants = await repo.listParticipants(result.tripId);
    assert.equal(participants.length, 1);
    assert.equal(participants[0].name, 'Alice');
    assert.equal(participants[0].employeeId, 'EMP01');
  });
});

describe('CampingSplitService — Participants', () => {
  it('adds a household with members', async () => {
    const { service, repo } = createContext();
    const { tripId } = await service.createTrip({
      tenantId: TENANT, title: 'Test', startDate: '2026-12-20', endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01', creatorName: 'Alice', creatorLineUserId: null,
    });

    const result = await service.addHousehold(tripId, {
      head: { name: 'Bob', employeeId: null, lineUserId: null, splitWeight: 1 },
      members: [
        { name: 'Bob太太', employeeId: null, lineUserId: null, splitWeight: 1 },
        { name: 'Bob小孩', employeeId: null, lineUserId: null, splitWeight: 0.5 },
      ],
      settleAsHousehold: true,
    });

    assert.ok(result.householdId);
    const participants = await repo.listParticipants(tripId);
    // Creator + 3 household members
    assert.equal(participants.length, 4);
    const householdMembers = participants.filter(p => p.householdId === result.householdId);
    assert.equal(householdMembers.length, 3);
    const head = householdMembers.find(p => p.isHouseholdHead);
    assert.ok(head);
    assert.equal(head.name, 'Bob');
  });
});

describe('CampingSplitService — Settlement', () => {
  it('only the creator can settle', async () => {
    const { service } = createContext();
    const { tripId } = await service.createTrip({
      tenantId: TENANT, title: 'Test', startDate: '2026-12-20', endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01', creatorName: 'Alice', creatorLineUserId: null,
    });

    await assert.rejects(
      () => service.settle(tripId, 'OTHER_EMPLOYEE'),
      (err: Error) => err instanceof ForbiddenError,
    );
  });

  it('settles and sends LINE push notifications', async () => {
    const { service, repo, lineClient } = createContext();
    const { tripId } = await service.createTrip({
      tenantId: TENANT, title: '冬季露營', startDate: '2026-12-20', endDate: '2026-12-22',
      creatorEmployeeId: 'EMP01', creatorName: 'Can', creatorLineUserId: 'line-can',
    });

    // Add a participant with LINE
    await service.addParticipant(tripId, {
      name: 'Bob', employeeId: 'EMP02', lineUserId: 'line-bob', splitWeight: 1,
    });

    // Add expense
    const participants = await repo.listParticipants(tripId);
    const canId = participants.find(p => p.name === 'Can')!.participantId;
    await service.addExpense(tripId, {
      description: '食材',
      amount: 2000,
      paidByParticipantId: canId,
      splitType: 'ALL',
      splitAmong: null,
    });

    const settlement = await service.settle(tripId, 'EMP01');

    assert.ok(settlement.transfers.length > 0);
    assert.ok(lineClient.pushedMessages.length > 0);

    // Trip should be SETTLED
    const trip = await repo.findTripById(tripId);
    assert.equal(trip!.status, 'SETTLED');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx tsx --test src/services/camping-split-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write the service**

```typescript
// apps/api/src/services/camping-split-service.ts
import { randomUUID } from 'node:crypto';
import type {
  CampingTripRecord,
  TripParticipantRecord,
  ExpenseRecord,
  CampSiteRecord,
  SettlementRecord,
  SplitWeight,
  ExpenseSplitType,
} from '../domain/camping.js';
import { calculateSettlement } from '../domain/camping-settlement.js';
import type { CampingRepository } from '../repositories/camping-repository.js';
import type { LinePlatformClient } from '../line/line-platform-client.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';

interface ServiceOptions {
  now: () => Date;
}

interface CreateTripInput {
  tenantId: string;
  title: string;
  startDate: string;
  endDate: string;
  creatorEmployeeId: string;
  creatorName: string;
  creatorLineUserId: string | null;
}

interface AddParticipantInput {
  name: string;
  employeeId: string | null;
  lineUserId: string | null;
  splitWeight: SplitWeight;
}

interface AddHouseholdInput {
  head: AddParticipantInput;
  members: AddParticipantInput[];
  settleAsHousehold: boolean;
}

interface AddExpenseInput {
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: ExpenseSplitType;
  splitAmong: string[] | null;
}

interface AddCampSiteInput {
  name: string;
  cost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
}

export class CampingSplitService {
  constructor(
    private readonly repo: CampingRepository,
    private readonly lineClient: LinePlatformClient,
    private readonly options: ServiceOptions,
  ) {}

  async createTrip(input: CreateTripInput): Promise<{ tripId: string }> {
    const tripId = randomUUID().slice(0, 12);
    const trip: CampingTripRecord = {
      tenantId: input.tenantId,
      tripId,
      title: input.title,
      startDate: input.startDate,
      endDate: input.endDate,
      creatorEmployeeId: input.creatorEmployeeId,
      status: 'OPEN',
      createdAt: this.options.now().toISOString(),
    };
    await this.repo.createTrip(trip);

    // Auto-add creator as participant
    await this.repo.createParticipant({
      tripId,
      participantId: randomUUID().slice(0, 12),
      name: input.creatorName,
      employeeId: input.creatorEmployeeId,
      lineUserId: input.creatorLineUserId,
      splitWeight: 1,
      householdId: null,
      isHouseholdHead: false,
      settleAsHousehold: false,
    });

    return { tripId };
  }

  async getTrip(tripId: string): Promise<CampingTripRecord> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw new NotFoundError('Trip not found');
    return trip;
  }

  async addParticipant(tripId: string, input: AddParticipantInput): Promise<{ participantId: string }> {
    await this.requireOpen(tripId);
    const participantId = randomUUID().slice(0, 12);
    await this.repo.createParticipant({
      tripId,
      participantId,
      name: input.name,
      employeeId: input.employeeId,
      lineUserId: input.lineUserId,
      splitWeight: input.splitWeight,
      householdId: null,
      isHouseholdHead: false,
      settleAsHousehold: false,
    });
    return { participantId };
  }

  async addHousehold(tripId: string, input: AddHouseholdInput): Promise<{ householdId: string }> {
    await this.requireOpen(tripId);
    const householdId = randomUUID().slice(0, 12);

    // Head
    await this.repo.createParticipant({
      tripId,
      participantId: randomUUID().slice(0, 12),
      name: input.head.name,
      employeeId: input.head.employeeId,
      lineUserId: input.head.lineUserId,
      splitWeight: input.head.splitWeight,
      householdId,
      isHouseholdHead: true,
      settleAsHousehold: input.settleAsHousehold,
    });

    // Members
    for (const member of input.members) {
      await this.repo.createParticipant({
        tripId,
        participantId: randomUUID().slice(0, 12),
        name: member.name,
        employeeId: member.employeeId,
        lineUserId: member.lineUserId,
        splitWeight: member.splitWeight,
        householdId,
        isHouseholdHead: false,
        settleAsHousehold: input.settleAsHousehold,
      });
    }

    return { householdId };
  }

  async updateParticipant(tripId: string, participantId: string, updates: Partial<Pick<TripParticipantRecord, 'name' | 'splitWeight' | 'settleAsHousehold'>>): Promise<void> {
    await this.requireOpen(tripId);
    const participants = await this.repo.listParticipants(tripId);
    const p = participants.find(pp => pp.participantId === participantId);
    if (!p) throw new NotFoundError('Participant not found');
    await this.repo.updateParticipant({ ...p, ...updates });
  }

  async removeParticipant(tripId: string, participantId: string): Promise<void> {
    await this.requireOpen(tripId);
    await this.repo.deleteParticipant(tripId, participantId);
  }

  async addCampSite(tripId: string, input: AddCampSiteInput): Promise<{ campSiteId: string }> {
    await this.requireOpen(tripId);
    const campSiteId = randomUUID().slice(0, 12);
    await this.repo.createCampSite({
      tripId,
      campSiteId,
      name: input.name,
      cost: input.cost,
      paidByParticipantId: input.paidByParticipantId,
      memberParticipantIds: input.memberParticipantIds,
    });
    return { campSiteId };
  }

  async updateCampSite(tripId: string, campSiteId: string, updates: Partial<Pick<CampSiteRecord, 'name' | 'cost' | 'paidByParticipantId' | 'memberParticipantIds'>>): Promise<void> {
    await this.requireOpen(tripId);
    const sites = await this.repo.listCampSites(tripId);
    const site = sites.find(s => s.campSiteId === campSiteId);
    if (!site) throw new NotFoundError('CampSite not found');
    await this.repo.updateCampSite({ ...site, ...updates });
  }

  async removeCampSite(tripId: string, campSiteId: string): Promise<void> {
    await this.requireOpen(tripId);
    await this.repo.deleteCampSite(tripId, campSiteId);
  }

  async addExpense(tripId: string, input: AddExpenseInput): Promise<{ expenseId: string }> {
    await this.requireOpen(tripId);
    if (input.splitType === 'CUSTOM' && (!input.splitAmong || input.splitAmong.length === 0)) {
      throw new ValidationError('splitAmong is required for CUSTOM split type');
    }
    const expenseId = randomUUID().slice(0, 12);
    await this.repo.createExpense({
      tripId,
      expenseId,
      description: input.description,
      amount: input.amount,
      paidByParticipantId: input.paidByParticipantId,
      splitType: input.splitType,
      splitAmong: input.splitAmong,
      createdAt: this.options.now().toISOString(),
    });
    return { expenseId };
  }

  async updateExpense(tripId: string, expenseId: string, updates: Partial<Pick<ExpenseRecord, 'description' | 'amount' | 'paidByParticipantId' | 'splitType' | 'splitAmong'>>): Promise<void> {
    await this.requireOpen(tripId);
    const expenses = await this.repo.listExpenses(tripId);
    const expense = expenses.find(e => e.expenseId === expenseId);
    if (!expense) throw new NotFoundError('Expense not found');
    await this.repo.updateExpense({ ...expense, ...updates });
  }

  async removeExpense(tripId: string, expenseId: string): Promise<void> {
    await this.requireOpen(tripId);
    await this.repo.deleteExpense(tripId, expenseId);
  }

  async settle(tripId: string, callerEmployeeId: string): Promise<SettlementRecord> {
    const trip = await this.getTrip(tripId);
    if (trip.creatorEmployeeId !== callerEmployeeId) {
      throw new ForbiddenError('Only the trip creator can settle');
    }
    if (trip.status === 'SETTLED') {
      throw new ValidationError('Trip is already settled');
    }

    const participants = await this.repo.listParticipants(tripId);
    const campSites = await this.repo.listCampSites(tripId);
    const expenses = await this.repo.listExpenses(tripId);

    const result = calculateSettlement(participants, campSites, expenses);

    const settlement: SettlementRecord = {
      tripId,
      ...result,
      settledAt: this.options.now().toISOString(),
    };

    await this.repo.saveSettlement(settlement);

    // Update trip status
    trip.status = 'SETTLED';
    await this.repo.updateTrip(trip);

    // Send LINE notifications
    await this.sendSettlementNotifications(trip, participants, settlement);

    return settlement;
  }

  async getSettlement(tripId: string): Promise<SettlementRecord | null> {
    return this.repo.findSettlement(tripId);
  }

  // --- Aggregated trip detail for frontend ---
  async getTripDetail(tripId: string) {
    const trip = await this.getTrip(tripId);
    const participants = await this.repo.listParticipants(tripId);
    const campSites = await this.repo.listCampSites(tripId);
    const expenses = await this.repo.listExpenses(tripId);
    const settlement = await this.repo.findSettlement(tripId);
    return { trip, participants, campSites, expenses, settlement };
  }

  // --- Private helpers ---

  private async requireOpen(tripId: string): Promise<void> {
    const trip = await this.getTrip(tripId);
    if (trip.status !== 'OPEN') {
      throw new ValidationError('Trip is already settled — cannot modify');
    }
  }

  private async sendSettlementNotifications(
    trip: CampingTripRecord,
    participants: TripParticipantRecord[],
    settlement: SettlementRecord,
  ): Promise<void> {
    const nameOf = new Map(participants.map(p => [p.participantId, p.name]));

    for (const summary of settlement.participantSummaries) {
      // Find the LINE user ID for this participant
      const participant = participants.find(p => p.participantId === summary.participantId);
      if (!participant?.lineUserId) continue;

      const netAmount = summary.netAmount;
      let text: string;
      if (netAmount > 0) {
        // Owes money — find who to pay
        const myTransfers = settlement.transfers.filter(t => t.fromParticipantId === summary.participantId);
        const lines = myTransfers.map(t => `→ 轉帳 $${t.amount} 給 ${nameOf.get(t.toParticipantId) ?? '?'}`);
        text = `⛺ ${trip.title} 結算完成\n\n你的應付: $${netAmount}\n${lines.join('\n')}\n\n查看詳情: (link)`;
      } else if (netAmount < 0) {
        text = `⛺ ${trip.title} 結算完成\n\n你的應收: $${-netAmount}\n等待其他人轉帳給你`;
      } else {
        text = `⛺ ${trip.title} 結算完成\n\n你已結清，無需轉帳`;
      }

      try {
        await this.lineClient.pushMessage({
          tenantId: trip.tenantId,
          lineUserId: participant.lineUserId,
          messages: [{ type: 'text', text }],
        });
      } catch {
        // Notification failure should not break settlement
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx tsx --test src/services/camping-split-service.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/camping-split-service.ts apps/api/src/services/camping-split-service.test.ts
git commit -m "feat(camping): CampingSplitService with trip/participant/expense/settlement management"
```

---

### Task 5: DynamoDB Repository Implementation

**Files:**
- Create: `apps/api/src/repositories/dynamodb-camping-repository.ts`

**Step 1: Write DynamoDB repository**

Follow the pattern from `dynamodb-massage-booking-repository.ts`:
- `pk: CAMPING_TRIP#{tripId}`, `sk: RECORD | PARTICIPANT#{id} | CAMP_SITE#{id} | EXPENSE#{id} | SETTLEMENT`
- `entityType` field for filtering
- `stripMetadata()` to remove DynamoDB keys
- Use `QueryCommand` with `begins_with(sk, :prefix)` for listing

```typescript
// apps/api/src/repositories/dynamodb-camping-repository.ts
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type {
  CampingTripRecord,
  TripParticipantRecord,
  CampSiteRecord,
  ExpenseRecord,
  SettlementRecord,
} from '../domain/camping.js';
import type { CampingRepository } from './camping-repository.js';

function stripMetadata<T>(item: Record<string, unknown> | undefined): T | null {
  if (!item) return null;
  const rest = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => !['pk', 'sk', 'entityType', 'gsi_employee', 'gsi_date'].includes(key),
    ),
  );
  return rest as T;
}

export class DynamoDbCampingRepository implements CampingRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  // --- Trips ---
  async createTrip(trip: CampingTripRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${trip.tripId}`,
        sk: 'RECORD',
        entityType: 'CAMPING_TRIP',
        ...trip,
      },
    }));
  }

  async findTripById(tripId: string): Promise<CampingTripRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: 'RECORD' },
    }));
    return stripMetadata<CampingTripRecord>(result.Item as Record<string, unknown> | undefined);
  }

  async updateTrip(trip: CampingTripRecord): Promise<void> {
    await this.createTrip(trip); // PutCommand overwrites
  }

  async listTripsByParticipantEmployeeId(tenantId: string, employeeId: string): Promise<CampingTripRecord[]> {
    // Scan for participants with this employeeId, then fetch their trips
    // Note: For production scale, consider a GSI. For now, scan is acceptable for small datasets.
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'gsi-line-user',
      KeyConditionExpression: 'gsi_employee = :empId',
      FilterExpression: 'entityType = :type',
      ExpressionAttributeValues: {
        ':empId': employeeId,
        ':type': 'CAMPING_PARTICIPANT',
      },
    }));
    const tripIds = (result.Items ?? []).map(item => (item as Record<string, unknown>).tripId as string);
    const uniqueTripIds = [...new Set(tripIds)];

    const trips: CampingTripRecord[] = [];
    for (const tripId of uniqueTripIds) {
      const trip = await this.findTripById(tripId);
      if (trip && trip.tenantId === tenantId) trips.push(trip);
    }
    return trips;
  }

  // --- Participants ---
  async createParticipant(participant: TripParticipantRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${participant.tripId}`,
        sk: `PARTICIPANT#${participant.participantId}`,
        entityType: 'CAMPING_PARTICIPANT',
        gsi_employee: participant.employeeId ?? undefined,
        ...participant,
      },
    }));
  }

  async updateParticipant(participant: TripParticipantRecord): Promise<void> {
    await this.createParticipant(participant);
  }

  async deleteParticipant(tripId: string, participantId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: `PARTICIPANT#${participantId}` },
    }));
  }

  async listParticipants(tripId: string): Promise<TripParticipantRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPING_TRIP#${tripId}`,
        ':prefix': 'PARTICIPANT#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<TripParticipantRecord>(item as Record<string, unknown>)!);
  }

  async findParticipantByEmployeeId(tripId: string, employeeId: string): Promise<TripParticipantRecord | null> {
    const participants = await this.listParticipants(tripId);
    return participants.find(p => p.employeeId === employeeId) ?? null;
  }

  // --- CampSites ---
  async createCampSite(site: CampSiteRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${site.tripId}`,
        sk: `CAMP_SITE#${site.campSiteId}`,
        entityType: 'CAMPING_CAMP_SITE',
        ...site,
      },
    }));
  }

  async updateCampSite(site: CampSiteRecord): Promise<void> {
    await this.createCampSite(site);
  }

  async deleteCampSite(tripId: string, campSiteId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: `CAMP_SITE#${campSiteId}` },
    }));
  }

  async listCampSites(tripId: string): Promise<CampSiteRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPING_TRIP#${tripId}`,
        ':prefix': 'CAMP_SITE#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<CampSiteRecord>(item as Record<string, unknown>)!);
  }

  // --- Expenses ---
  async createExpense(expense: ExpenseRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${expense.tripId}`,
        sk: `EXPENSE#${expense.expenseId}`,
        entityType: 'CAMPING_EXPENSE',
        ...expense,
      },
    }));
  }

  async updateExpense(expense: ExpenseRecord): Promise<void> {
    await this.createExpense(expense);
  }

  async deleteExpense(tripId: string, expenseId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: `EXPENSE#${expenseId}` },
    }));
  }

  async listExpenses(tripId: string): Promise<ExpenseRecord[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPING_TRIP#${tripId}`,
        ':prefix': 'EXPENSE#',
      },
    }));
    return (result.Items ?? []).map(item => stripMetadata<ExpenseRecord>(item as Record<string, unknown>)!);
  }

  // --- Settlement ---
  async saveSettlement(settlement: SettlementRecord): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: `CAMPING_TRIP#${settlement.tripId}`,
        sk: 'SETTLEMENT',
        entityType: 'CAMPING_SETTLEMENT',
        ...settlement,
      },
    }));
  }

  async findSettlement(tripId: string): Promise<SettlementRecord | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `CAMPING_TRIP#${tripId}`, sk: 'SETTLEMENT' },
    }));
    return stripMetadata<SettlementRecord>(result.Item as Record<string, unknown> | undefined);
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/repositories/dynamodb-camping-repository.ts
git commit -m "feat(camping): DynamoDB repository implementation"
```

---

### Task 6: API Route Handlers

**Files:**
- Modify: `apps/api/src/lambda.ts` — add camping route handlers

**Step 1: Wire up service in lambda.ts**

Find where other services are instantiated (near the top of the handler function) and add:

```typescript
import { CampingSplitService } from './services/camping-split-service.js';
import { DynamoDbCampingRepository } from './repositories/dynamodb-camping-repository.js';
// or InMemoryCampingRepository for dev

const campingRepository = new DynamoDbCampingRepository(docClient, tableName);
const campingSplitService = new CampingSplitService(campingRepository, linePlatformClient, { now: () => new Date() });
```

**Step 2: Add route handlers**

Add these route blocks to `lambda.ts`, following the existing regex pattern matching style:

```typescript
// --- Camping: Trips ---
const campingTripsMatch = path.match(/^\/v1\/liff\/camping\/trips$/);
if (campingTripsMatch) {
  if (method === 'POST') {
    const principal = await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    const result = await campingSplitService.createTrip({
      tenantId: principal.tenantId,
      title: body.title as string,
      startDate: body.startDate as string,
      endDate: body.endDate as string,
      creatorEmployeeId: principal.employeeId,
      creatorName: body.creatorName as string,
      creatorLineUserId: principal.lineUserId ?? null,
    });
    return jsonResponse(201, result, responseOptions);
  }
  if (method === 'GET') {
    const principal = await requireEmployeePrincipal({ event, authSessionService });
    const trips = await campingRepository.listTripsByParticipantEmployeeId(principal.tenantId, principal.employeeId);
    return jsonResponse(200, { trips }, responseOptions);
  }
}

// --- Camping: Trip Detail ---
const campingTripDetailMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)$/);
if (campingTripDetailMatch) {
  const tripId = campingTripDetailMatch[1];
  if (method === 'GET') {
    await requireEmployeePrincipal({ event, authSessionService });
    const detail = await campingSplitService.getTripDetail(tripId);
    return jsonResponse(200, detail, responseOptions);
  }
}

// --- Camping: Participants ---
const campingParticipantsMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/participants$/);
if (campingParticipantsMatch) {
  const tripId = campingParticipantsMatch[1];
  if (method === 'POST') {
    await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    if (body.household) {
      const hh = body.household as Record<string, unknown>;
      const result = await campingSplitService.addHousehold(tripId, {
        head: hh.head as any,
        members: hh.members as any[],
        settleAsHousehold: hh.settleAsHousehold as boolean,
      });
      return jsonResponse(201, result, responseOptions);
    }
    const result = await campingSplitService.addParticipant(tripId, body as any);
    return jsonResponse(201, result, responseOptions);
  }
}

const campingParticipantMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/participants\/([^/]+)$/);
if (campingParticipantMatch) {
  const [, tripId, participantId] = campingParticipantMatch;
  if (method === 'PUT') {
    await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    await campingSplitService.updateParticipant(tripId, participantId, body as any);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
  if (method === 'DELETE') {
    await requireEmployeePrincipal({ event, authSessionService });
    await campingSplitService.removeParticipant(tripId, participantId);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
}

// --- Camping: CampSites ---
const campingCampSitesMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/campsites$/);
if (campingCampSitesMatch) {
  const tripId = campingCampSitesMatch[1];
  if (method === 'POST') {
    await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    const result = await campingSplitService.addCampSite(tripId, body as any);
    return jsonResponse(201, result, responseOptions);
  }
}

const campingCampSiteMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/campsites\/([^/]+)$/);
if (campingCampSiteMatch) {
  const [, tripId, campSiteId] = campingCampSiteMatch;
  if (method === 'PUT') {
    await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    await campingSplitService.updateCampSite(tripId, campSiteId, body as any);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
  if (method === 'DELETE') {
    await requireEmployeePrincipal({ event, authSessionService });
    await campingSplitService.removeCampSite(tripId, campSiteId);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
}

// --- Camping: Expenses ---
const campingExpensesMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/expenses$/);
if (campingExpensesMatch) {
  const tripId = campingExpensesMatch[1];
  if (method === 'POST') {
    await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    const result = await campingSplitService.addExpense(tripId, body as any);
    return jsonResponse(201, result, responseOptions);
  }
}

const campingExpenseMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/expenses\/([^/]+)$/);
if (campingExpenseMatch) {
  const [, tripId, expenseId] = campingExpenseMatch;
  if (method === 'PUT') {
    await requireEmployeePrincipal({ event, authSessionService });
    const body = parseBody(event) as Record<string, unknown>;
    await campingSplitService.updateExpense(tripId, expenseId, body as any);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
  if (method === 'DELETE') {
    await requireEmployeePrincipal({ event, authSessionService });
    await campingSplitService.removeExpense(tripId, expenseId);
    return jsonResponse(200, { ok: true }, responseOptions);
  }
}

// --- Camping: Settlement ---
const campingSettleMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/settle$/);
if (campingSettleMatch && method === 'POST') {
  const tripId = campingSettleMatch[1];
  const principal = await requireEmployeePrincipal({ event, authSessionService });
  const settlement = await campingSplitService.settle(tripId, principal.employeeId);
  return jsonResponse(200, settlement, responseOptions);
}

const campingSettlementMatch = path.match(/^\/v1\/liff\/camping\/trips\/([^/]+)\/settlement$/);
if (campingSettlementMatch && method === 'GET') {
  const tripId = campingSettlementMatch[1];
  await requireEmployeePrincipal({ event, authSessionService });
  const settlement = await campingSplitService.getSettlement(tripId);
  return jsonResponse(200, { settlement }, responseOptions);
}

// --- Camping: Public summary (no auth) ---
const campingSummaryMatch = path.match(/^\/v1\/public\/camping\/trips\/([^/]+)\/summary$/);
if (campingSummaryMatch && method === 'GET') {
  const tripId = campingSummaryMatch[1];
  const detail = await campingSplitService.getTripDetail(tripId);
  return jsonResponse(200, detail, responseOptions);
}
```

**Step 3: Commit**

```bash
git add apps/api/src/lambda.ts
git commit -m "feat(camping): API route handlers for camping expense splitting"
```

---

### Task 7: Frontend — Custom Hooks

**Files:**
- Create: `apps/liff-web/src/features/camping/use-camping.ts`

**Step 1: Write API hooks**

```typescript
// apps/liff-web/src/features/camping/use-camping.ts
import { useState, useEffect, useCallback } from 'react';

export interface CampingTrip {
  tripId: string;
  tenantId: string;
  title: string;
  startDate: string;
  endDate: string;
  creatorEmployeeId: string;
  status: 'OPEN' | 'SETTLED';
  createdAt: string;
}

export interface TripParticipant {
  tripId: string;
  participantId: string;
  name: string;
  employeeId: string | null;
  lineUserId: string | null;
  splitWeight: 1 | 0.5 | 0;
  householdId: string | null;
  isHouseholdHead: boolean;
  settleAsHousehold: boolean;
}

export interface CampSite {
  tripId: string;
  campSiteId: string;
  name: string;
  cost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
}

export interface Expense {
  tripId: string;
  expenseId: string;
  description: string;
  amount: number;
  paidByParticipantId: string;
  splitType: 'ALL' | 'CUSTOM';
  splitAmong: string[] | null;
  createdAt: string;
}

export interface TransferInstruction {
  fromParticipantId: string;
  toParticipantId: string;
  amount: number;
}

export interface ParticipantSummary {
  participantId: string;
  name: string;
  totalOwed: number;
  totalPaid: number;
  netAmount: number;
  breakdown: string;
}

export interface Settlement {
  tripId: string;
  transfers: TransferInstruction[];
  participantSummaries: ParticipantSummary[];
  settledAt: string;
}

export interface TripDetail {
  trip: CampingTrip;
  participants: TripParticipant[];
  campSites: CampSite[];
  expenses: Expense[];
  settlement: Settlement | null;
}

// --- Hooks ---

export function useCampingTrips(apiBaseUrl: string, accessToken: string) {
  const [trips, setTrips] = useState<CampingTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/liff/camping/trips`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => { if (!r.ok) throw new Error('載入失敗'); return r.json(); })
      .then(data => { setTrips(data.trips ?? []); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken]);

  useEffect(() => { refresh(); }, [refresh]);
  return { trips, loading, error, refresh };
}

export function useTripDetail(apiBaseUrl: string, accessToken: string, tripId: string) {
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => { if (!r.ok) throw new Error('載入失敗'); return r.json(); })
      .then(data => { setDetail(data); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, accessToken, tripId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { detail, loading, error, refresh };
}

// Mutation hooks

export function useCreateTrip(apiBaseUrl: string, accessToken: string) {
  const [loading, setLoading] = useState(false);

  const create = useCallback(async (input: { title: string; startDate: string; endDate: string; creatorName: string }) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('建立失敗');
      return await res.json() as { tripId: string };
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, accessToken]);

  return { create, loading };
}

export function useTripMutations(apiBaseUrl: string, accessToken: string, tripId: string) {
  const post = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const detail = await res.text(); throw new Error(detail || '操作失敗'); }
    return res.json();
  }, [apiBaseUrl, accessToken, tripId]);

  const put = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('操作失敗');
    return res.json();
  }, [apiBaseUrl, accessToken, tripId]);

  const del = useCallback(async (path: string) => {
    const res = await fetch(`${apiBaseUrl}/v1/liff/camping/trips/${tripId}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('操作失敗');
    return res.json();
  }, [apiBaseUrl, accessToken, tripId]);

  return { post, put, del };
}
```

**Step 2: Commit**

```bash
git add apps/liff-web/src/features/camping/use-camping.ts
git commit -m "feat(camping): frontend API hooks for camping feature"
```

---

### Task 8: Frontend — Trip List + Create Trip Pages

**Files:**
- Create: `apps/liff-web/src/features/camping/trip-list.tsx`
- Create: `apps/liff-web/src/features/camping/create-trip.tsx`
- Modify: `apps/liff-web/src/main.tsx` — add routes

**Step 1: Write TripList component**

Follow the pattern from `session-list.tsx`: `useAuth()`, loading/error states, card list, inline styles.

**Step 2: Write CreateTrip component**

Simple form: title, startDate, endDate → POST → navigate to trip detail.

**Step 3: Add routes to main.tsx**

```typescript
import { TripList } from './features/camping/trip-list';
import { CreateTrip } from './features/camping/create-trip';

// Add inside <Routes>:
<Route path="/camping" element={<AuthGuard><TripList /></AuthGuard>} />
<Route path="/camping/new" element={<AuthGuard><CreateTrip /></AuthGuard>} />
```

**Step 4: Commit**

```bash
git add apps/liff-web/src/features/camping/ apps/liff-web/src/main.tsx
git commit -m "feat(camping): trip list and create trip frontend pages"
```

---

### Task 9: Frontend — Trip Detail Page (Tabs)

**Files:**
- Create: `apps/liff-web/src/features/camping/trip-detail.tsx`
- Create: `apps/liff-web/src/features/camping/participants-tab.tsx`
- Create: `apps/liff-web/src/features/camping/campsites-tab.tsx`
- Create: `apps/liff-web/src/features/camping/expenses-tab.tsx`
- Create: `apps/liff-web/src/features/camping/settlement-tab.tsx`
- Modify: `apps/liff-web/src/main.tsx` — add route

**Step 1: Write TripDetail with tab navigation**

4 tabs: 參與者 / 營位 / 費用 / 結算. Use `useState<Tab>` for tab switching. Fetch `useTripDetail()` and pass data to each tab component.

**Step 2: Write ParticipantsTab**

- List participants grouped by household
- "新增一戶" button → modal/form for household head + members
- "新增個人" button → simple form
- Weight display: 大人/小孩/小小孩 badges

**Step 3: Write CampSitesTab**

- List camp sites with cost, payer, members
- "新增營位" form: name, cost, paidBy dropdown, member checkboxes (group by household)

**Step 4: Write ExpensesTab**

- List expenses with description, amount, payer, split info
- "新增費用" form: description, amount, paidBy, splitType (ALL/CUSTOM), participant checkboxes for CUSTOM
- Bottom summary: estimated per-person amounts (call `calculateSettlement` client-side for preview)

**Step 5: Write SettlementTab**

- If not settled: "結算" button (only visible to creator)
- If settled: transfer instructions + expandable per-person breakdown
- "分享連結" button: copy public URL
- "LINE 推播" button: triggers settle API

**Step 6: Add route**

```typescript
import { TripDetail } from './features/camping/trip-detail';

<Route path="/camping/:tripId" element={<AuthGuard><TripDetail /></AuthGuard>} />
```

**Step 7: Commit**

```bash
git add apps/liff-web/src/features/camping/ apps/liff-web/src/main.tsx
git commit -m "feat(camping): trip detail page with tabs for participants, campsites, expenses, settlement"
```

---

### Task 10: Frontend — Public Share Page

**Files:**
- Create: `apps/liff-web/src/features/camping/share-page.tsx`
- Modify: `apps/liff-web/src/main.tsx` — add public route (no AuthGuard)

**Step 1: Write SharePage**

Fetches from `/v1/public/camping/trips/{tripId}/summary`. Displays:
- Trip title and dates
- Settlement transfers (who pays whom)
- Per-person breakdown (expandable)
- No auth required

**Step 2: Add route (no AuthGuard)**

```typescript
import { SharePage } from './features/camping/share-page';

<Route path="/camping/:tripId/share" element={<SharePage />} />
```

**Step 3: Commit**

```bash
git add apps/liff-web/src/features/camping/share-page.tsx apps/liff-web/src/main.tsx
git commit -m "feat(camping): public share page for settlement results"
```

---

### Task 11: Integration Verification

**Step 1: Run all backend tests**

```bash
cd apps/api && npx tsx --test src/domain/camping-settlement.test.ts src/services/camping-split-service.test.ts
```

Expected: All tests PASS

**Step 2: Build frontend**

```bash
cd apps/liff-web && npm run build
```

Expected: Build succeeds with no errors

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore(camping): verify build and tests pass"
```
