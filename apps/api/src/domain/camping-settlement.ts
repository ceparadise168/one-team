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
    const payer = ledger.get(site.paidByParticipantId);
    if (payer) {
      payer.paid += site.cost;
    }
  }

  // --- Expenses ---
  for (const expense of expenses) {
    let targetIdSet: Set<string>;
    if (expense.splitType === 'CUSTOM' && expense.splitAmong) {
      targetIdSet = new Set(expense.splitAmong);
    } else {
      targetIdSet = new Set(participants.filter(p => p.splitWeight > 0).map(p => p.participantId));
    }

    const targetParticipants = participants.filter(p => targetIdSet.has(p.participantId));
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

    const payer = ledger.get(expense.paidByParticipantId);
    if (payer) {
      payer.paid += expense.amount;
    }
  }

  // --- Merge households ---
  const householdHeads = new Map<string, string>();
  for (const p of participants) {
    if (p.householdId && p.isHouseholdHead && p.settleAsHousehold) {
      householdHeads.set(p.householdId, p.participantId);
    }
  }

  const netAmounts = new Map<string, number>();
  for (const p of participants) {
    const entry = ledger.get(p.participantId)!;
    const net = entry.owed - entry.paid;

    if (p.householdId && p.settleAsHousehold && !p.isHouseholdHead) {
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
