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

  async settle(tripId: string, callerEmployeeId: string, callerTenantId?: string): Promise<SettlementRecord> {
    const trip = await this.getTrip(tripId);
    if (callerTenantId && trip.tenantId !== callerTenantId) {
      throw new ForbiddenError('Cannot access trip from different tenant');
    }
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

    trip.status = 'SETTLED';
    await this.repo.updateTrip(trip);

    await this.sendSettlementNotifications(trip, participants, settlement);

    return settlement;
  }

  async getSettlement(tripId: string): Promise<SettlementRecord | null> {
    return this.repo.findSettlement(tripId);
  }

  async getTripDetail(tripId: string, callerTenantId?: string) {
    const trip = await this.getTrip(tripId);
    if (callerTenantId && trip.tenantId !== callerTenantId) {
      throw new ForbiddenError('Cannot access trip from different tenant');
    }
    const participants = await this.repo.listParticipants(tripId);
    const campSites = await this.repo.listCampSites(tripId);
    const expenses = await this.repo.listExpenses(tripId);
    const settlement = await this.repo.findSettlement(tripId);
    return { trip, participants, campSites, expenses, settlement };
  }

  async getPublicSummary(tripId: string) {
    const trip = await this.getTrip(tripId);
    const participants = await this.repo.listParticipants(tripId);
    const settlement = await this.repo.findSettlement(tripId);
    const participantNames: Record<string, string> = {};
    for (const p of participants) {
      participantNames[p.participantId] = p.name;
    }
    return {
      trip: { title: trip.title, startDate: trip.startDate, endDate: trip.endDate, status: trip.status },
      participantNames,
      settlement,
    };
  }

  private async requireOpen(tripId: string, callerTenantId?: string): Promise<CampingTripRecord> {
    const trip = await this.getTrip(tripId);
    if (callerTenantId && trip.tenantId !== callerTenantId) {
      throw new ForbiddenError('Cannot access trip from different tenant');
    }
    if (trip.status !== 'OPEN') {
      throw new ValidationError('Trip is already settled — cannot modify');
    }
    return trip;
  }

  private async sendSettlementNotifications(
    trip: CampingTripRecord,
    participants: TripParticipantRecord[],
    settlement: SettlementRecord,
  ): Promise<void> {
    const nameOf = new Map(participants.map(p => [p.participantId, p.name]));

    for (const summary of settlement.participantSummaries) {
      const participant = participants.find(p => p.participantId === summary.participantId);
      if (!participant?.lineUserId) continue;

      const netAmount = summary.netAmount;
      let text: string;
      if (netAmount > 0) {
        const myTransfers = settlement.transfers.filter(t => t.fromParticipantId === summary.participantId);
        const lines = myTransfers.map(t => `→ 轉帳 $${t.amount} 給 ${nameOf.get(t.toParticipantId) ?? '?'}`);
        text = `⛺ ${trip.title} 結算完成\n\n你的應付: $${netAmount}\n${lines.join('\n')}`;
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
