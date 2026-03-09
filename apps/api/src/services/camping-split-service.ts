import { randomUUID } from 'node:crypto';
import type {
  CampingTripRecord,
  TripParticipantRecord,
  ExpenseRecord,
  CampSiteRecord,
  SettlementRecord,
  SplitWeight,
  ExpenseSplitType,
  AuditAction,
  AuditEntityType,
} from '../domain/camping.js';
import { calculateSettlement } from '../domain/camping-settlement.js';
import type { CampingRepository } from '../repositories/camping-repository.js';
import type { EmployeeBindingRepository } from '../repositories/invitation-binding-repository.js';
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

interface JoinTripInput {
  tripId: string;
  tenantId: string;
  employeeId: string;
  name: string;
}

interface AddCampSiteInput {
  name: string;
  cost: number;
  paidByParticipantId: string;
  memberParticipantIds: string[];
}

export interface Actor {
  employeeId: string;
  name: string;
}

export class CampingSplitService {
  constructor(
    private readonly repo: CampingRepository,
    private readonly lineClient: LinePlatformClient,
    private readonly options: ServiceOptions,
    private readonly employeeBindingRepo?: EmployeeBindingRepository,
  ) {}

  private async writeAuditLog(
    tripId: string,
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: string,
    entityName: string,
    actor: Actor,
    changes: Record<string, { from: unknown; to: unknown }> | null,
  ): Promise<void> {
    await this.repo.createAuditLog({
      tripId,
      logId: randomUUID().slice(0, 12),
      action,
      entityType,
      entityId,
      entityName,
      actorEmployeeId: actor.employeeId,
      actorName: actor.name,
      changes,
      createdAt: this.options.now().toISOString(),
    });
  }

  async createTrip(input: CreateTripInput, actor?: Actor): Promise<{ tripId: string }> {
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

    if (actor) {
      await this.writeAuditLog(tripId, 'CREATE', 'TRIP', tripId, input.title, actor, null);
    }

    return { tripId };
  }

