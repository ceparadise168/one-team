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

    const result = calculateSettlement(participants, [], expenses);

    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromParticipantId, 'B');
    assert.equal(result.transfers[0].toParticipantId, 'A');
    assert.equal(result.transfers[0].amount, 500);
  });

  it('handles weight-based splitting (adult=1, child=0.5, toddler=0)', () => {
    const participants = [
      makeParticipant('dad', 'Dad'),
      makeParticipant('kid', 'Kid', 0.5),
      makeParticipant('baby', 'Baby', 0),
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
    const expenses: ExpenseRecord[] = [
      { tripId: 'trip-1', expenseId: 'e1', description: 'Food', amount: 4000, paidByParticipantId: 'A', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
      { tripId: 'trip-1', expenseId: 'e2', description: 'Gear', amount: 2000, paidByParticipantId: 'B', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const result = calculateSettlement(participants, [], expenses);

    assert.ok(result.transfers.length <= 3);

    const balanceCheck = new Map<string, number>();
    for (const t of result.transfers) {
      balanceCheck.set(t.fromParticipantId, (balanceCheck.get(t.fromParticipantId) ?? 0) - t.amount);
      balanceCheck.set(t.toParticipantId, (balanceCheck.get(t.toParticipantId) ?? 0) + t.amount);
    }
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

    for (const t of result.transfers) {
      assert.equal(t.amount, Math.round(t.amount));
    }
  });

  it('reproduces the Excel example', () => {
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

    const expenses: ExpenseRecord[] = [
      { tripId: 'trip-1', expenseId: 'e1', description: '食材', amount: 3000, paidByParticipantId: 'can', splitType: 'ALL', splitAmong: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const result = calculateSettlement(participants, campSites, expenses);

    const summaryMap = new Map(result.participantSummaries.map(s => [s.participantId, s]));

    const bigSSummary = summaryMap.get('bigS');
    assert.ok(bigSSummary);
    assert.equal(bigSSummary.totalOwed, 3024);

    const canSummary = summaryMap.get('can');
    assert.ok(canSummary);
    assert.equal(canSummary.totalPaid, 5244);
  });
});