  async getTrip(tripId: string): Promise<CampingTripRecord> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) throw new NotFoundError('Trip not found');
    return trip;
  }

  async addParticipant(tripId: string, input: AddParticipantInput, actor?: Actor): Promise<{ participantId: string }> {
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
    if (actor) {
      await this.writeAuditLog(tripId, 'CREATE', 'PARTICIPANT', participantId, input.name, actor, null);
    }
    return { participantId };
  }

  async addHousehold(tripId: string, input: AddHouseholdInput, actor?: Actor): Promise<{ householdId: string }> {
    await this.requireOpen(tripId);
    const householdId = randomUUID().slice(0, 12);

    const headId = randomUUID().slice(0, 12);
    await this.repo.createParticipant({
      tripId,
      participantId: headId,
      name: input.head.name,
      employeeId: input.head.employeeId,
      lineUserId: input.head.lineUserId,
      splitWeight: input.head.splitWeight,
      householdId,
      isHouseholdHead: true,
      settleAsHousehold: input.settleAsHousehold,
    });
    if (actor) {
      await this.writeAuditLog(tripId, 'CREATE', 'PARTICIPANT', headId, input.head.name, actor, null);
    }

    for (const member of input.members) {
      const memberId = randomUUID().slice(0, 12);
      await this.repo.createParticipant({
        tripId,
        participantId: memberId,
        name: member.name,
        employeeId: member.employeeId,
        lineUserId: member.lineUserId,
        splitWeight: member.splitWeight,
        householdId,
        isHouseholdHead: false,
        settleAsHousehold: input.settleAsHousehold,
      });
      if (actor) {
        await this.writeAuditLog(tripId, 'CREATE', 'PARTICIPANT', memberId, member.name, actor, null);
      }
    }

    return { householdId };
  }

  async updateParticipant(tripId: string, participantId: string, updates: Partial<Pick<TripParticipantRecord, 'name' | 'splitWeight' | 'settleAsHousehold'>>, actor?: Actor): Promise<void> {
    await this.requireOpen(tripId);
    const participants = await this.repo.listParticipants(tripId);
    const p = participants.find(pp => pp.participantId === participantId);
    if (!p) throw new NotFoundError('Participant not found');

    if (actor) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (updates.name !== undefined && updates.name !== p.name) changes.name = { from: p.name, to: updates.name };
      if (updates.splitWeight !== undefined && updates.splitWeight !== p.splitWeight) changes.splitWeight = { from: p.splitWeight, to: updates.splitWeight };
      if (updates.settleAsHousehold !== undefined && updates.settleAsHousehold !== p.settleAsHousehold) changes.settleAsHousehold = { from: p.settleAsHousehold, to: updates.settleAsHousehold };
      if (Object.keys(changes).length > 0) {
        await this.writeAuditLog(tripId, 'UPDATE', 'PARTICIPANT', participantId, p.name, actor, changes);
      }
    }

    await this.repo.updateParticipant({ ...p, ...updates });
  }

  async removeParticipant(tripId: string, participantId: string, actor?: Actor): Promise<void> {
    await this.requireOpen(tripId);
    if (actor) {
      const participants = await this.repo.listParticipants(tripId);
      const p = participants.find(pp => pp.participantId === participantId);
      if (p) {
        await this.writeAuditLog(tripId, 'DELETE', 'PARTICIPANT', participantId, p.name, actor, null);
      }
    }
    await this.repo.deleteParticipant(tripId, participantId);
  }

  async addCampSite(tripId: string, input: AddCampSiteInput, actor?: Actor): Promise<{ campSiteId: string }> {
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
    if (actor) {
      await this.writeAuditLog(tripId, 'CREATE', 'CAMPSITE', campSiteId, input.name, actor, null);
    }
    return { campSiteId };
  }

  async updateCampSite(tripId: string, campSiteId: string, updates: Partial<Pick<CampSiteRecord, 'name' | 'cost' | 'paidByParticipantId' | 'memberParticipantIds'>>, actor?: Actor): Promise<void> {
    await this.requireOpen(tripId);
    const sites = await this.repo.listCampSites(tripId);
    const site = sites.find(s => s.campSiteId === campSiteId);
    if (!site) throw new NotFoundError('CampSite not found');

    if (actor) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (updates.name !== undefined && updates.name !== site.name) changes.name = { from: site.name, to: updates.name };
      if (updates.cost !== undefined && updates.cost !== site.cost) changes.cost = { from: site.cost, to: updates.cost };
      if (updates.paidByParticipantId !== undefined && updates.paidByParticipantId !== site.paidByParticipantId) changes.paidByParticipantId = { from: site.paidByParticipantId, to: updates.paidByParticipantId };
      if (Object.keys(changes).length > 0) {
        await this.writeAuditLog(tripId, 'UPDATE', 'CAMPSITE', campSiteId, site.name, actor, changes);
      }
    }

    await this.repo.updateCampSite({ ...site, ...updates });
  }

  async removeCampSite(tripId: string, campSiteId: string, actor?: Actor): Promise<void> {
    await this.requireOpen(tripId);
    if (actor) {
      const sites = await this.repo.listCampSites(tripId);
      const site = sites.find(s => s.campSiteId === campSiteId);
      if (site) {
        await this.writeAuditLog(tripId, 'DELETE', 'CAMPSITE', campSiteId, site.name, actor, null);
      }
    }
    await this.repo.deleteCampSite(tripId, campSiteId);
  }

  async addExpense(tripId: string, input: AddExpenseInput, actor?: Actor): Promise<{ expenseId: string }> {
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
    if (actor) {
      await this.writeAuditLog(tripId, 'CREATE', 'EXPENSE', expenseId, input.description, actor, null);
    }
    return { expenseId };
  }

  async updateExpense(tripId: string, expenseId: string, updates: Partial<Pick<ExpenseRecord, 'description' | 'amount' | 'paidByParticipantId' | 'splitType' | 'splitAmong'>>, actor?: Actor): Promise<void> {
    await this.requireOpen(tripId);
    const expenses = await this.repo.listExpenses(tripId);
    const expense = expenses.find(e => e.expenseId === expenseId);
    if (!expense) throw new NotFoundError('Expense not found');

    if (actor) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (updates.description !== undefined && updates.description !== expense.description) changes.description = { from: expense.description, to: updates.description };
      if (updates.amount !== undefined && updates.amount !== expense.amount) changes.amount = { from: expense.amount, to: updates.amount };
      if (updates.paidByParticipantId !== undefined && updates.paidByParticipantId !== expense.paidByParticipantId) changes.paidByParticipantId = { from: expense.paidByParticipantId, to: updates.paidByParticipantId };
      if (updates.splitType !== undefined && updates.splitType !== expense.splitType) changes.splitType = { from: expense.splitType, to: updates.splitType };
      if (Object.keys(changes).length > 0) {
        await this.writeAuditLog(tripId, 'UPDATE', 'EXPENSE', expenseId, expense.description, actor, changes);
      }
    }

    await this.repo.updateExpense({ ...expense, ...updates });
  }

  async removeExpense(tripId: string, expenseId: string, actor?: Actor): Promise<void> {
    await this.requireOpen(tripId);
    if (actor) {
      const expenses = await this.repo.listExpenses(tripId);
      const expense = expenses.find(e => e.expenseId === expenseId);
      if (expense) {
        await this.writeAuditLog(tripId, 'DELETE', 'EXPENSE', expenseId, expense.description, actor, null);
      }
    }
    await this.repo.deleteExpense(tripId, expenseId);
  }

  async settle(tripId: string, callerEmployeeId: string, callerTenantId?: string, actor?: Actor): Promise<SettlementRecord> {
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

    const [participants, campSites, expenses] = await Promise.all([
      this.repo.listParticipants(tripId),
      this.repo.listCampSites(tripId),
      this.repo.listExpenses(tripId),
    ]);

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

    if (actor) {
      await this.writeAuditLog(tripId, 'CREATE', 'SETTLEMENT', tripId, trip.title, actor, null);
    }

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
    const [participants, campSites, expenses, settlement] = await Promise.all([
      this.repo.listParticipants(tripId),
      this.repo.listCampSites(tripId),
      this.repo.listExpenses(tripId),
      this.repo.findSettlement(tripId),
    ]);
    return { trip, participants, campSites, expenses, settlement };
  }

  async previewSettlement(tripId: string, callerTenantId?: string) {
    const trip = await this.getTrip(tripId);
    if (callerTenantId && trip.tenantId !== callerTenantId) {
      throw new ForbiddenError('Cannot access trip from different tenant');
    }
    const [participants, campSites, expenses] = await Promise.all([
      this.repo.listParticipants(tripId),
      this.repo.listCampSites(tripId),
      this.repo.listExpenses(tripId),
    ]);
    return calculateSettlement(participants, campSites, expenses);
  }

  async getPublicSummary(tripId: string) {
    const trip = await this.getTrip(tripId);
    const [participants, settlement] = await Promise.all([
      this.repo.listParticipants(tripId),
      this.repo.findSettlement(tripId),
    ]);
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

  async joinTrip(input: JoinTripInput): Promise<{ participantId: string }> {
    const trip = await this.requireOpen(input.tripId, input.tenantId);

    // Idempotent: if already a participant, return existing
    const existing = await this.repo.findParticipantByEmployeeId(input.tripId, input.employeeId);
    if (existing) return { participantId: existing.participantId };

    // Best-effort lineUserId lookup
    let lineUserId: string | null = null;
    if (this.employeeBindingRepo) {
      const binding = await this.employeeBindingRepo.findActiveByEmployeeId(trip.tenantId, input.employeeId);
      if (binding) lineUserId = binding.lineUserId;
    }

    const participantId = randomUUID().slice(0, 12);
    await this.repo.createParticipant({
      tripId: input.tripId,
      participantId,
      name: input.name,
      employeeId: input.employeeId,
      lineUserId,
      splitWeight: 1,
      householdId: null,
      isHouseholdHead: false,
      settleAsHousehold: false,
    });

    await this.writeAuditLog(input.tripId, 'CREATE', 'PARTICIPANT', participantId, input.name, { employeeId: input.employeeId, name: input.name }, null);

    return { participantId };
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

    const pushPromises: Promise<void>[] = [];
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

      pushPromises.push(
        this.lineClient.pushMessage({
          tenantId: trip.tenantId,
          lineUserId: participant.lineUserId,
          messages: [{ type: 'text', text }],
        }).catch(() => {
          // Notification failure should not break settlement
        }),
      );
    }
    await Promise.allSettled(pushPromises);
  }
}
